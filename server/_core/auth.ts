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
import { copy, type Locale } from "@shared/copy";
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
async function rejectIfRateLimited(req: Request, res: Response): Promise<boolean> {
  const key = getClientIp(req);
  const result = await rateLimiter.check(key, RATE_LIMITS.auth);
  if (result.allowed) return false;
  res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
  // The message is shown to the user, so it is in their language.
  res.status(429).json({ error: copy(localeOf(req), "errors.tooManyAttempts") });
  return true;
}

/** Whether the database refused a row because a unique key was taken. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  // Postgres's SQLSTATE for a unique violation.
  return code === "23505";
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

/**
 * A hash of a password nobody has.
 *
 * The sign-in answers in the same time whether or not the account
 * exists — otherwise the time it takes to answer says whether the
 * name is taken, and the names can be found one at a time.
 */
let decoyHash: string | null = null;

async function getDecoyHash(): Promise<string> {
  if (!decoyHash) decoyHash = await hashPassword("a password nobody has");
  return decoyHash;
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

/**
 * The language the person is reading in.
 *
 * The client says which language that is, the same way it does for the
 * tRPC calls. The auth routes used to answer in English whatever the
 * reader's language was — so the one screen that speaks the user's
 * language failed to speak it at the moment the wording mattered most.
 */
function localeOf(req: Request): Locale {
  const header = req.headers["x-mirrai-locale"];
  const value = Array.isArray(header) ? header[0] : header;
  return value === "en" ? "en" : "zh";
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const locale = localeOf(req);
    if (await rejectIfRateLimited(req, res)) return;

    const { username, password } = req.body;
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: copy(locale, "errors.usernamePasswordRequired") });
      return;
    }
    if (username.length < 2 || username.length > 50) {
      res.status(400).json({ error: copy(locale, "errors.usernameTooShort") });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: copy(locale, "errors.passwordTooShort") });
      return;
    }

    try {
      const existing = await db.getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: copy(locale, "errors.usernameTaken") });
        return;
      }

      const passwordHash = await hashPassword(password);

      /**
       * The name has to be free.
       *
       * It was checked before the insert, and the insert can still lose
       * the race — two registrations of the same name at the same
       * moment. The database refuses the second one, and the refusal
       * was reported as "registration failed": a 500 and a message
       * about something being broken, for a name that is simply taken.
       */
      let userId: number;
      try {
        userId = await db.createUser({
          username,
          passwordHash,
          name: username,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          res.status(409).json({ error: copy(locale, "errors.usernameTaken") });
          return;
        }
        throw error;
      }

      const token = await createSessionToken(userId, username, 0);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, userId });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: copy(locale, "errors.registrationFailed") });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const locale = localeOf(req);
    if (await rejectIfRateLimited(req, res)) return;

    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: copy(locale, "errors.usernamePasswordRequired") });
      return;
    }

    try {
      const user = await db.getUserByUsername(username);
      /**
       * The password is checked either way.
       *
       * It used to be checked only for an account that exists — and the
       * hashing is the slow part, so the answer came back much faster
       * for a name that is not taken. The time it took to answer said
       * whether the account existed, and the names could be found one
       * at a time.
       */
      const valid = await verifyPassword(
        password,
        user?.passwordHash ?? (await getDecoyHash()),
      );
      if (!user || !valid) {
        res.status(401).json({ error: copy(locale, "errors.invalidCredentials") });
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
      res.status(500).json({ error: copy(locale, "errors.loginFailed") });
    }
  });
}
