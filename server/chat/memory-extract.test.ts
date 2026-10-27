import { describe, expect, it, vi, beforeEach } from "vitest";

const getLastExtractionAt = vi.fn();
const getMessagesSince = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const createMemory = vi.fn();
const markMemoryExtracted = vi.fn();
const markMemoryAttempted = vi.fn();
const claimMemoryExtraction = vi.fn();
const releaseMemoryExtraction = vi.fn();

vi.mock("../db", () => ({
  getLastExtractionAt: (...a: unknown[]) => getLastExtractionAt(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  createMemory: (...a: unknown[]) => createMemory(...a),
  markMemoryExtracted: (...a: unknown[]) => markMemoryExtracted(...a),
  markMemoryAttempted: (...a: unknown[]) => markMemoryAttempted(...a),
  claimMemoryExtraction: (...a: unknown[]) => claimMemoryExtraction(...a),
  releaseMemoryExtraction: (...a: unknown[]) => releaseMemoryExtraction(...a),
}));

const invoke = vi.fn();
vi.mock("../llm", () => ({
  llmService: { invoke: (...a: unknown[]) => invoke(...a) },
}));

import { extractMemories } from "./memory-extract";

/**
 * The memory extraction.
 *
 * Two things are checked here: that the answer is read even when the
 * model writes around it, and that a failure is told apart from an
 * empty answer — because the interface used to show the same thing for
 * both, and a broken extraction looked like a conversation with nothing
 * worth remembering in it.
 */

const NOW = new Date("2026-01-15T12:00:00Z");

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
} as any;

const message = (id: number, content: string) => ({
  id,
  role: id % 2 === 0 ? "user" : "assistant",
  content,
  createdAt: new Date(NOW.getTime() - id * 60_000),
});

beforeEach(() => {
  for (const fn of [
    getLastExtractionAt,
    getMessagesSince,
    getMemoriesByPersonaId,
    createMemory,
    markMemoryExtracted,
    markMemoryAttempted,
    claimMemoryExtraction,
    releaseMemoryExtraction,
    invoke,
  ]) {
    fn.mockReset();
  }
  getLastExtractionAt.mockResolvedValue(null);
  getMessagesSince.mockResolvedValue([message(1, "我最喜欢的颜色是蓝色"), message(2, "那我们去看海吧")]);
  getMemoriesByPersonaId.mockResolvedValue([]);
  createMemory.mockResolvedValue(1);
  markMemoryExtracted.mockResolvedValue(undefined);
  markMemoryAttempted.mockResolvedValue(undefined);
  claimMemoryExtraction.mockResolvedValue(true);
  releaseMemoryExtraction.mockResolvedValue(undefined);
});

describe("the memory extraction", () => {
  it("refuses to run when another extraction is already running", async () => {
    /**
     * The extraction is a read and then a write: the window of
     * messages is read, the model is asked about it, and what it says
     * is stored. Two of them running at once read the same window — so
     * the model was asked the same question twice (the user paid
     * twice), and both stored what they were told, so the same memory
     * was in the panel twice.
     */
    claimMemoryExtraction.mockResolvedValue(false);

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    // The model was not asked.
    expect(invoke).not.toHaveBeenCalled();
    expect(createMemory).not.toHaveBeenCalled();
    // And the interface is told, so it does not say "no new memories" —
    // which is a claim about the conversation, and nothing was looked at.
    expect(result.running).toBe(true);
  });

  it("gives the claim back when the run is over", async () => {
    invoke.mockResolvedValue('[]');

    await extractMemories({ persona, userId: 1, now: NOW });

    expect(releaseMemoryExtraction).toHaveBeenCalledWith(1, 1);
  });

  it("gives the claim back even when the run fails", async () => {
    invoke.mockRejectedValue(new Error("the provider is down"));

    await extractMemories({ persona, userId: 1, now: NOW });

    expect(releaseMemoryExtraction).toHaveBeenCalledWith(1, 1);
  });

  it("reads the answer when the model writes around the array", async () => {
    // The array used to be taken from the first `[` to the last `]`,
    // so a bracket in the prose before it lost the whole answer.
    invoke.mockResolvedValue(
        'Here are the memories [see the notes below]:\n[{"title":"他喜欢蓝色","category":"anchor","subject":"them"}]\nHope that helps!',
    );

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(result.readable).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].title).toBe("他喜欢蓝色");
  });

  it("reads the answer out of a fenced block", async () => {
    invoke.mockResolvedValue('```json\n[{"title":"他喜欢蓝色","category":"anchor","subject":"them"}]\n```');

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(result.readable).toBe(true);
    expect(result.added).toHaveLength(1);
  });

  it("tells an unreadable answer apart from an empty one", async () => {
    // An answer that cannot be read is not an answer of "nothing to
    // remember" — and the two were the same thing, so the window was
    // marked as extracted and those messages were never looked at again.
    invoke.mockResolvedValue("I'm sorry, I can't help with that.");

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(result.readable).toBe(false);
    expect(markMemoryExtracted).not.toHaveBeenCalled();
    // The attempt is recorded, so the next run is not paid for twice.
    expect(markMemoryAttempted).toHaveBeenCalled();
  });

  it("marks the window when the answer says there is nothing", async () => {
    invoke.mockResolvedValue("[]");

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(result.readable).toBe(true);
    expect(result.added).toHaveLength(0);
    expect(markMemoryExtracted).toHaveBeenCalled();
  });

  it("keeps the memories the model returned past the fifth", async () => {
    // The model was asked for five, but the limit was applied to the
    // answer as well — so the last three of eight were dropped without
    // a word.
    const items = Array.from({ length: 8 }, (_, index) => ({
      title: `记忆 ${index + 1}`,
      category: "memory",
      subject: "them",
    }));
    invoke.mockResolvedValue(JSON.stringify(items));

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(result.added).toHaveLength(8);
    expect(result.trimmed).toBe(0);
  });

  it("does not touch the extraction log for an uploaded transcript", async () => {
    invoke.mockResolvedValue('[{"title":"他喜欢蓝色","category":"anchor","subject":"them"}]');

    const result = await extractMemories({
      persona,
      userId: 1,
      now: NOW,
      history: [{ id: 1, role: "user", content: "我最喜欢的颜色是蓝色", createdAt: NOW }],
    });

    expect(result.added).toHaveLength(1);
    // The log records what was read *of the conversation* — and the
    // conversation has not been read.
    expect(markMemoryExtracted).not.toHaveBeenCalled();
  });
});
