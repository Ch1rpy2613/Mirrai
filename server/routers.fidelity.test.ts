import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The new endpoints, and who is allowed to reach them.
 *
 * These are the procedures that let a user read a persona's rules, its
 * timing, its measurements — and its own words that were only ever said
 * to the persona. Every one of them touches private data, so the
 * ownership check is not a detail: it is the whole reason the endpoint
 * exists in a safe form.
 *
 * The tests below are mostly about the refusal. A feature that leaks
 * somebody else's letters is worse than a feature that does not exist.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const getEvalCases = vi.fn();
const saveEvalCases = vi.fn();
const saveEvalRun = vi.fn();
const getLatestEvalRun = vi.fn();
const getOutboundLetters = vi.fn();
const createOutboundLetter = vi.fn();
const setOutboundLetterStatus = vi.fn();
const updateOutboundLetterText = vi.fn();
const markOutboundLetterStaleNotified = vi.fn();
const getPersonaBehaviorProfile = vi.fn();
const setPersonaBehaviorProfile = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getMessagesByPersonaIdPaged = vi.fn();
const invoke = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  getEvalCases: (...a: unknown[]) => getEvalCases(...a),
  saveEvalCases: (...a: unknown[]) => saveEvalCases(...a),
  saveEvalRun: (...a: unknown[]) => saveEvalRun(...a),
  getLatestEvalRun: (...a: unknown[]) => getLatestEvalRun(...a),
  getOutboundLetters: (...a: unknown[]) => getOutboundLetters(...a),
  createOutboundLetter: (...a: unknown[]) => createOutboundLetter(...a),
  setOutboundLetterStatus: (...a: unknown[]) => setOutboundLetterStatus(...a),
  updateOutboundLetterText: (...a: unknown[]) => updateOutboundLetterText(...a),
  markOutboundLetterStaleNotified: (...a: unknown[]) => markOutboundLetterStaleNotified(...a),
  getPersonaBehaviorProfile: (...a: unknown[]) => getPersonaBehaviorProfile(...a),
  setPersonaBehaviorProfile: (...a: unknown[]) => setPersonaBehaviorProfile(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMessagesByPersonaIdPaged: (...a: unknown[]) => getMessagesByPersonaIdPaged(...a),
  getLatestChatSummary: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue({ id: 1, name: "测试" }),
  getRecentUserMood: vi.fn().mockResolvedValue(null),
  getRelationshipEvents: vi.fn().mockResolvedValue([]),
  retrieveMemories: vi.fn().mockResolvedValue([]),
  getDefaultLlmConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock("./llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForUser: async () => ({
    name: "test",
    isConfigured: () => true,
    invoke: (...a: unknown[]) => invoke(...a),
  }),
  /**
   * The ownership matters: the environment-configured provider is the
   * operator's account, and it may only be used when the user has no
   * provider of their own. A provider that came back is the user's own.
   */
  resolveProviderForUserWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      username: "test-user",
      passwordHash: null,
      openId: "test-open-id",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      graduationMode: "suggest",
      timezone: null,
      locale: "zh",
      addressStyle: null,
      boundaries: null,
      trajectoryAssessment: "auto",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

/** A persona that belongs to user 1. */
function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: null,
    togetherFrom: null,
    togetherTo: null,
    personaData: {
      personality: "温柔",
      speakingStyle: "短句",
      microRules: [
        {
          id: "r1",
          trigger: ["随便你"],
          meaning: "她真的生气了",
          rendering: "更短、更冷",
          confidence: 1,
          source: "manual",
          verified: true,
          evidence: [],
        },
      ],
      imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }],
    },
    analysisStatus: "ready",
    analysisProgress: 100,
    emotionalState: "warm",
    timezone: "Asia/Shanghai",
    ...overrides,
  } as any;
}

