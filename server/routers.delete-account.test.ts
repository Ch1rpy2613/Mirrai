import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Deleting the account.
 *
 * "Delete my account" removed the rows — but the WeChat poll loop and
 * the Feishu long connection keep running until they are told to stop.
 *
 * So the bot went on answering on WeChat for an account that no longer
 * existed: the person on the other end was told to go and set a
 * persona in the web app, and the messages it wrote carried a user id
 * that no longer had a user — so the later clean-up never found them.
 */

const stopChannelsForUser = vi.fn();
const deleteUserAccount = vi.fn();
const getUserById = vi.fn();
const verifyPassword = vi.fn();

vi.mock("./channels", () => ({
  getChannelAdapter: vi.fn(),
  listChannels: () => [],
  stopChannelsForUser: (...a: unknown[]) => stopChannelsForUser(...a),
}));

vi.mock("./db", () => ({
  deleteUserAccount: (...a: unknown[]) => deleteUserAccount(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
}));

vi.mock("./_core/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
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
    req: { headers: {}, socket: {} } as any,
    res: { clearCookie: vi.fn() } as any,
  } as unknown as TrpcContext;
}

describe("deleting the account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockResolvedValue({ id: 1, passwordHash: "hash" });
    verifyPassword.mockResolvedValue(true);
    deleteUserAccount.mockResolvedValue(undefined);
    stopChannelsForUser.mockResolvedValue(undefined);
  });

  it("stops the channels first", async () => {
    await appRouter.createCaller(ctxFor(1)).user.deleteAccount({ confirmPassword: "the-password" });

    /**
     * First: a channel that is still running would answer a message
     * that is already on its way, and the row it wrote would belong to
     * an account that has just been deleted.
     */
    expect(stopChannelsForUser).toHaveBeenCalledWith(1);
    expect(deleteUserAccount).toHaveBeenCalledWith(1);
    expect(stopChannelsForUser.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUserAccount.mock.invocationCallOrder[0],
    );
  });

  it("does not delete anything when the password is wrong", async () => {
    verifyPassword.mockResolvedValue(false);

    await expect(
      appRouter.createCaller(ctxFor(1)).user.deleteAccount({ confirmPassword: "wrong" }),
    ).rejects.toThrow();

    expect(stopChannelsForUser).not.toHaveBeenCalled();
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });
});
