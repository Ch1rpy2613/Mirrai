/**
 * Conversation-context compaction.
 *
 * When the history grows past the window, the old turns are summarised into a
 * short 【以往对话摘要】 section instead of being dropped silently. The
 * summarisation is a best-effort step: if it fails, the conversation has to
 * carry on without the summary rather than fail the whole turn.
 *
 * `maybeCompactHistory` is module-private, so the behaviour is observed
 * through the exported `composeMessages`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getMessagesByPersonaId = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const createChatSummary = vi.fn();
const getDefaultLlmConfig = vi.fn();
const touchMemoryRecalled = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
getUserTimezone.mockResolvedValue(null);
    getUserById.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);

vi.mock("../db", () => ({
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
}));

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const streamWithProvider = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: (...a: unknown[]) => streamWithProvider(...a),
  },
}));

const resolveProviderForUser = vi.fn();

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

import { composeMessages } from "./service";

/** A fixed reference point, so the age of a stored summary is deterministic. */
const NOW = new Date(2026, 0, 2, 0, 0, 0);

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前任",
    togetherFrom: "2021-05",
    togetherTo: null,
    personaData: { personality: "温柔" },
    analysisStatus: "ready",
    emotionalState: "warm",
    chatCount: 10,
    intimacyScore: 120,
    intimacyLevel: "familiar",
    graduationStatus: null,
    llmProvider: null,
    activeSceneId: null,
    ...overrides,
  } as any;
}

/** A history of `count` alternating turns, oldest first. */
function history(count: number) {
  const out: Array<{ id: number; role: string; content: string; createdAt: Date }> = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `第 ${i + 1} 条消息`,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    });
  }
  return out;
}

function fakeProvider() {
  return {
    name: "Test",
    isConfigured: () => true,
    capabilities: { streaming: true, vision: false, tools: false, jsonMode: false },
    invoke: invoke,
    stream: async function* () {
      yield { text: "" };
    },
  };
}

describe("composeMessages — history compaction", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const fn of [
      getMessagesByPersonaId,
      getMemoriesByPersonaId,
      getSceneById,
      getLatestChatSummary,
      createChatSummary,
      getDefaultLlmConfig,
      touchMemoryRecalled,
      invoke,
      invokeWithProvider,
      streamWithProvider,
      resolveProviderForUser,
    ]) {
      fn.mockReset();
    }

    getDefaultLlmConfig.mockResolvedValue(null);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getLatestChatSummary.mockResolvedValue(undefined);
    createChatSummary.mockResolvedValue(1);
    touchMemoryRecalled.mockResolvedValue(undefined);
    resolveProviderForUser.mockResolvedValue(fakeProvider());
    invokeWithProvider.mockResolvedValue("他们最近常聊旅行计划。");

    // The degradation path logs a warning; keep the test output readable.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not summarise a short history", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(5));

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).not.toContain("【以往对话摘要】");
    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(createChatSummary).not.toHaveBeenCalled();
  });

  it("summarises a long history and puts the summary in the system prompt", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(30));

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    const systemPrompt = String(messages[0].content);
    expect(systemPrompt).toContain("【以往对话摘要】");
    expect(systemPrompt).toContain("他们最近常聊旅行计划。");
    expect(createChatSummary).toHaveBeenCalledTimes(1);
  });

  it("still composes the conversation when the summarisation fails", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(30));
    invokeWithProvider.mockRejectedValue(new Error("upstream exploded"));

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    // The failure is swallowed: no summary section, but the turn goes on.
    expect(String(messages[0].content)).not.toContain("【以往对话摘要】");
    expect(messages[0].role).toBe("system");
    expect(messages.length).toBe(20);
    expect(messages[messages.length - 1].content).toBe("第 30 条消息");
    expect(createChatSummary).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("still composes the conversation when the provider cannot be resolved", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(30));
    resolveProviderForUser.mockRejectedValue(new Error("no provider configured"));

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).not.toContain("【以往对话摘要】");
    expect(messages.length).toBe(20);
    expect(createChatSummary).not.toHaveBeenCalled();
  });

  it("does not summarise when the summarisation returns nothing", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(30));
    invokeWithProvider.mockResolvedValue("   ");

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).not.toContain("【以往对话摘要】");
    expect(createChatSummary).not.toHaveBeenCalled();
  });

  it("does not summarise again when a recent summary is still fresh", async () => {
    // The summary covers everything up to message 28, so only two messages
    // have arrived since — far below the ten that would justify another
    // model call.
    getMessagesByPersonaId.mockResolvedValue(history(30));
    getLatestChatSummary.mockResolvedValue({
      id: 1,
      personaId: 1,
      userId: 1,
      summary: "上次已经聊到他们最近常聊旅行计划。",
      fromMessageId: 1,
      toMessageId: 28,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
      now: NOW,
    });

    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(createChatSummary).not.toHaveBeenCalled();
    // The existing summary is still injected.
    expect(String(messages[0].content)).toContain("【以往对话摘要】");
    expect(String(messages[0].content)).toContain("上次已经聊到他们最近常聊旅行计划。");
  });

  it("summarises again once ten messages have fallen out of the window", async () => {
    // The window holds the newest nineteen messages, so the eleven
    // oldest have fallen out of it. The previous summary covered only
    // the first of them — so ten are new to it.
    getMessagesByPersonaId.mockResolvedValue(history(30));
    getLatestChatSummary.mockResolvedValue({
      id: 1,
      personaId: 1,
      userId: 1,
      summary: "上次已经聊到他们最近常聊旅行计划。",
      fromMessageId: 1,
      toMessageId: 1,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
      now: NOW,
    });

    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(createChatSummary).toHaveBeenCalledTimes(1);
    // The previous summary is carried forward, not thrown away.
    expect(String(messages[0].content)).toContain("他们最近常聊旅行计划。");
  });

  it("carries the previous summary forward instead of rebuilding it", async () => {
    // The summary is the only carrier of the old conversation. It used
    // to be rebuilt from the sliding window alone, so the oldest
    // summarised content was dropped for ever: the new summary covered
    // only the last hundred and eighty messages, and the first sixty
    // turns of the relationship were in no summary at all.
    getMessagesByPersonaId.mockResolvedValue(history(40));
    getLatestChatSummary.mockResolvedValue({
      id: 1,
      personaId: 1,
      userId: 1,
      summary: "他们第一次一起看的电影是《星际穿越》。",
      fromMessageId: 1,
      toMessageId: 11,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
      now: NOW,
    });

    // The model is given the old summary *and* what has arrived since.
    const sent = invokeWithProvider.mock.calls[0][1] as {
      messages: Array<{ content: string }>;
    };
    const transcript = sent.messages[1].content as string;
    expect(transcript).toContain("他们第一次一起看的电影是《星际穿越》。");
    expect(transcript).toContain("第 12 条消息");

    // And the new summary's range starts where the old one did, so the
    // coverage grows instead of sliding.
    const saved = createChatSummary.mock.calls[0][0];
    expect(saved.fromMessageId).toBe(1);
  });

  it("summarises again once the previous summary is a day old", async () => {
    getMessagesByPersonaId.mockResolvedValue(history(30));
    getLatestChatSummary.mockResolvedValue({
      id: 1,
      personaId: 1,
      userId: 1,
      summary: "上次已经聊到他们最近常聊旅行计划。",
      fromMessageId: 1,
      toMessageId: 1,
      createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });

    await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
      now: NOW,
    });

    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(createChatSummary).toHaveBeenCalledTimes(1);
  });
});
