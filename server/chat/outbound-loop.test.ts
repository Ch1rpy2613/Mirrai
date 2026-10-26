import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectOutboundCandidates } from "./outbound";
import { daysWaiting, isStale } from "@shared/outbound";

/**
 * The whole loop.
 *
 * The exit is only worth anything if the whole path works: something
 * said here that was never said there, found, handed back untouched,
 * and then either said or deliberately left behind. Each of those steps
 * can fail quietly — a paraphrase, a persona line sneaking in, a letter
 * that waits forever — so the loop is tested end to end rather than one
 * piece at a time.
 */
const invokeWithProvider = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => ({
    name: "test",
    isConfigured: () => true,
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
  }),
}));

/** A conversation in which the user says the thing they cannot say there. */
const conversation = [
  { id: 1, role: "user", content: "在吗", createdAt: new Date("2025-03-01T12:00:00Z") },
  { id: 2, role: "assistant", content: "在的", createdAt: new Date("2025-03-01T12:00:01Z") },
  { id: 3, role: "user", content: "我最近很害怕你离开我", createdAt: new Date("2025-03-01T12:05:00Z") },
  { id: 4, role: "assistant", content: "想多了", createdAt: new Date("2025-03-01T12:06:00Z") },
  { id: 5, role: "user", content: "我知道你这样说，但我还是很害怕", createdAt: new Date("2025-03-01T12:08:00Z") },
  { id: 6, role: "assistant", content: "睡吧", createdAt: new Date("2025-03-01T12:09:00Z") },
];

describe("the whole loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The model says nothing useful, so the heuristic floor has to carry it.
    invokeWithProvider.mockResolvedValue(JSON.stringify({ items: [], note: "" }));
  });

  it("finds the thing that was only said here", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.map((c) => c.text)).toContain("我最近很害怕你离开我");
  });

  it("hands the words back exactly as they were said", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });
    for (const candidate of candidates) {
      const original = conversation.find((m) => m.id === candidate.messageId);
      expect(original).toBeDefined();
      expect(candidate.text).toBe(original!.content);
    }
  });

  it("never hands back a word the persona said", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });
    for (const candidate of candidates) {
      const original = conversation.find((m) => m.id === candidate.messageId);
      expect(original!.role).toBe("user");
    }
  });

  it("ends with the letter either said or deliberately left behind", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });
    expect(candidates.length).toBeGreaterThan(0);

    // "Ready" is the state it is handed back in — waiting to be taken.
    const letter = {
      status: "ready",
      createdAt: new Date("2025-03-02T00:00:00Z"),
    };
    expect(daysWaiting(letter, new Date("2025-03-03T00:00:00Z"))).toBe(1);
    expect(isStale(letter, new Date("2025-03-03T00:00:00Z"))).toBe(false);

    // Said: the letter is finished, and it stops being counted.
    expect(
      daysWaiting(
        { status: "sent", createdAt: new Date("2025-03-02T00:00:00Z") },
        new Date("2026-03-03T00:00:00Z"),
      ),
    ).toBe(0);

    // Left behind: also finished, and also not waiting any more.
    expect(
      daysWaiting(
        { status: "self", createdAt: new Date("2025-03-02T00:00:00Z") },
        new Date("2026-03-03T00:00:00Z"),
      ),
    ).toBe(0);
  });

  it("still finds the thing when the model is not there at all", async () => {
    // The model is optional. The exit must not be empty just because a
    // provider is misconfigured.
    invokeWithProvider.mockRejectedValue(new Error("no provider"));

    const { candidates, note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.text)).toContain("我最近很害怕你离开我");
    expect(note).not.toBe("");
  });

  it("does not hand back the persona's words even when the model asks for them", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [
          { messageId: 4, text: "想多了" },
          { messageId: 3, text: "我最近很害怕你离开我" },
        ],
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.text)).not.toContain("想多了");
    expect(candidates.map((c) => c.text)).toContain("我最近很害怕你离开我");
  });
});
