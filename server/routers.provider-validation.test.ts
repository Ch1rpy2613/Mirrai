import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A provider name that does not exist is a mistake, and it has to be caught
 * where the mistake is made.
 *
 * Silently storing it would mean every later conversation quietly falls back
 * to a different model — the user would be talking to a model they never
 * chose, and nothing would say so.
 *
 * A custom endpoint is expressed by pointing a registered provider
 * (OpenAI, for instance) at a different `baseUrl`.
 */

const upsertLlmConfig = vi.fn();
const setDefaultLlmConfig = vi.fn();
const getLlmConfigsByUserId = vi.fn();
const getDefaultLlmConfig = vi.fn();
const updatePersona = vi.fn();
const getPersonaById = vi.fn();
const invalidateUserProviderCache = vi.fn();

vi.mock("./db", () => ({
  upsertLlmConfig: (...a: unknown[]) => upsertLlmConfig(...a),
  setDefaultLlmConfig: (...a: unknown[]) => setDefaultLlmConfig(...a),
  getLlmConfigsByUserId: (...a: unknown[]) => getLlmConfigsByUserId(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./llm/user-provider", () => ({
  invalidateUserProviderCache: (...a: unknown[]) => invalidateUserProviderCache(...a),
  resolveProviderForUser: vi.fn(),
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
      name: `User ${userId}`,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
    },
    req: { headers: {}, method: "GET", url: "/api/trpc/test" } as any,
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("provider names", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    for (const fn of [
      upsertLlmConfig,
      setDefaultLlmConfig,
      getLlmConfigsByUserId,
      getDefaultLlmConfig,
      updatePersona,
      getPersonaById,
      invalidateUserProviderCache,
    ]) {
      fn.mockReset();
    }
    upsertLlmConfig.mockResolvedValue(1);
    setDefaultLlmConfig.mockResolvedValue(undefined);
    updatePersona.mockResolvedValue(undefined);
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: "小A",
      analysisStatus: "ready",
      personaData: {},
    });

    caller = appRouter.createCaller(ctxFor(1));
  });

  it("refuses to store a configuration for a provider that does not exist", async () => {
    await expect(
      caller.llmConfig.upsert({ providerName: "NotAProvider", apiKey: "sk-test" }),
    ).rejects.toThrow(/未知的 LLM 提供商/);

    expect(upsertLlmConfig).not.toHaveBeenCalled();
  });

  it("refuses to make an unknown provider the default", async () => {
    await expect(
      caller.llmConfig.setDefault({ providerName: "NotAProvider" }),
    ).rejects.toThrow(/未知的 LLM 提供商/);

    expect(setDefaultLlmConfig).not.toHaveBeenCalled();
  });

  it("refuses to point a persona at a provider that does not exist", async () => {
    await expect(
      caller.persona.update({ id: 1, llmProvider: "NotAProvider" }),
    ).rejects.toThrow(/未知的 LLM 提供商/);

    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("accepts a registered provider", async () => {
    // "OpenAI" is always registered.
    const result = await caller.llmConfig.upsert({
      providerName: "OpenAI",
      apiKey: "sk-test",
    });

    expect(result.id).toBe(1);
    expect(upsertLlmConfig).toHaveBeenCalled();
  });

  it("accepts a persona that points at a registered provider", async () => {
    const result = await caller.persona.update({ id: 1, llmProvider: "OpenAI" });

    expect(result).toEqual({ success: true });
    expect(updatePersona).toHaveBeenCalled();
  });
});
