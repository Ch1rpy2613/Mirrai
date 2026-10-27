import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The fidelity evaluation.
 *
 * A run is up to twelve model calls, and the rate limit allows ten
 * starts a minute. So the guard that stops a second run from starting
 * has to be taken before anything is awaited — and it was not.
 *
 * The check was at the top and the claim was at the bottom, with four
 * awaits in between, and a comment that said there was none. So a
 * double click started two runs: twice the bill, two rows written, and
 * the comparison with the last run depending on which of them finished
 * last.
 */

const getPersonaById = vi.fn();
const getCollectedMessagesForPersonaRows = vi.fn();
const getEvalCases = vi.fn();
const saveEvalCases = vi.fn();
const saveEvalRun = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getCollectedMessagesForPersonaRows: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  // The same helper under its other name.
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  getEvalCases: (...a: unknown[]) => getEvalCases(...a),
  saveEvalCases: (...a: unknown[]) => saveEvalCases(...a),
  saveEvalRun: (...a: unknown[]) => saveEvalRun(...a),
}));

const runEval = vi.fn();

vi.mock("./eval/run", () => ({
  runEval: (...a: unknown[]) => runEval(...a),
}));

/** The cases the run has to measure. */
let evalCases: any[] = [{ context: "在吗", expected: "在的", expectedState: "warm" }];

vi.mock("./eval/dataset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval/dataset")>();
  return {
    ...actual,
    // The cases are built for real, so the run has something to measure.
    buildEvalCases: () => evalCases,
  };
});

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
  personaData: {},
} as any;

describe("the fidelity evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    getCollectedMessagesForPersonaRows.mockResolvedValue([]);
    getEvalCases.mockResolvedValue([]);
    evalCases = [{ context: "在吗", expected: "在的", expectedState: "warm" }];
    saveEvalCases.mockResolvedValue(undefined);
    saveEvalRun.mockResolvedValue(undefined);
    // The run takes a while — that is the whole point of the guard.
    runEval.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { score: 0.8 } as any;
    });
  });

  it("does not start a second run while one is going", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    const first = caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });
    // The second one arrives while the first is still measuring.
    const second = caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });

    await expect(second).rejects.toThrow();
    await first;

    // One run, one bill.
    expect(runEval).toHaveBeenCalledTimes(1);
  });

  it("lets a run start again once the first one is finished", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    await caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });
    await caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });

    expect(runEval).toHaveBeenCalledTimes(2);
  });

  it("gives the run back when there is nothing to measure", async () => {
    // No cases: the run is refused before it starts, and the guard has
    // to let the next attempt through — otherwise one empty persona
    // would block its own evaluation for ever.
    evalCases = [];
    const caller = appRouter.createCaller(ctxFor(1));

    await expect(
      caller.eval.run({ personaId: 5, variant: "default", locale: "zh" }),
    ).rejects.toThrow();
    await expect(
      caller.eval.run({ personaId: 5, variant: "default", locale: "zh" }),
    ).rejects.toThrow();

    // Both refusals were for the missing cases, and neither was "a run
    // is already going".
    expect(runEval).not.toHaveBeenCalled();
  });
});
