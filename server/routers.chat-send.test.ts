import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Sending a message when the model fails.
 *
 * The user's own message is stored *before* the model is called — and
 * it stays there, because the channels depend on it: a person who
 * wrote a message on WeChat cannot have it put back in a composer.
 *
 * But the mutation threw, so the client took the bubble away and said
 * "the server did not store the message". That was a claim that was
 * simply false — and twenty seconds later the poll brought the message
 * back on its own, or the user had retyped it and the transcript had
 * it twice.
 */

const runConversation = vi.fn();
const getPersonaById = vi.fn();
const updatePersona = vi.fn();

vi.mock("./chat/service", () => ({
  runConversation: (...a: unknown[]) => runConversation(...a),
  withPersonaTurn: async (_key: string, work: () => Promise<unknown>) => work(),
  PersonaAsleepError: class PersonaAsleepError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PersonaAsleepError";
    }
  },
  clampContextLimit: (value: unknown) => value,
  clampTemperature: (value: unknown) => value,
  clampMaxTokens: (value: unknown) => value,
  sanitizeExtraConfig: (value: unknown) => value,
}));

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
  analysisStatus: "ready",
  emotionalState: "warm",
  personaData: {},
} as any;

/** A generator that fails, the way the conversation does. */
async function* failingTurn(storedUserMessage: boolean) {
  yield { type: "error", message: "the model did not answer", partial: false, storedUserMessage };
}

describe("sending a message when the model fails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    updatePersona.mockResolvedValue(undefined);
  });

  it("says the turn failed instead of pretending the message was lost", async () => {
    runConversation.mockImplementation(() => failingTurn(true));

    const result = await appRouter
      .createCaller(ctxFor(1))
      .chat.send({ personaId: 5, message: "在吗？", locale: "zh" });

    /**
     * The message is in the transcript, so the bubble stays and the
     * text does not go back into the composer.
     */
    expect((result as any).failed).toBe(true);
  });

  it("still fails outright when the turn never started", async () => {
    /**
     * The user pressed "stop": the message was taken away again with
     * the half-answer, so there is nothing in the transcript and the
     * client may put the text back.
     */
    runConversation.mockImplementation(() => failingTurn(false));

    await expect(
      appRouter.createCaller(ctxFor(1)).chat.send({ personaId: 5, message: "在吗？", locale: "zh" }),
    ).rejects.toThrow();
  });

  it("says the turn failed when the provider is not there at all", async () => {
    /**
     * The provider is looked up *after* the user's message is written,
     * so the message is in the transcript here too.
     */
    runConversation.mockImplementation(async function* () {
      throw new Error("No LLM provider available");
    });

    const result = await appRouter
      .createCaller(ctxFor(1))
      .chat.send({ personaId: 5, message: "在吗？", locale: "zh" });

    expect((result as any).failed).toBe(true);
  });
});
