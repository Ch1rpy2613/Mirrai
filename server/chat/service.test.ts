import { describe, expect, it, vi, beforeEach } from "vitest";

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

import {
  runConversation,
  composeMessages,
  clampContextLimit,
  clampTemperature,
  clampMaxTokens,
} from "./service";

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

describe("runConversation", () => {
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
    // Nothing has been said yet today.
    hasSafetyEventSince.mockResolvedValue(false);
    touchMemoryRecalled.mockResolvedValue(undefined);
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke: invoke,
      stream: async function* () {
        yield { text: "" };
      },
    });
    invokeWithProvider.mockResolvedValue("在的。");
  });

  it("stores the user's turn and the persona's reply", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(createMessage).toHaveBeenCalledTimes(2);
    const [userCall, assistantCall] = createMessage.mock.calls;
    expect(userCall[0].role).toBe("user");
    expect(userCall[0].content).toBe("在吗");
    expect(assistantCall[0].role).toBe("assistant");
    expect(assistantCall[0].content).toContain("在的。");

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
  });

  it("does not count a turn that failed as a conversation", async () => {
    // A provider that is having a bad day must not walk the user towards
    // the graduation ritual: the message count is one of its gates.
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    // The error is reported.
    expect(events.some((e) => e.type === "error")).toBe(true);
    // The user's turn is still stored — they did send it.
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createMessage.mock.calls[0][0].role).toBe("user");
    // Nothing was counted.
    expect(updatePersona).not.toHaveBeenCalled();
    expect(updateIntimacy).not.toHaveBeenCalled();
    expect(createEmotionSnapshot).not.toHaveBeenCalled();
  });

  it("keeps the half of a reply that arrived before the failure", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在的" };
      throw new Error("the connection dropped");
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    // The user saw the half, so the transcript has to have it — or the
    // next poll would wipe it off the screen.
    const assistantCall = createMessage.mock.calls.find(
      (call: any[]) => call[0].role === "assistant",
    );
    expect(assistantCall?.[0].content).toContain("在的");
    // But it is still not a counted conversation.
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("never calls the model when the message is a crisis", async () => {    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(invokeWithProvider).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(true);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("12356");
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("streams the reply in pieces", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      yield { text: "的" };
    });

    const deltas: string[] = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).toBe("在的");
  });

  it("keeps a partial answer when the model fails mid-stream", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      throw new Error("upstream exploded");
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    const error = events.find((e) => e.type === "error");
    expect(error?.partial).toBe(true);
    // The partial reply is still stored.
    expect(createMessage.mock.calls[1][0].content).toContain("在");
  });

  it("updates the intimacy score and the persona's state", async () => {
    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(updateIntimacy).toHaveBeenCalled();
    expect(updatePersona).toHaveBeenCalled();
  });

  it("hands the resolved provider to the emotion classifier", async () => {
    // The classifier has to run on the same credentials as the reply —
    // otherwise a user who configured their own key falls back to the
    // environment one.
    const providerInstance = {
      name: "UserProvider",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
    };
    resolveProviderForUser.mockResolvedValue(providerInstance);

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(inferEmotionalState).toHaveBeenCalled();
    expect(inferEmotionalState.mock.calls[0][0].providerInstance).toBe(providerInstance);
  });

  it("measures the conversation length from the start of the session", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    // The conversation began three hours ago and has not paused. The old
    // measurement was the gap before the newest message, so it fired for a
    // user who came back after a break and stayed quiet for a five-hour
    // conversation.
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.kind).toBe("long_session");
  });

  it("refuses to talk to a persona that has graduated", async () => {
    // The graduation used to be a badge: the app announced the anniversary
    // of a relationship the user had ended and still let them talk to it.
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ graduationStatus: "graduated" }),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/毕业/);
  });

  it("still talks to a persona the user asked to be left alone", async () => {
    // "Quiet" silences the app, it does not lock the user out.
    const events = [];
    for await (const event of runConversation({
      persona: persona({ presence: "quiet" }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("mentions a worsening trajectory once, in the persona's own voice", async () => {
    // The trajectory used to be assessed, stored, and then ignored — only
    // its "improving" half was ever read.
    getLatestGraduationAssessment.mockResolvedValue({
      createdAt: new Date(),
      trajectory: "worsening",
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我最近不太好",
      mode: "once",
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    const stored = createMessage.mock.calls.find((c) => c[0].role === "assistant");
    expect(stored?.[0].content).toContain("我确实看见了");
  });

  it("gives the care note a translation key and the client's language", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      locale: "en",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.textKey).toBe("safety.care.longSession");
    expect(done?.careNote?.text).toContain("We've been talking");
  });

  it("adds a gentle check-in when the user sounds exhausted", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "今天好累",
      mode: "once",
    })) {
      events.push(event);
    }

    // The model still answers — a weak signal is not a crisis.
    expect(invokeWithProvider).toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(false);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("在的。");
    expect(assistantCall.content).toContain("你刚刚那句话我听见了");
    // No crisis resources.
    expect(assistantCall.content).not.toContain("12356");
  });

  it("runs the turns of one persona one after the other", async () => {
    // Two turns for the same persona used to run at once — the web
    // interface and a chat window, or two tabs. They both read the same
    // history, so the transcript ended up as "user A, user B, reply A,
    // reply B": the reply to A was written without seeing B's message.
    const order: string[] = [];
    invokeWithProvider.mockImplementation(async () => {
      order.push("start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("end");
      return "在的。";
    });

    const first = (async () => {
      for await (const _ of runConversation({
        persona: persona(),
        userId: 1,
        message: "在吗",
        mode: "once",
      })) { /* drain */ }
    })();
    const second = (async () => {
      for await (const _ of runConversation({
        persona: persona(),
        userId: 1,
        message: "在吗",
        mode: "once",
      })) { /* drain */ }
    })();

    await Promise.all([first, second]);

    // The two turns did not overlap.
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("assesses the emotional trajectory and lets it suggest graduation earlier", async () => {
    getMessagesSince.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );
    invoke.mockResolvedValue(
      JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
    );
    // The reply comes first, the trajectory assessment second — both on the
    // provider that was resolved for the user.
    invokeWithProvider
      .mockResolvedValueOnce("在的。")
      .mockResolvedValue(
        JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
      );
    // Nothing stored yet (the throttle check), then the fresh assessment the
    // graduation check reads.
    getLatestGraduationAssessment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        id: 1,
        userId: 1,
        personaId: 1,
        trajectory: "improving",
        regretRatio: 10,
        gratitudeRatio: 80,
        assessment: null,
        windowStart: new Date("2025-12-18T12:00:00Z"),
        windowEnd: new Date("2026-01-15T12:00:00Z"),
        createdAt: new Date("2026-01-15T12:00:00Z"),
      });

    // The count is now read back from the database after the
    // increment, so it is the mock that says what it is.
    incrementChatCount.mockResolvedValue(26);

    const events = [];
    for await (const event of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(createGraduationAssessment).toHaveBeenCalledTimes(1);
    expect(createGraduationAssessment.mock.calls[0][0].trajectory).toBe("improving");

    const done = events.find((e) => e.type === "done");
    expect(done?.graduationSuggested).toBe(true);
  });

  it("does not assess the trajectory again within a day", async () => {
    getLatestGraduationAssessment.mockResolvedValue({
      id: 1,
      userId: 1,
      personaId: 1,
      trajectory: "stable",
      regretRatio: 10,
      gratitudeRatio: 10,
      assessment: null,
      windowStart: new Date("2025-12-18T12:00:00Z"),
      windowEnd: new Date("2026-01-15T12:00:00Z"),
      createdAt: new Date("2026-01-15T11:00:00Z"),
    });

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00Z"),
    })) {
      // drain
    }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });
});

