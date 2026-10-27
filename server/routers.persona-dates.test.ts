import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The dates of a relationship.
 *
 * The create path refuses a date that is not a date — "去年" was stored
 * as it was typed, and the card then said "together for 1 day" and
 * "today is the anniversary", both of them false. The update path did
 * not have the check, so the same thing could be put back through it.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
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
  emotionalState: "warm",
  personaData: {},
} as any;

describe("the dates of a relationship", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    /**
     * The write says whether a row was written.
     */
    updatePersona.mockResolvedValue(true);
  });

  it("refuses a start date that is not a date", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .persona.update({ id: 5, togetherFrom: "去年" }),
    ).rejects.toThrow();
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("refuses an end date that is not a date", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .persona.update({ id: 5, togetherTo: "很久以前" }),
    ).rejects.toThrow();
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("still accepts the two shapes the app asks for", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    await caller.persona.update({ id: 5, togetherFrom: "2021-06" });
    await caller.persona.update({ id: 5, togetherFrom: "2021-06-15" });

    expect(updatePersona).toHaveBeenCalledTimes(2);
  });

  it("still lets the dates be cleared", async () => {
    await appRouter
      .createCaller(ctxFor(1))
      .persona.update({ id: 5, togetherTo: null });

    expect(updatePersona).toHaveBeenCalledWith(5, 1, { togetherTo: null });
  });
});
