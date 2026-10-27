import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Changing the password.
 *
 * A password change signs every *other* device out — and keeps the one
 * it was made in.
 *
 * The token version was bumped and nothing else: so the token the
 * browser was holding was retired along with everyone else's, and the
 * person who had just changed their password was signed out of the tab
 * they changed it in — with the new password already in hand and no way
 * to tell that from a failure.
 */

const getUserById = vi.fn();
const updateUserPassword = vi.fn();
const bumpUserTokenVersion = vi.fn();
const verifyPassword = vi.fn();
const hashPassword = vi.fn();
const createSessionToken = vi.fn();

vi.mock("./db", () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
  updateUserPassword: (...a: unknown[]) => updateUserPassword(...a),
  bumpUserTokenVersion: (...a: unknown[]) => bumpUserTokenVersion(...a),
}));

vi.mock("./_core/password", () => ({
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
  hashPassword: (...a: unknown[]) => hashPassword(...a),
}));

vi.mock("./_core/auth", () => ({
  createSessionToken: (...a: unknown[]) => createSessionToken(...a),
}));

import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";

function ctxFor(): { ctx: TrpcContext; cookies: Array<{ name: string; options: Record<string, unknown> }> } {
  const cookies: Array<{ name: string; options: Record<string, unknown> }> = [];
  const ctx = {
    user: {
      id: 1,
      username: "sample-user",
      passwordHash: "hash",
      name: "Sample User",
      tokenVersion: 3,
      locale: "zh",
    },
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, options: Record<string, unknown>) => {
        cookies.push({ name, options });
      },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
  return { ctx, cookies };
}

describe("changing the password", () => {
  beforeEach(() => {
    for (const fn of [
      getUserById, updateUserPassword, bumpUserTokenVersion,
      verifyPassword, hashPassword, createSessionToken,
    ]) {
      fn.mockReset();
    }
    getUserById.mockResolvedValue({
      id: 1,
      name: "Sample User",
      username: "sample-user",
      passwordHash: "hash",
      tokenVersion: 4,
    });
    verifyPassword.mockResolvedValue(true);
    hashPassword.mockResolvedValue("new-hash");
    createSessionToken.mockResolvedValue("fresh-token");
  });

  it("keeps this device signed in", async () => {
    const { ctx, cookies } = ctxFor();

    const result = await appRouter
      .createCaller(ctx)
      .user.changePassword({ currentPassword: "old-one", newPassword: "new-one" });

    expect(result).toEqual({ success: true });
    // Every other token is retired.
    expect(bumpUserTokenVersion).toHaveBeenCalledWith(1);
    // And this one gets a fresh token, with the new version in it.
    expect(createSessionToken).toHaveBeenCalledWith(1, "Sample User", 4);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe(COOKIE_NAME);
  });

  it("does not change anything when the current password is wrong", async () => {
    verifyPassword.mockResolvedValue(false);
    const { ctx, cookies } = ctxFor();

    await expect(
      appRouter.createCaller(ctx).user.changePassword({ currentPassword: "wrong", newPassword: "new-one" }),
    ).rejects.toThrow();

    expect(updateUserPassword).not.toHaveBeenCalled();
    expect(bumpUserTokenVersion).not.toHaveBeenCalled();
    expect(cookies).toHaveLength(0);
  });
});
