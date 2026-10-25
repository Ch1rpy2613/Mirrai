import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The context behind a proactive message.
 *
 * "TA 先开口了" is only worth anything if what TA opens with is grounded
 * in something real: how long it has been, what time it is where they
 * are, how the user has been. A proactive message invented out of
 * nothing is the thing this feature is supposed not to be.
 */
const getUserById = vi.fn();
const getLastMessageAt = vi.fn();
const getRecentUserMood = vi.fn();

vi.mock("../db", () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
}));

import { collectProactiveContext } from "./proactive";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  timezone: "Europe/London",
  togetherTo: null,
} as any;

describe("the context behind a proactive message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockResolvedValue({ timezone: "Asia/Shanghai" });
    getLastMessageAt.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
  });

  it("counts the days since the last conversation", async () => {
    getLastMessageAt.mockResolvedValue(new Date("2026-05-30T12:00:00Z"));
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.daysSinceLastChat).toBe(3);
  });

  it("counts zero when they have never spoken", async () => {
    getLastMessageAt.mockResolvedValue(null);
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.daysSinceLastChat).toBe(0);
  });

  it("knows what time it is on both sides", async () => {
    // 12:00 UTC is 20:00 in Shanghai and 13:00 in London.
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.userHour).toBe(20);
    expect(context.personaHour).toBe(13);
  });

  it("knows how far apart the clocks are", async () => {
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    // London is seven hours behind Shanghai in June.
    expect(context.hoursApart).toBe(-7);
  });

  it("does not guess the distance when the persona has no timezone", async () => {
    const context = await collectProactiveContext({
      persona: { ...persona, timezone: null } as any,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.hoursApart).toBeNull();
  });

  it("carries the user's own state when they said", async () => {
    getRecentUserMood.mockResolvedValue({ mood: "down" });
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.userMood).toBe("down");
  });

  it("ignores a mood it does not recognise", async () => {
    getRecentUserMood.mockResolvedValue({ mood: "furious" });
    const context = await collectProactiveContext({
      persona,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.userMood).toBeNull();
  });

  it("knows when the relationship has ended", async () => {
    const context = await collectProactiveContext({
      persona: { ...persona, togetherTo: "2024-01-01" } as any,
      userId: 1,
      now: new Date("2026-06-02T12:00:00Z"),
    });
    expect(context.relationshipEnded).toBe(true);
  });
});
