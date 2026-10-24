import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserById = vi.fn();
const bumpUserTokenVersion = vi.fn();

vi.mock("./db", () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
  bumpUserTokenVersion: (...a: unknown[]) => bumpUserTokenVersion(...a),
}));

import {
  createSessionToken,
  verifySession,
  authenticateRequest,
} from "./_core/auth";
import { COOKIE_NAME } from "@shared/const";

function makeUser(tokenVersion: number) {
  return {
    id: 1,
    username: "tester",
    passwordHash: null,
    openId: null,
    name: "Tester",
    email: null,
    loginMethod: "local",
    role: "user",
    tokenVersion,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function requestWith(cookie: string) {
  return {
    headers: { cookie: `${COOKIE_NAME}=${cookie}` },
  } as any;
}

describe("session revocation", () => {
  beforeEach(() => {
    getUserById.mockReset();
    bumpUserTokenVersion.mockReset();
    bumpUserTokenVersion.mockResolvedValue(undefined);
  });

  it("mints a token carrying the token version", async () => {
    const token = await createSessionToken(1, "Tester", 3);
    const payload = await verifySession(token);
    expect(payload?.tokenVersion).toBe(3);
  });

  it("accepts a token whose version still matches", async () => {
    getUserById.mockResolvedValue(makeUser(2));
    const token = await createSessionToken(1, "Tester", 2);
    const user = await authenticateRequest(requestWith(token));
    expect(user.id).toBe(1);
  });

  it("rejects a token that was minted before the version was bumped", async () => {
    // The user logged out elsewhere, so their stored version moved on.
    getUserById.mockResolvedValue(makeUser(5));
    const token = await createSessionToken(1, "Tester", 4);

    await expect(authenticateRequest(requestWith(token))).rejects.toThrow(/revoked/i);
  });

  it("rejects a token with no cookie at all", async () => {
    await expect(
      authenticateRequest({ headers: {} } as any),
    ).rejects.toThrow();
  });

  it("rejects a token for a user that no longer exists", async () => {
    getUserById.mockResolvedValue(undefined);
    const token = await createSessionToken(1, "Tester", 0);
    await expect(authenticateRequest(requestWith(token))).rejects.toThrow(/not found/i);
  });

  it("treats a token without a version as version zero", async () => {
    const payload = await verifySession("not-a-jwt");
    expect(payload).toBeNull();
  });
});
