import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Asking for the same reply again must not cost the user the reply they
 * already had.
 *
 * The turn was deleted before the model was asked, so a provider that
 * was having a bad minute took the user's question *and* the persona's
 * answer away for good — and the page showed an empty bubble, with no
 * error, because the failure is reported as an event and the event was
 * not read.
 */

const getPersonaById = vi.fn();
const getPreviousMessage = vi.fn();
const getMessagesFrom = vi.fn();
const restoreMessages = vi.fn();
const deleteMessagesFrom = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPreviousMessage: (...a: unknown[]) => getPreviousMessage(...a),
  getMessagesFrom: (...a: unknown[]) => getMessagesFrom(...a),
  restoreMessages: (...a: unknown[]) => restoreMessages(...a),
  deleteMessagesFrom: (...a: unknown[]) => deleteMessagesFrom(...a),
}));

const runConversation = vi.fn();
const withPersonaTurn = vi.fn(async (_personaId: number, work: () => Promise<unknown>) => work());

vi.mock("./chat/service", () => ({
  runConversation: (...a: unknown[]) => runConversation(...a),
  /**
   * The turn holder.
   *
   * The regenerate takes the persona's turn before it takes the old
   * turn away — so the delete and the new turn cannot interleave with
   * another turn of the same persona. The mock runs the work straight
   * away, which is what the real one does when nobody else is waiting.
   */
  withPersonaTurn: (...a: unknown[]) => withPersonaTurn(...a),
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
} as any;

const oldTurn = [
  {
    role: "user",
    content: "在吗",
    emotionalState: "warm",
    messageType: "text",
    mediaUrl: null,
    replyToId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    role: "assistant",
    content: "在的",
    emotionalState: "warm",
    messageType: null,
    mediaUrl: null,
    replyToId: null,
    createdAt: new Date("2026-01-01T00:01:00Z"),
  },
];

describe("asking for the same reply again", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    getPreviousMessage.mockResolvedValue({
      id: 11,
      role: "user",
      content: "在吗",
    });
    getMessagesFrom.mockResolvedValue(oldTurn);
    deleteMessagesFrom.mockResolvedValue(2);
    restoreMessages.mockResolvedValue(2);
  });

  it("keeps the old answer when the model fails", async () => {
    runConversation.mockImplementation(async function* () {
      yield { type: "error", message: "the provider is down", partial: false };
    });

    await expect(
      appRouter.createCaller(ctxFor(1)).chat.regenerate({
        personaId: 5,
        messageId: 12,
        locale: "zh",
      }),
    ).rejects.toThrow();

    // The turn that was there before is back.
    expect(restoreMessages).toHaveBeenCalledTimes(1);
    expect(restoreMessages.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not put the old answer back when the model answers", async () => {
    runConversation.mockImplementation(async function* () {
      yield { type: "delta", text: "在的呀" };
      yield { type: "emotion", state: "warm" };
    });

    const result = await appRouter
      .createCaller(ctxFor(1))
      .chat.regenerate({ personaId: 5, messageId: 12, locale: "zh" });

    expect(result.reply).toBe("在的呀");
    expect(restoreMessages).not.toHaveBeenCalled();
  });
});
