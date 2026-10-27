import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A message with no time of its own.
 *
 * The timestamp is what tells two messages apart. A message without one
 * could only be told apart by its text and by how many times that text
 * had been seen — and the collectors return a *window*, not the whole
 * history, because they ask for the most recent messages. So the window
 * moves, the new message gets the occurrence number of one that is
 * already stored, and it is never imported.
 *
 * The other way round was worse: counting from what was already stored
 * would import a *duplicate* every time the same history was collected
 * again — and "the same sentence is stored once" is the promise this
 * whole thing is about.
 *
 * So the source's own id — Feishu's `message_id`, Slack's `ts`, the
 * page's `data-message-id` — is carried through the payload and stored
 * in a column. It does not move.
 */

const getCollectedMessageKeys = vi.fn();
const createCollectedMessages = vi.fn();

vi.mock("../db", () => ({
  getCollectedMessageKeys: (...a: unknown[]) => getCollectedMessageKeys(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
}));

import { importCollectedMessages } from "./db-store";
import { normaliseCollectorOutput } from "./runner";

/** The rows the import wrote. */
function written(): any[] {
  const call = createCollectedMessages.mock.calls[0];
  return call ? (call[0] as any[]) : [];
}

beforeEach(() => {
  getCollectedMessageKeys.mockReset();
  createCollectedMessages.mockReset();
  createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
});

const PERSONA = 1;
const USER = 2;

describe("a collection that returns a window", () => {
  it("imports a new message that has no time of its own", async () => {
    /**
     * The window moved.
     *
     * The first collection brought in two "嗯"s with no time. The second
     * collection is a window that has moved on: one of the old ones has
     * fallen off the end, and one new one has arrived. The new one has
     * the same text as the old one — and, before the fix, it got the
     * same occurrence number, so it was dropped.
     */
    getCollectedMessageKeys.mockResolvedValue([
      { source: "feishu", timestamp: null, content: "嗯", sourceMessageId: "m1" },
      { source: "feishu", timestamp: null, content: "嗯", sourceMessageId: "m2" },
    ]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [
        // The one that is still in the window.
        { role: "assistant", content: "嗯", id: "m2" },
        // And the one that is new.
        { role: "assistant", content: "嗯", id: "m3" },
      ],
    });

    const rows = written();
    expect(rows.length).toBe(1);
    expect(rows[0].sourceMessageId).toBe("m3");
  });

  it("does not import the same message twice", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      { source: "feishu", timestamp: null, content: "嗯", sourceMessageId: "m1" },
    ]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [{ role: "assistant", content: "嗯", id: "m1" }],
    });

    expect(written().length).toBe(0);
  });

  it("still keeps the promise for the rows that have no id", async () => {
    /**
     * The rows collected before the id was stored.
     *
     * They have no id of their own, and they were written with the old
     * key — so they are still recognised by it, and a collection of the
     * same history does not import them twice.
     */
    getCollectedMessageKeys.mockResolvedValue([
      { source: "feishu", timestamp: null, content: "嗯", sourceMessageId: null },
      { source: "feishu", timestamp: null, content: "嗯", sourceMessageId: null },
    ]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
      ],
    });

    expect(written().length).toBe(0);
  });

  it("does not import a legacy row a second time when the message now has an id", async () => {
    /**
     * The upgrade.
     *
     * A row that was collected before the id was stored, and the same
     * history collected again — and this time the collector supplies
     * the id. The id is new, so the id-key does not match — but the old
     * key does, and the row is not imported twice.
     */
    getCollectedMessageKeys.mockResolvedValue([
      { source: "feishu", timestamp: null, content: "在吗", sourceMessageId: null },
    ]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [{ role: "assistant", content: "在吗", id: "m1" }],
    });

    expect(written().length).toBe(0);
  });

  it("keeps the two identical messages of one batch apart", async () => {
    // Two "嗯"s in a row is what a chat log is full of. With no ids,
    // they are told apart by their order — and both are kept.
    getCollectedMessageKeys.mockResolvedValue([]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
      ],
    });

    expect(written().length).toBe(2);
  });
});

describe("the payload the collectors write", () => {
  it("carries the id into the message", () => {
    /**
     * The whole way: the collector writes `id`, the parser reads it,
     * and the importer stores it.
     */
    const payload = JSON.stringify({
      messages: [
        { role: "assistant", content: "在吗", id: "om_abc123" },
        { role: "assistant", content: "在吗", id: "om_def456" },
      ],
    });
    const result = normaliseCollectorOutput(payload, "feishu");
    expect(result.messages.length).toBe(2);
    expect(result.messages[0].id).toBe("om_abc123");
    expect(result.messages[1].id).toBe("om_def456");
  });
});

describe("a message with a time of its own", () => {
  it("is keyed by the time, as it always was", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      {
        source: "feishu",
        timestamp: new Date("2024-05-20T10:00:00Z"),
        content: "在吗",
        sourceMessageId: "m1",
      },
    ]);

    await importCollectedMessages({
      personaId: PERSONA,
      userId: USER,
      source: "feishu",
      messages: [
        { role: "assistant", content: "在吗", timestamp: "2024-05-20T10:00:00Z", id: "m1" },
      ],
    });

    expect(written().length).toBe(0);
  });
});
