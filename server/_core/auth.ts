import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { RATE_LIMITS, getClientIp, rateLimiter } from "./rate-limit";

export type SessionPayload = {
  userId: number;
  name: string;
  /** The user's token version at the time the token was minted. */
  tokenVersion: number;
};

function getSessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  if (!cookieHeader) return new Map();
  return new Map(Object.entries(parseCookieHeader(cookieHeader)));
}

/**
 * Rejects the request when the auth endpoint is being called too often.
 * Returns true when the request was rejected (and the response was sent).
 */
function rejectIfRateLimited(req: Request, res: Response): boolean {
  const key = getClientIp(req);
  const result = rateLimiter.check(key, RATE_LIMITS.auth);
  if (result.allowed) return false;
  res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
  res.status(429).json({ error: "Too many attempts, please try again later" });
  return true;
}

export async function createSessionToken(
  userId: number,
  name: string,
  tokenVersion = 0,
): Promise<string> {
  const secret = getSessionSecret();
  const expiresAt = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ userId, name, tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expiresAt)
    .sign(secret);
}

export async function verifySession(
  cookieValue: string | undefined | null
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  try {
    const secret = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secret, {
      algorithms: ["HS256"],
    });
    const { userId, name, tv } = payload as Record<string, unknown>;
    if (typeof userId !== "number" || typeof name !== "string") return null;
    return {
      userId,
      name,
      tokenVersion: typeof tv === "number" ? tv : 0,
    };
  } catch {
    return null;
  }
}

export async function authenticateRequest(req: Request): Promise<User> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySession(sessionCookie);
  if (!session) throw ForbiddenError("Invalid session");

  const user = await db.getUserById(session.userId);
  if (!user) throw ForbiddenError("User not found");

  // A logout or a password change bumps the token version, which retires
  // every token that was minted before that point.
  if ((user.tokenVersion ?? 0) !== session.tokenVersion) {
    throw ForbiddenError("Session has been revoked");
  }
  return user;
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    if (rejectIfRateLimited(req, res)) return;

    const { username, password } = req.body;
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    if (username.length < 2 || username.length > 50) {
      res.status(400).json({ error: "username must be 2-50 characters" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "password must be at least 6 characters" });
      return;
    }

    try {
      const existing = await db.getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: "username already taken" });
        return;
      }

      const passwordHash = await hashPassword(password);

      const userId = await db.createUser({
        username,
        passwordHash,
        name: username,
      });

      const token = await createSessionToken(userId, username, 0);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, userId });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    if (rejectIfRateLimited(req, res)) return;

    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    try {
      const user = await db.getUserByUsername(username);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "invalid credentials" });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "invalid credentials" });
        return;
      }

      // Transparent upgrade: legacy SHA256 hashes are re-hashed with scrypt on login.
      if (needsRehash(user.passwordHash)) {
        try {
          await db.updateUserPassword(user.id, await hashPassword(password));
        } catch (e) {
          console.warn("[Auth] Failed to upgrade password hash:", e);
        }
      }

      await db.updateUserLastSignedIn(user.id);

      const token = await createSessionToken(
        user.id,
        user.name || username,
        user.tokenVersion ?? 0,
      );
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, userId: user.id });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
