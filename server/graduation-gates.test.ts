import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The graduation gates.
 *
 * The product promises that graduation is always a suggestion and never a
 * decision the user did not make. These tests are about the three modes
 * and the four places that enforce them:
 *
 *   the per-turn assessment  — whether the app may raise the topic
 *   the check query          — what the interface is told
 *   the graduation mutation  — whether a farewell letter may be written
 *   the slash command        — the same decision, on a chat channel
 */

const setGraduationStatus = vi.fn();
const getPersonaById = vi.fn();
const getUserById = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const invoke = vi.fn();

vi.mock("./db", () => ({
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
  getMessagesByPersonaId: vi.fn().mockResolvedValue([]),
  getSceneById: vi.fn().mockResolvedValue(null),
  getLatestChatSummary: vi.fn().mockResolvedValue(null),
  getDefaultLlmConfig: vi.fn().mockResolvedValue(null),
  updatePersona: vi.fn(),
  createMessage: vi.fn(),
  createSafetyEvent: vi.fn().mockResolvedValue(undefined),
  createEmotionSnapshot: vi.fn(),
  getTodaySnapshot: vi.fn().mockResolvedValue(null),
  getIntimacyData: vi.fn().mockResolvedValue({}),
  updateIntimacy: vi.fn(),
  getLastMessageAt: vi.fn().mockResolvedValue(null),
  getSkillJobById: vi.fn(),
  updateSkillJob: vi.fn(),
  createSkillJob: vi.fn(),
}));

vi.mock("./llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
}));

import { appRouter } from "./routers";
import { evaluateGraduation } from "./chat/service";
import type { TrpcContext } from "./_core/context";

/** A persona that meets every hard threshold. */
function eligiblePersona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: null,
    togetherFrom: null,
    togetherTo: null,
    personaData: null,
    analysisStatus: "ready",
    analysisProgress: 100,
    analysisMessage: null,
    emotionalState: "warm",
    chatCount: 100,
    lastChatAt: null,
    skillJobId: null,
    llmProvider: null,
    intimacyScore: 1000,
    intimacyLevel: "soulmate",
    activeSceneId: null,
    source: "upload",
    remindersEnabled: true,
    correctionLog: null,
    graduationStatus: null,
    graduatedAt: null,
    farewellLetter: null,
    graduationMode: null,
    distillationMode: null,
    graduationSuggestedAt: null,
    graduationDeclinedAt: null,
    presence: "active",
    timezone: null,
    locale: "zh",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

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

beforeEach(() => {
  for (const fn of [
    setGraduationStatus, getPersonaById, getUserById, getRecentEmotionTrend,
    getMessageCountInRange, getLatestGraduationAssessment, invoke,
  ]) {
    fn.mockReset();
  }
  // Everything the hard thresholds look at says "eligible".
  getRecentEmotionTrend.mockResolvedValue(
    Array.from({ length: 10 }, () => ({ emotionalState: "happy" })),
  );
  getMessageCountInRange.mockResolvedValue(20);
  getLatestGraduationAssessment.mockResolvedValue(null);
  getUserById.mockResolvedValue({ id: 1, graduationMode: "suggest" });
  invoke.mockResolvedValue("亲爱的，这是一封告别信。");
});

describe("the per-turn graduation assessment", () => {
  const params = { personaId: 1, userId: 1, intimacyLevel: "soulmate", chatCount: 100 };

  it("suggests a graduation when the mode allows it", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona());
    const persona = eligiblePersona();

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(true);
    expect(setGraduationStatus).toHaveBeenCalledWith(1, 1, "suggested");
  });

  it("stays silent when the persona's own mode is manual", async () => {
    const persona = eligiblePersona({ graduationMode: "manual" });

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(false);
    // Nothing was written: the app did not even decide to ask.
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("stays silent when the user's default is manual and the persona has none", async () => {
    getUserById.mockResolvedValue({ id: 1, graduationMode: "manual" });
    const persona = eligiblePersona();

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(false);
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("stays silent when the mode is off", async () => {
    const persona = eligiblePersona({ graduationMode: "off" });

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(false);
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("stays silent when the user asked for some space", async () => {
    // "Quiet" is the user asking for space. A farewell is not something to
    // raise with someone who asked to be left alone.
    const persona = eligiblePersona({ presence: "quiet" });

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(false);
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("stays silent when the offer was just made", async () => {
    // The suggestion used to be made on every turn, because the branch
    // that produced it never recorded that it had.
    const persona = eligiblePersona({
      graduationStatus: "suggested",
      graduationSuggestedAt: new Date(),
    });

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(false);
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("offers again once the cooldown has passed", async () => {
    const persona = eligiblePersona({
      graduationStatus: "declined",
      graduationDeclinedAt: new Date(Date.now() - 30 * 86_400_000),
    });

    const suggested = await evaluateGraduation({ ...params, persona });

    expect(suggested).toBe(true);
  });
});

describe("the graduation check query", () => {
  it("reports the thresholds in the default mode", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona());
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.persona.checkGraduation({ id: 1 });

    expect(result.eligible).toBe(true);
    // A query does not write. It used to mark the persona as
    // "suggested" — which is a `GET`, so a link prefetch or a crawler
    // could trigger it, and the mark starts a seven-day cooldown.
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("explains that the mode is manual", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona({ graduationMode: "manual" }));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.persona.checkGraduation({ id: 1 });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("已设置为仅手动");
    // The thresholds were not consulted, so nothing was written.
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("explains that the mode is off", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona({ graduationMode: "off" }));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.persona.checkGraduation({ id: 1 });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("毕业模式已关闭");
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });
});

describe("the graduation mutation", () => {
  it("writes the farewell letter in the default mode", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona());
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.persona.graduate({ id: 1 });

    expect(result.farewellLetter).toBe("亲爱的，这是一封告别信。");
    // The flag says whether the letter is the full two-pass one or the
    // single-pass fallback. In this test the model cannot run the two
    // passes, so the fallback is what is written — and the flag says so,
    // so the interface can tell the reader which one they are looking at.
    // The last argument is the draft — which lines the second pass kept
    // and which it cut. The single-pass fallback has no draft, so it is
    // empty.
    expect(setGraduationStatus).toHaveBeenCalledWith(
      1, 1, "graduated", "亲爱的，这是一封告别信。", true, undefined,
    );
    expect(result.degraded).toBe(true);
  });

  it("writes the letter in the manual mode — the user asked for it", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona({ graduationMode: "manual" }));
    const caller = appRouter.createCaller(makeCtx());

    const result = await caller.persona.graduate({ id: 1 });

    expect(result.farewellLetter).toBe("亲爱的，这是一封告别信。");
    expect(setGraduationStatus).toHaveBeenCalled();
  });

  it("refuses when the mode is off", async () => {
    getPersonaById.mockResolvedValue(eligiblePersona({ graduationMode: "off" }));
    const caller = appRouter.createCaller(makeCtx());

    await expect(caller.persona.graduate({ id: 1 })).rejects.toThrow(/毕业模式已关闭/);
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });
});
