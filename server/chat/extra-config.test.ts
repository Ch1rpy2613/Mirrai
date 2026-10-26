import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The provider's own settings, on the way out.
 *
 * The temperature and the answer length were checked when they were
 * written through one of the two write paths — and the read path did
 * not check them at all. So a row that held a word instead of a number
 * sent that word to the provider, which answered with a 400, and the
 * interface said "the reply failed".
 *
 * The second write path (`llmConfig.upsert`) did not check them either,
 * so the word could get into the row in the first place.
 */

const createMessage = vi.fn();
const getDefaultLlmConfig = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const updatePersona = vi.fn();
const incrementChatCount = vi.fn();
const getPersonaById = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const createChatSummary = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const createGraduationAssessment = vi.fn();
const getMessagesSince = vi.fn();
const touchMemoryRecalled = vi.fn();
const createSafetyEvent = vi.fn();
const hasSafetyEventSince = vi.fn();
const getLastMessageAt = vi.fn();
const getMessageCountSince = vi.fn();
const getDailyChatCounts = vi.fn();
const getSessionStartAt = vi.fn();
const getUserMessageCountSince = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();
const getDailyUserChatCounts = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();

vi.mock("../db", () => ({
  createMessage: (...a: unknown[]) => createMessage(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
  hasSafetyEventSince: (...a: unknown[]) => hasSafetyEventSince(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getMessageCountSince: (...a: unknown[]) => getMessageCountSince(...a),
  getDailyChatCounts: (...a: unknown[]) => getDailyChatCounts(...a),
  getSessionStartAt: (...a: unknown[]) => getSessionStartAt(...a),
  getUserMessageCountSince: (...a: unknown[]) => getUserMessageCountSince(...a),
  getUserMessageCountForPersonaSince: (...a: unknown[]) => getUserMessageCountForPersonaSince(...a),
  getDailyUserChatCounts: (...a: unknown[]) => getDailyUserChatCounts(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
}));

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const streamWithProvider = vi.fn();
const resolveProviderForUser = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: (...a: unknown[]) => streamWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

const inferEmotionalState = vi.fn();

vi.mock("../_core/emotion", () => ({
  inferEmotionalState: (...a: unknown[]) => inferEmotionalState(...a),
}));

import { runConversation, sanitizeExtraConfig } from "./service";

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
    presence: "active",
    ...overrides,
  } as any;
}

async function talkOnce() {
  for await (const _event of runConversation({
    persona: persona(),
    userId: 1,
    message: "在吗",
    mode: "once",
  })) {
    // drain
  }
}

describe("the provider settings, on the way out", () => {
  beforeEach(() => {
    for (const fn of [
      createMessage, getDefaultLlmConfig, getTodaySnapshot, createEmotionSnapshot,
      getIntimacyData, updateIntimacy, updatePersona, getPersonaById,
      getMessagesByPersonaId, getMemoriesByPersonaId, getFilesByPersonaId, getSceneById,
      getLatestChatSummary, createChatSummary, getRecentEmotionTrend,
      getMessageCountInRange, setGraduationStatus, getLatestGraduationAssessment,
      createGraduationAssessment, getMessagesSince, touchMemoryRecalled, createSafetyEvent,
      getLastMessageAt, getMessageCountSince, getDailyChatCounts,
      getSessionStartAt, getUserMessageCountSince, getDailyUserChatCounts, hasSafetyEventSince,
      invoke, invokeWithProvider,
      streamWithProvider, resolveProviderForUser, inferEmotionalState,
    ]) {
      fn.mockReset();
    }

    getDefaultLlmConfig.mockResolvedValue(null);
    getTodaySnapshot.mockResolvedValue(undefined);
    getIntimacyData.mockResolvedValue({
      chatCount: 10, totalMessages: 20, memoryCount: 3,
      emotionVariety: 3, daysSinceCreation: 100, consecutiveDays: 2,
    });
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getLatestChatSummary.mockResolvedValue(undefined);
    getRecentEmotionTrend.mockResolvedValue([]);
    getMessageCountInRange.mockResolvedValue(0);
    getLatestGraduationAssessment.mockResolvedValue(undefined);
    createGraduationAssessment.mockResolvedValue(1);
    getMessagesSince.mockResolvedValue([]);
    getLastMessageAt.mockResolvedValue(new Date());
    getMessageCountSince.mockResolvedValue(1);
    getDailyChatCounts.mockResolvedValue([]);
    getSessionStartAt.mockResolvedValue(new Date());
    getUserTimezone.mockResolvedValue(null);
    getUserById.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    getUserMessageCountSince.mockResolvedValue(1);
    getUserMessageCountForPersonaSince.mockResolvedValue(1);
    getDailyUserChatCounts.mockResolvedValue([]);
    createMessage.mockResolvedValue(99);
    createSafetyEvent.mockResolvedValue(1);
    hasSafetyEventSince.mockResolvedValue(false);
    touchMemoryRecalled.mockResolvedValue(undefined);
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
      stream: async function* () {
        yield { text: "" };
      },
    });
    invokeWithProvider.mockResolvedValue("在的。");
  });

  it("does not send a temperature that is not a number to the provider", async () => {
    getDefaultLlmConfig.mockResolvedValue({
      extraConfig: { temperature: "hot", maxTokens: "lots" },
    });

    await talkOnce();

    const options = invokeWithProvider.mock.calls[0][1].options;
    expect(options.temperature).toBe(0.8);
    expect(options.maxTokens).toBe(2000);
  });

  it("keeps the answer length within its ceiling", async () => {
    getDefaultLlmConfig.mockResolvedValue({
      extraConfig: { temperature: 1.5, maxTokens: 999_999 },
    });

    await talkOnce();

    const options = invokeWithProvider.mock.calls[0][1].options;
    expect(options.temperature).toBe(1.5);
    expect(options.maxTokens).toBe(128_000);
  });

  it("leaves a setting the user never made alone", async () => {
    getDefaultLlmConfig.mockResolvedValue({ extraConfig: {} });

    await talkOnce();

    const options = invokeWithProvider.mock.calls[0][1].options;
    // The provider's own default is the right answer for a setting that
    // was never made. `Number(null)` is 0, which would have meant an
    // answer with no variation in it.
    expect(options.temperature).toBeUndefined();
    expect(options.maxTokens).toBeUndefined();
  });

  it("checks the settings that are read as numbers", () => {
    expect(sanitizeExtraConfig({ temperature: "hot" }).temperature).toBe(0.8);
    expect(sanitizeExtraConfig({ temperature: 9 }).temperature).toBe(2);
    expect(sanitizeExtraConfig({ temperature: -1 }).temperature).toBe(0);
    expect(sanitizeExtraConfig({ maxTokens: 0 }).maxTokens).toBe(16);
    expect(sanitizeExtraConfig({ maxTokens: 999_999 }).maxTokens).toBe(128_000);
    expect(sanitizeExtraConfig({ contextLimit: 100_000 }).contextLimit).toBe(200);
    expect(sanitizeExtraConfig({ contextLimit: 1 }).contextLimit).toBe(4);
  });

  it("keeps the settings it does not know about", () => {
    const out = sanitizeExtraConfig({ retrievalK: 12, topP: 0.9, temperature: "hot" });
    expect(out.retrievalK).toBe(12);
    expect(out.topP).toBe(0.9);
    expect(out.temperature).toBe(0.8);
  });

  it("does not turn a setting that was never made into a number", () => {
    expect("temperature" in sanitizeExtraConfig({ temperature: null })).toBe(false);
    expect("temperature" in sanitizeExtraConfig({})).toBe(false);
    expect("maxTokens" in sanitizeExtraConfig({ maxTokens: undefined })).toBe(false);
  });
});
