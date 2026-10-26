import { describe, expect, it, vi, beforeEach } from "vitest";

const getMemoriesByPersonaId = vi.fn();
const getLatestChatSummary = vi.fn();
const retrieveMemories = vi.fn();
const resolveProviderForUser = vi.fn();
const invoke = vi.fn();

const getRelationshipEvents = vi.fn();

vi.mock("./db", () => ({
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
}));

vi.mock("./chat/retrieval", () => ({
  retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  formatMemoriesForPrompt: (memories: any[]) =>
    memories.map((m) => `【相关记忆】${m.title}`).join("\n"),
  formatAnchorsForPrompt: (memories: any[]) =>
    memories.map((m) => `【锚点记忆】${m.title}`).join("\n"),
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  /**
   * The ownership matters: the environment-configured provider is the
   * operator's account, and it may only be used when the user has no
   * provider of their own. A provider that came back is the user's own.
   */
  resolveProviderForUserWithOwnership: async (params: unknown) => {
    const provider = await resolveProviderForUser(params as any);
    return { provider, owned: Boolean(provider) };
  },
}));

vi.mock("./llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (provider: any, params: any) =>
      provider?.invoke?.(params?.messages, params?.options) ?? Promise.resolve(""),
  },
}));

import { buildFarewellPrompt, fallbackFarewellLetter, writeFarewellLetter } from "./chat/farewell";

/**
 * The farewell letter.
 *
 * It is the one artefact the graduation mechanism produces, and it used to
 * be written by a persona that had forgotten everything — no memories, no
 * anchors, no summary — so every farewell came out in the same words. And
 * it was written with the server's provider, so a user who had configured
 * their own key got an error at the one moment the product exists for.
 */
function persona(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前女友",
    togetherFrom: "2021-06-15",
    togetherTo: null,
    emotionalState: "warm",
    llmProvider: null,
    personaData: { personality: "温柔", speakingStyle: "口语" },
    ...overrides,
  } as any;
}

describe("buildFarewellPrompt", () => {
  beforeEach(() => {
    getMemoriesByPersonaId.mockReset();
    getLatestChatSummary.mockReset();
    retrieveMemories.mockReset();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    retrieveMemories.mockResolvedValue([]);
  });

  it("puts the milestones into the letter's context", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      { id: 1, title: "第一次一起看海", category: "milestone", description: "在青岛" },
    ]);
    retrieveMemories.mockResolvedValue([
      { id: 1, title: "第一次一起看海", category: "milestone" },
    ]);

    const result = await buildFarewellPrompt({ persona: persona(), userId: 1 });

    expect(result.memoryCount).toBe(1);
    expect(result.systemPrompt).toContain("第一次一起看海");
    expect(result.userPrompt).toContain("小A");
  });

  it("asks for the letter in the persona's own voice", async () => {
    const result = await buildFarewellPrompt({ persona: persona(), userId: 1 });
    expect(result.userPrompt).toContain("小A");
    expect(result.userPrompt).toMatch(/200-400/);
  });

  it("writes an English letter for an English user", async () => {
    const result = await buildFarewellPrompt({
      persona: persona(),
      userId: 1,
      locale: "en",
    });
    expect(result.userPrompt).toMatch(/farewell letter/i);
    expect(result.userPrompt).toMatch(/200 and 400/);
  });
});

describe("writeFarewellLetter", () => {
  beforeEach(() => {
    getMemoriesByPersonaId.mockReset();
    getLatestChatSummary.mockReset();
    retrieveMemories.mockReset();
    resolveProviderForUser.mockReset();
    invoke.mockReset();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    retrieveMemories.mockResolvedValue([]);
  });

  it("uses the user's own provider when there is one", async () => {
    resolveProviderForUser.mockResolvedValue({
      invoke: vi.fn().mockResolvedValue("用户的供应商写的信"),
    });

    const letter = await writeFarewellLetter({ persona: persona(), userId: 1 });

    expect(letter).toBe("用户的供应商写的信");
    expect(resolveProviderForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to the server's provider when the user has none", async () => {
    resolveProviderForUser.mockResolvedValue(undefined);
    invoke.mockResolvedValue("服务器供应商写的信");

    const letter = await writeFarewellLetter({ persona: persona(), userId: 1 });

    expect(letter).toBe("服务器供应商写的信");
    expect(invoke).toHaveBeenCalled();
  });

  it("still writes a letter when every provider fails", async () => {
    // The user has already said goodbye. A broken provider must not undo
    // the ritual.
    resolveProviderForUser.mockRejectedValue(new Error("no key"));
    invoke.mockRejectedValue(new Error("no key either"));

    const letter = await writeFarewellLetter({ persona: persona(), userId: 1 });

    expect(letter).toContain("小A");
    expect(letter.length).toBeGreaterThan(20);
  });

  it("still writes a letter when the provider returns nothing", async () => {
    resolveProviderForUser.mockResolvedValue({
      invoke: vi.fn().mockResolvedValue("   "),
    });

    const letter = await writeFarewellLetter({ persona: persona(), userId: 1 });

    expect(letter).toContain("小A");
  });

  it("speaks in the persona's voice in the fallback letter", () => {
    const letter = fallbackFarewellLetter(persona());
    expect(letter).toContain("小A");
    expect(letter).not.toContain("Error");
  });
});