describe("composeMessages", () => {
  beforeEach(() => {
    getDefaultLlmConfig.mockResolvedValue(null);
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getLatestChatSummary.mockResolvedValue(undefined);
    touchMemoryRecalled.mockResolvedValue(undefined);
  });

  it("puts the system prompt first", async () => {
    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain("小A");
  });

  it("includes the retrieved memories", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).toContain("第一次见面");
  });

  it("marks a recalled memory as recalled", async () => {
    // The recall time is what damps a memory that keeps coming up, so a
    // recall has to be recorded — not just scored.
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 42,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(touchMemoryRecalled).toHaveBeenCalledWith(
      42,
      1,
      expect.any(Date),
    );
  });

  it("sends an image message as a multi-part content array", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "[图片]",
        messageType: "image",
        mediaUrl: "https://cdn.example.com/photo.png",
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "看这个",
      contextLimit: 20,
    });

    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "text", text: "[图片]" },
      { type: "image_url", url: "https://cdn.example.com/photo.png" },
    ]);
  });

  it("keeps a text message as a plain string", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "在吗",
        messageType: "text",
        mediaUrl: null,
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[messages.length - 1].content).toBe("在吗");
  });
});

/**
 * The settings that are read as numbers.
 *
 * They were stored as they arrived, so a value that was not a number
 * made the context limit NaN — and `slice(NaN)` is the whole history.
 * Every turn then sent two hundred messages to the provider, the
 * provider answered "context length exceeded", and the bill went up on
 * every turn.
 */
describe("the settings that are read as numbers", () => {
  it("falls back to the default when the value is not a number", () => {
    expect(clampContextLimit(undefined)).toBe(20);
    expect(clampContextLimit("many")).toBe(20);
    expect(clampContextLimit({})).toBe(20);
    expect(clampContextLimit(Number.NaN)).toBe(20);
    expect(clampContextLimit(Number.POSITIVE_INFINITY)).toBe(20);
  });

  it("keeps the context limit within its bounds", () => {
    expect(clampContextLimit(1)).toBe(4);
    expect(clampContextLimit(50)).toBe(50);
    expect(clampContextLimit(100000)).toBe(200);
  });

  it("keeps the temperature within its bounds", () => {
    expect(clampTemperature("warm")).toBe(0.8);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(1.2)).toBe(1.2);
    expect(clampTemperature(9)).toBe(2);
  });

  it("keeps the answer length within its bounds", () => {
    expect(clampMaxTokens("long")).toBe(2000);
    expect(clampMaxTokens(0)).toBe(16);
    expect(clampMaxTokens(800)).toBe(800);
    expect(clampMaxTokens(999999)).toBe(128_000);
  });
});
