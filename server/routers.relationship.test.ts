import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The relationship timeline.
 *
 * It is the user's own record of their own life, and the dates in it
 * are the dates they meant.
 *
 * The breakup date was read as `new Date("2024-03-14")` — midnight in
 * Greenwich — and then filed under the user's own day. So for anybody
 * west of Greenwich a breakup on the fourteenth was recorded on the
 * thirteenth, and that date is what stops the anniversaries, marks the
 * relationship as over in the prompt, and switches the letter-reply
 * register.
 */

const getPersonaById = vi.fn();
const createRelationshipEvent = vi.fn();
const updatePersona = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createRelationshipEvent: (...a: unknown[]) => createRelationshipEvent(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
}));

import { appRouter } from "./routers";

function ctxFor(userId: number, timezone: string | null): TrpcContext {
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
      timezone,
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
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: {},
} as any;

describe("the relationship timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    createRelationshipEvent.mockResolvedValue({ id: 1 });
    updatePersona.mockResolvedValue(undefined);
    createSafetyEvent.mockResolvedValue(1);
  });

  it("records the breakup on the day the user wrote down", async () => {
    await appRouter
      .createCaller(ctxFor(1, "America/Los_Angeles"))
      .relationship.add({
        personaId: 5,
        kind: "breakup",
        title: "我们分手了",
        happenedAt: "2024-03-14",
      });

    expect(updatePersona).toHaveBeenCalledWith(5, 1, { togetherTo: "2024-03-14" });
  });

  it("records the breakup on the day the user wrote down, east of Greenwich too", async () => {
    await appRouter
      .createCaller(ctxFor(1, "Asia/Shanghai"))
      .relationship.add({
        personaId: 5,
        kind: "breakup",
        title: "我们分手了",
        happenedAt: "2024-03-14",
      });

    expect(updatePersona).toHaveBeenCalledWith(5, 1, { togetherTo: "2024-03-14" });
  });

  it("refuses a day that does not exist", async () => {
    // "2026-02-30" has the right shape and is not a day — and it rolls
    // over to the second of March, so the timeline showed a day the
    // user never wrote down.
    await expect(
      appRouter
        .createCaller(ctxFor(1, "Asia/Shanghai"))
        .relationship.add({
          personaId: 5,
          kind: "news",
          title: "一条消息",
          happenedAt: "2026-02-30",
        }),
    ).rejects.toThrow();
  });

  it("still accepts a day that exists", async () => {
    await appRouter
      .createCaller(ctxFor(1, "Asia/Shanghai"))
      .relationship.add({
        personaId: 5,
        kind: "news",
        title: "一条消息",
        happenedAt: "2024-02-29",
      });

    expect(createRelationshipEvent).toHaveBeenCalled();
  });
});
