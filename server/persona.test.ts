import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock db helpers
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserById: vi.fn(),
  getUserByUsername: vi.fn(),
  createUser: vi.fn(),
  updateUserLastSignedIn: vi.fn(),
  getPersonasByUserId: vi.fn().mockResolvedValue([]),
  getPersonaById: vi.fn().mockResolvedValue(null),
  createPersona: vi.fn().mockResolvedValue({ id: 1, name: "Test", userId: 1 }),
  updatePersona: vi.fn().mockResolvedValue({ id: 1, name: "Updated" }),
  deletePersona: vi.fn().mockResolvedValue(true),
  getMessagesByPersonaId: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: 1, content: "hi" }),
  createPersonaFile: vi.fn(),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  clearMessagesByPersonaId: vi.fn(),
  createWechatBinding: vi.fn(),
  getWechatBindingsByUserId: vi.fn().mockResolvedValue([]),
  getWechatBindingByContactId: vi.fn(),
  deleteWechatBinding: vi.fn(),
  createSkillJob: vi.fn(),
  getSkillJobById: vi.fn(),
  updateSkillJob: vi.fn(),
  getLlmConfigsByUserId: vi.fn().mockResolvedValue([]),
  upsertLlmConfig: vi.fn(),
  setDefaultLlmConfig: vi.fn(),
  getWechatBotState: vi.fn(),
  upsertWechatBotState: vi.fn(),
}));

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      username: "test-user",
      passwordHash: null,
      openId: "test-open-id",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "local",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("persona.list", () => {
  it("returns empty array when no personas exist", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.persona.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });
});

describe("auth.me", () => {
  it("returns current user when authenticated", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result?.id).toBe(1);
    expect(result?.name).toBe("Test User");
  });

  it("returns null when not authenticated", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});