beforeEach(() => {
  for (const fn of [
    getPersonaById,
    updatePersona,
    getCollectedMessagesForPersona,
    getEvalCases,
    saveEvalCases,
    saveEvalRun,
    getLatestEvalRun,
    getOutboundLetters,
    createOutboundLetter,
    setOutboundLetterStatus,
    updateOutboundLetterText,
    markOutboundLetterStaleNotified,
    getPersonaBehaviorProfile,
    setPersonaBehaviorProfile,
    getMessagesByPersonaId,
    invoke,
  ]) {
    fn.mockReset();
  }
  getPersonaById.mockResolvedValue(persona());
  updatePersona.mockResolvedValue(undefined);
  getCollectedMessagesForPersona.mockResolvedValue([]);
  getEvalCases.mockResolvedValue([]);
  // The real helper returns how many cases it stored.
  saveEvalCases.mockImplementation(
    async (_personaId: number, _userId: number, cases: unknown[]) => cases.length,
  );
  saveEvalRun.mockResolvedValue(1);
  getLatestEvalRun.mockResolvedValue(null);
  getOutboundLetters.mockResolvedValue([]);
  createOutboundLetter.mockResolvedValue(1);
  setOutboundLetterStatus.mockResolvedValue(true);
  updateOutboundLetterText.mockResolvedValue(true);
  markOutboundLetterStaleNotified.mockResolvedValue(undefined);
  getPersonaBehaviorProfile.mockResolvedValue(null);
  getMessagesByPersonaId.mockResolvedValue([]);
  getMessagesByPersonaIdPaged.mockResolvedValue([]);
  invoke.mockResolvedValue("嗯嗯");
});

describe("the rules", () => {
  it("reads the rules of a persona the user owns", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.microRule.list({ personaId: 1 });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].trigger).toEqual(["随便你"]);
  });

  it("refuses a persona the user does not own", async () => {
    getPersonaById.mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.microRule.list({ personaId: 1 })).rejects.toThrow();
  });

  it("mines new candidates from the records", async () => {
    // Two of her lines that differ by one character — the smallest
    // contrast there is, and the one a paragraph cannot carry.
    getCollectedMessagesForPersona.mockResolvedValue([
      { id: 1, role: "assistant", content: "随便你", timestamp: new Date("2025-03-01T12:00:00Z") },
      { id: 2, role: "assistant", content: "随便", timestamp: new Date("2025-03-01T12:10:00Z") },
    ]);
    invoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "她真的生气了",
            rendering: "更短、更冷",
            evidence: [{ snippet: "随便", at: "2025-03-01" }],
          },
        ],
      }),
    );
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.microRule.mine({ personaId: 1, locale: "zh" });
    expect(result.rules.length).toBeGreaterThan(0);
    // A mined rule is a candidate: it does not take effect until the
    // user has looked at it.
    expect(result.rules[0].verified).toBe(false);
  });

  it("writes the rules into the persona's own data", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.microRule.save({
      personaId: 1,
      rules: [
        {
          trigger: ["嗯"],
          meaning: "在听",
          rendering: "回一个嗯",
          confidence: 1,
          source: "manual",
          verified: true,
          evidence: [],
        },
      ],
    });
    expect(updatePersona).toHaveBeenCalled();
    const written = (updatePersona.mock.calls[0][2] as any).personaData;
    expect(written.microRules).toHaveLength(1);
    // The rest of the persona is not disturbed.
    expect(written.personality).toBe("温柔");
  });

  it("replaces the rules rather than merging them", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.microRule.save({ personaId: 1, rules: [] });
    const written = (updatePersona.mock.calls[0][2] as any).personaData;
    expect(written.microRules).toEqual([]);
  });
});

describe("the per-state imperfection", () => {
  it("shows the stored profile and the complete picture", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.imperfection.get({ personaId: 1, locale: "zh" });
    expect(result.stored).toHaveLength(1);
    // The merged view is complete, so the user sees all six states.
    expect(result.merged).toHaveLength(6);
  });

  it("writes it back", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.imperfection.save({
      personaId: 1,
      profile: [{ state: "distant", deviations: ["极短句"] }],
    });
    const written = (updatePersona.mock.calls[0][2] as any).personaData;
    expect(written.imperfectionProfile).toHaveLength(1);
  });

  it("refuses a persona the user does not own", async () => {
    getPersonaById.mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.imperfection.save({ personaId: 1, profile: [] }),
    ).rejects.toThrow();
  });
});

