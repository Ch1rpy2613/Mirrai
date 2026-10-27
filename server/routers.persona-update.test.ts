import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Saving a persona's own fields.
 *
 * The write is scoped to the persona and to its owner — so a caller
 * who guessed somebody else's id, or who held a stale id for a
 * persona that had been deleted in another tab, wrote *nothing*.
 *
 * But the procedure answered "saved" either way: a green toast, and a
 * field that had not changed. Every sibling — the delete, the
 * persona's JSON, the graduation — checks first.
 */

const updatePersona = vi.fn();
const getPersonaById = vi.fn();

vi.mock("./db", () => ({
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
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

describe("saving a persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePersona.mockResolvedValue(true);
  });

  it("says it saved when the row was written", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .persona.update({ id: 5, name: "小B" });

    expect(result).toEqual({ success: true });
    expect(updatePersona).toHaveBeenCalled();
  });

  it("does not say it saved when nothing was written", async () => {
    /**
     * The persona was deleted in another tab, or the id in the URL is
     * stale, or it belongs to somebody else.
     */
    updatePersona.mockResolvedValue(false);

    await expect(
      appRouter.createCaller(ctxFor(1)).persona.update({ id: 999999, name: "小B" }),
    ).rejects.toThrow();
  });
});
