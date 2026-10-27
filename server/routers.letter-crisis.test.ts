import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The letters, and what the app does with a word written in one.
 *
 * A letter is the most personal thing the app holds: it is what a
 * person writes when they cannot say it to somebody any other way.
 *
 * And it was the one place the user could write freely that the
 * crisis detector never read *at the moment of writing*. The only scan
 * was at answer time — and a letter that is kept, or written as a note
 * to say later, is never answered. So "我不想活了" written into a
 * letter was stored, never looked at, and the person who wrote it was
 * never shown the resources.
 */

const getPersonaById = vi.fn();
const writeLetter = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
}));

vi.mock("./chat/letters", () => ({
  writeLetter: (...a: unknown[]) => writeLetter(...a),
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
  personaData: {},
} as any;

describe("a letter that says something the app has to hear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    writeLetter.mockResolvedValue({
      letter: { id: 1, kind: "letter", status: "private" },
      asleep: false,
    });
    createSafetyEvent.mockResolvedValue(1);
  });

  it("is read, and the resources are offered", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .letter.write({
        personaId: 5,
        body: "我不想活了",
        deliver: false,
        kind: "letter",
        locale: "zh",
      });

    expect((result as any).crisis).toBe(true);
    expect(createSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        personaId: 5,
        type: "crisis",
        severity: "critical",
      }),
    );
  });

  it("is read even when it is a note to say later", async () => {
    /**
     * A note that is kept for later is never answered — so the scan at
     * answer time never ran for it at all.
     */
    const result = await appRouter
      .createCaller(ctxFor(1))
      .letter.write({
        personaId: 5,
        body: "我不想活了",
        deliver: false,
        kind: "todo",
        locale: "zh",
      });

    expect((result as any).crisis).toBe(true);
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("says nothing about an ordinary letter", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .letter.write({
        personaId: 5,
        body: "今天天气不错，想你了。",
        deliver: false,
        kind: "letter",
        locale: "zh",
      });

    expect((result as any).crisis).toBe(false);
    expect(createSafetyEvent).not.toHaveBeenCalled();
  });
});
