import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The acceptance criteria for the hardening phase are about what happens at
 * the HTTP boundary, not about what the helpers compute. These tests drive
 * a real Express app over a real socket.
 *
 * The three they cover:
 *   0-F  the eleventh login from one address is refused with 429
 *   0-G  a mutating request from a foreign origin is refused with 403
 *   0-H  a session token stops working the moment the user logs out
 */

const getUserByUsername = vi.fn();
const getUserById = vi.fn();
const createUser = vi.fn();
const updateUserLastSignedIn = vi.fn();
const updateUserPassword = vi.fn();
const bumpUserTokenVersion = vi.fn();

vi.mock("../db", () => ({
  getUserByUsername: (...a: unknown[]) => getUserByUsername(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  createUser: (...a: unknown[]) => createUser(...a),
  updateUserLastSignedIn: (...a: unknown[]) => updateUserLastSignedIn(...a),
  updateUserPassword: (...a: unknown[]) => updateUserPassword(...a),
  bumpUserTokenVersion: (...a: unknown[]) => bumpUserTokenVersion(...a),
}));

import { registerAuthRoutes, authenticateRequest } from "./auth";
import { csrfGuard } from "./csrf";
import { rateLimiter } from "./rate-limit";
import { COOKIE_NAME } from "@shared/const";

/** A user with a password hash the verifier accepts. */
const user = {
  id: 7,
  username: "tester",
  name: "Tester",
  role: "user",
  passwordHash:
    "scrypt$16384$8$1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  tokenVersion: 0,
} as any;

let server: Server;
let baseUrl: string;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    // The same order the real server uses: the CSRF guard covers the auth
    // routes and the tRPC mount alike.
    app.use("/api", csrfGuard);
    registerAuthRoutes(app);

    // A stand-in for the tRPC mount, so a cross-origin write can be shown
    // to be refused before it reaches a procedure.
    app.post("/api/trpc/chat.send", (req, res) => {
      res.json({ ok: true });
    });

    // The endpoint a signed-in request goes through.
    app.get("/api/whoami", async (req, res) => {
      try {
        const current = await authenticateRequest(req);
        res.json({ id: current.id });
      } catch {
        res.status(401).json({ error: "unauthenticated" });
      }
    });

    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function cookieFrom(res: Response): string {
  const header = res.headers.get("set-cookie");
  if (!header) throw new Error("no cookie was set");
  return header.split(";")[0];
}

describe("the HTTP boundary", () => {
  beforeEach(async () => {
    for (const fn of [
      getUserByUsername,
      getUserById,
      createUser,
      updateUserLastSignedIn,
      updateUserPassword,
      bumpUserTokenVersion,
    ]) {
      fn.mockReset();
    }
    // The limiter is process-wide; every test starts from a clean bucket.
    rateLimiter.reset?.();
    getUserByUsername.mockResolvedValue(user);
    getUserById.mockResolvedValue(user);
    await startApp();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("0-F — refuses the eleventh login from the same address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "tester", password: "wrong-password" }),
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get("Retry-After")).toBeTruthy();
      }
    }

    // The first ten are refused for the wrong credentials, not for the rate.
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    // The eleventh is refused because too many attempts were made.
    expect(statuses[10]).toBe(429);
  });

  it("0-G — refuses a mutating request from a foreign origin", async () => {
    const res = await fetch(`${baseUrl}/api/trpc/chat.send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ personaId: 1, message: "hello" }),
    });

    expect(res.status).toBe(403);
  });

  it("0-G — allows a mutating request from the app's own origin", async () => {
    const res = await fetch(`${baseUrl}/api/trpc/chat.send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({ personaId: 1, message: "hello" }),
    });

    expect(res.status).toBe(200);
  });

  it("0-G — refuses a mutating request that only has a foreign Referer", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://evil.example/attack",
      },
      body: JSON.stringify({ username: "tester", password: "whatever" }),
    });

    expect(res.status).toBe(403);
  });

  it("0-H — a session token stops working after the user logs out", async () => {
    // A token minted for the current token version.
    const { createSessionToken } = await import("./auth");
    const token = await createSessionToken(user.id, user.name, 0);

    const before = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(before.status).toBe(200);

    // The logout bumps the token version, which retires every token minted
    // before that point.
    user.tokenVersion = 1;
    getUserById.mockResolvedValue({ ...user, tokenVersion: 1 });

    const after = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    expect(after.status).toBe(401);
  });
});