describe("the behaviour profile", () => {
  it("reads it", async () => {
    getPersonaBehaviorProfile.mockResolvedValue({
      replyGapMedianSec: 45,
      replyGapLogSigma: 0.6,
      burstSizes: [1],
      proactiveRate: 0.1,
      activeHours: [9],
      samples: 30,
    });
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.behavior.get({ personaId: 1 });
    expect(result.profile?.replyGapMedianSec).toBe(45);
  });

  it("measures it from the records and saves it", async () => {
    const records: any[] = [];
    for (let i = 0; i < 10; i++) {
      records.push({ id: i * 2, role: "user", content: `问题 ${i}`, timestamp: new Date(Date.now() - i * 60000) });
      records.push({ id: i * 2 + 1, role: "assistant", content: `回答 ${i}`, timestamp: new Date(Date.now() - i * 60000 + 20000) });
    }
    getCollectedMessagesForPersona.mockResolvedValue(records);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.behavior.measure({ personaId: 1 });
    expect(result.profile).not.toBeNull();
    expect(result.profile?.samples).toBeGreaterThan(0);
  });

  it("is null when nothing has been measured", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.behavior.get({ personaId: 1 });
    expect(result.profile).toBeNull();
  });
});

describe("the ruler", () => {
  it("cuts the cases out of the imported records", async () => {
    getCollectedMessagesForPersona.mockResolvedValue([
      { id: 1, role: "user", content: "在吗", timestamp: new Date("2025-03-01T12:00:00Z") },
      { id: 2, role: "assistant", content: "在的", timestamp: new Date("2025-03-01T12:00:20Z") },
      { id: 3, role: "user", content: "今天好累", timestamp: new Date("2025-03-01T12:02:00Z") },
      { id: 4, role: "assistant", content: "怎么了", timestamp: new Date("2025-03-01T12:02:30Z") },
      { id: 5, role: "user", content: "没什么", timestamp: new Date("2025-03-01T12:03:00Z") },
      { id: 6, role: "assistant", content: "嗯嗯", timestamp: new Date("2025-03-01T12:03:10Z") },
    ]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.eval.buildCases({ personaId: 1 });
    expect(result.saved).toBeGreaterThan(0);
    expect(saveEvalCases).toHaveBeenCalled();
  });

  it("has nothing to cut when there are no records", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.eval.buildCases({ personaId: 1 });
    expect(result.saved).toBe(0);
  });

  it("refuses a persona the user does not own", async () => {
    getPersonaById.mockResolvedValue(null);
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.eval.buildCases({ personaId: 1 })).rejects.toThrow();
  });

  it("lists the cases that are currently held out", async () => {
    getEvalCases.mockResolvedValue([{ id: 1, contextJson: [], expectedJson: {} }]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.eval.listCases({ personaId: 1 });
    expect(result.cases).toHaveLength(1);
    expect(getEvalCases).toHaveBeenCalledWith(1, 1);
  });

  it("reports the last run", async () => {
    getLatestEvalRun.mockResolvedValue({ id: 3, metricsJson: { overlap: 0.3 } });
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.eval.latest({ personaId: 1 });
    expect(result.run?.id).toBe(3);
  });

  /** A handful of records, enough for there to be something to measure. */
  function records() {
    return [
      { id: 1, role: "user", content: "在吗", timestamp: new Date("2025-03-01T12:00:00Z") },
      { id: 2, role: "assistant", content: "在的", timestamp: new Date("2025-03-01T12:00:20Z") },
      { id: 3, role: "user", content: "今天好累", timestamp: new Date("2025-03-01T12:02:00Z") },
      { id: 4, role: "assistant", content: "怎么了", timestamp: new Date("2025-03-01T12:02:30Z") },
      { id: 5, role: "user", content: "没什么", timestamp: new Date("2025-03-01T12:03:00Z") },
      { id: 6, role: "assistant", content: "嗯嗯", timestamp: new Date("2025-03-01T12:03:10Z") },
    ];
  }

  it("measures the cases that are already stored", async () => {
    // The stored cases are the 标答. If a run cut a fresh set every
    // time, it would measure a different question each time, and the
    // comparison with the last run would be between two different
    // things.
    getEvalCases.mockResolvedValue([
      {
        id: 1,
        contextJson: [{ role: "user", content: "在吗", timestamp: null }],
        expectedJson: { role: "assistant", content: "在的", timestamp: null },
        expectedState: null,
      },
    ]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.eval.run({ personaId: 1 });
    expect(result.metrics.cases).toBe(1);
  });

  it("keeps the run, so there is a last run to compare against", async () => {
    getCollectedMessagesForPersona.mockResolvedValue(records());
    const caller = appRouter.createCaller(makeCtx());
    await caller.eval.run({ personaId: 1 });
    expect(saveEvalRun).toHaveBeenCalled();
  });

  it("records which version of the persona was measured", async () => {
    // A run with the rules off is a different persona and must not be
    // compared against a run with them on.
    getCollectedMessagesForPersona.mockResolvedValue(records());
    const caller = appRouter.createCaller(makeCtx());
    await caller.eval.run({ personaId: 1, variant: "withoutRules" });
    const saved = saveEvalRun.mock.calls[0][2] as any;
    expect(saved.variant).toBe("withoutRules");
  });

  it("says so when there is nothing to measure", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.eval.run({ personaId: 1 })).rejects.toThrow(/标答/);
  });
});

