import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The persona's own fields, and the writes that touch them.
 *
 * They are one JSON column. So every write to them is a read of the
 * whole column, a change to one part of it, and a write of the whole
 * column back — and two of those that overlap lose one of the two
 * changes.
 *
 * The mining and the saving of the rules shared a lock; the
 * correction and the imperfection profile had none. So mining the rules
 * while the user saved an imperfection profile wrote the profile away,
 * and the user was told it had been saved.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();
const getCollectedMessagesForPersonaRows = vi.fn();
const appendPersonaCorrection = vi.fn();
const updateSkillJob = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getCollectedMessagesForPersonaRows: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  appendPersonaCorrection: (...a: unknown[]) => appendPersonaCorrection(...a),
  updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
}));

const mineMicroRules = vi.fn();

vi.mock("./skill-engine/micro-rules", () => ({
  mineMicroRules: (...a: unknown[]) => mineMicroRules(...a),
}));

const applyPersonaCorrection = vi.fn();

vi.mock("./skill-engine/correction", () => ({
  applyPersonaCorrection: (...a: unknown[]) => applyPersonaCorrection(...a),
  buildCorrectionLog: (log: unknown) => log,
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForUserWithOwnership: async () => ({
    provider: { name: "Test" },
    owned: true,
  }),
  resolveProviderForUser: async () => null,
  invalidateUserProviderCache: () => {},
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

const persona = {
  id: 5,
  userId: 1,
  name: "小A",
  analysisStatus: "ready",
  emotionalState: "warm",
  personaData: { personality: "温柔" },
} as any;

describe("the persona's own fields", () => {
  /** Resolves when the mining has read the persona and is busy. */
  let miningIsBusy: Promise<void>;
  let miningStarted: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    miningIsBusy = new Promise<void>((resolve) => {
      miningStarted = resolve;
    });
    // The column, as the database holds it.
    let stored: Record<string, unknown> = { personality: "温柔" };
    getPersonaById.mockImplementation(async () => ({
      ...persona,
      personaData: { ...stored },
    }));
    updatePersona.mockImplementation(async (_id: unknown, _uid: unknown, data: any) => {
      stored = { ...stored, ...(data?.personaData ?? {}) };
    });
    getCollectedMessagesForPersonaRows.mockResolvedValue([]);
    applyPersonaCorrection.mockResolvedValue({
      personaData: { personality: "更温柔" },
      changedFields: ["personality"],
      summary: "更温柔了",
      needsClarification: false,
      question: "",
    });
    appendPersonaCorrection.mockResolvedValue(undefined);
    updateSkillJob.mockResolvedValue(undefined);
    // The mining takes a while — that is when the overlap happens.
    mineMicroRules.mockImplementation(async () => {
      miningStarted();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return [
        {
          id: "auto-1",
          trigger: ["随便你"],
          meaning: "她真的生气了",
          rendering: "更短、更冷",
          confidence: 0.8,
          source: "auto",
          verified: false,
          evidence: [],
        },
      ];
    });
  });

  it("does not lose the imperfection profile when the rules are mined at the same time", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    const mining = caller.microRule.mine({ personaId: 5, locale: "zh" });
    // The mining has read the persona by now, and is busy for a while.
    await miningIsBusy;
    const saving = caller.imperfection.save({
      personaId: 5,
      profile: [{ state: "warm", deviations: ["会先说「我在」"] }],
    });
    await Promise.all([mining, saving]);

    // Every write carries the whole column, so the last one wins — and
    // it has to carry both changes.
    const written = updatePersona.mock.calls.map((call) => (call[2] as any).personaData);
    const last = written[written.length - 1];
    expect(last.imperfectionProfile).toBeDefined();
    expect(last.microRules).toBeDefined();
  });

  it("limits how often a correction can be asked for", async () => {
    // The correction sends the persona's whole field set and the user's
    // own words to the provider, and it had no limit at all.
    const caller = appRouter.createCaller(ctxFor(555111));
    let refused = false;
    for (let i = 0; i < 40; i++) {
      try {
        await caller.persona.applyCorrection({ id: 5, correction: "温柔一点" });
      } catch {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });

  it("does not lose the rules when the profile is saved in the middle of the mining", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    const mining = caller.microRule.mine({ personaId: 5, locale: "zh" });
    await miningIsBusy;
    const saving = caller.imperfection.save({
      personaId: 5,
      profile: [{ state: "warm", deviations: ["会先说「我在」"] }],
    });
    await Promise.all([mining, saving]);

    // Both writes are there, and the second one carries the first one's
    // change as well.
    const written = updatePersona.mock.calls.map((call) => (call[2] as any).personaData);
    expect(written).toHaveLength(2);
    expect(written[1].microRules).toBeDefined();
    expect(written[1].imperfectionProfile).toBeDefined();
  });
});