describe("the way out", () => {
  it("lists only this user's letters", async () => {
    getOutboundLetters.mockResolvedValue([]);
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.list({ personaId: 1 });
    expect(getOutboundLetters).toHaveBeenCalledWith(1, 1);
  });

  it("does not add the same sentence twice", async () => {
    // The second "找一找" finds the line again; it must not be offered
    // again, because the conversation has not changed.
    getOutboundLetters.mockResolvedValue([
      { id: 5, sourceMessageId: 42, text: "我害怕你离开我", status: "ready" },
    ]);
    getMessagesByPersonaIdPaged.mockResolvedValue([
      { id: 42, role: "user", content: "我害怕你离开我", createdAt: new Date() },
    ]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.outbound.collect({ personaId: 1 });
    expect(result.saved).toBe(0);
    expect(createOutboundLetter).not.toHaveBeenCalled();
  });

  it("does not claim success for a letter that is not there", async () => {
    // The procedure answers "done" only when it actually changed
    // something. A success for a letter that does not exist is a small
    // lie, and the interface would show it.
    setOutboundLetterStatus.mockResolvedValue(false);
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.outbound.markSent({ id: 999 })).rejects.toThrow();
  });

  it("records that the user said it", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.markSent({ id: 7 });
    expect(setOutboundLetterStatus).toHaveBeenCalledWith(7, 1, "sent");
  });

  it("gives a letter somewhere to go when the other person is not there", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.keepForSelf({ id: 7 });
    expect(setOutboundLetterStatus).toHaveBeenCalledWith(7, 1, "self");
  });

  it("records a refusal rather than deleting", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.drop({ id: 7 });
    expect(setOutboundLetterStatus).toHaveBeenCalledWith(7, 1, "dropped");
  });

  it("records that the reminder was said, so it is not said again", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.markStaleNotified({ id: 7 });
    expect(markOutboundLetterStaleNotified).toHaveBeenCalledWith(7, 1);
  });

  it("scopes the write to the user who owns it", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.outbound.updateText({ id: 7, text: "改过的句子" });
    expect(updateOutboundLetterText).toHaveBeenCalledWith(7, 1, "改过的句子");
  });
});
