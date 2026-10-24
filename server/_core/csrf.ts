/**
 * Cross-site request forgery protection.
 *
 * The session cookie is `SameSite=Lax` by default, which already stops a
 * cross-site form post from carrying credentials. But a deployment that
 * explicitly opts into `SameSite=None` (embedded / cross-origin use) loses
 * that protection, so this guard checks the `Origin` header as well.
 *
 * Rule: mutating requests must come from the app's own origin, or from an
 * origin the operator has allow-listed via `ALLOWED_ORIGINS`.
 */
import type { Request, Response, NextFunction } from "express";
import { ENV } from "./env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reconstructs the origin the browser used for this request. */
export function getRequestOrigin(req: Request): string | null {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = (protoHeader?.split(",")[0] ?? req.protocol ?? "http").trim();
  const host = req.headers.host;
  if (!host) return null;
  return `${protocol}://${host}`;
}

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface CsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Decides whether a mutating request may proceed.
 *
 * When neither `Origin` nor `Referer` is present the request is treated as a
 * non-browser client and allowed through — browsers always send `Origin` on
 * cross-origin writes, and the `SameSite` cookie attribute is the primary
 * defence for first-party navigation.
 */
export function checkOrigin(req: Request): CsrfCheckResult {
  const method = (req.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return { allowed: true };

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const rawReferer = Array.isArray(refererHeader) ? refererHeader[0] : refererHeader;

  // A header that is present but malformed is not the same as no header at
  // all: rejecting it is the safe reading.
  if (rawOrigin) {
    const origin = parseOrigin(rawOrigin);
    if (!origin) {
      return { allowed: false, reason: "origin header could not be parsed" };
    }
    return isAllowedOrigin(origin, req);
  }

  if (rawReferer) {
    const refererOrigin = parseOrigin(rawReferer);
    if (!refererOrigin) {
      return { allowed: false, reason: "referer header could not be parsed" };
    }
    return isAllowedOrigin(refererOrigin, req);
  }

  // Neither header is present — a non-browser client. There is no origin to
  // compare against.
  return { allowed: true };
}

/** Compares an origin against the app's own origin and the allow-list. */
function isAllowedOrigin(origin: string, req: Request): CsrfCheckResult {
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && origin === requestOrigin) return { allowed: true };

  if (ENV.allowedOrigins.includes(origin)) return { allowed: true };

  return {
    allowed: false,
    reason: `origin ${origin} is not allowed`,
  };
}

/**
 * Express middleware that rejects mutating requests from disallowed origins.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const result = checkOrigin(req);
  if (result.allowed) {
    next();
    return;
  }
  console.warn(`[CSRF] Rejected ${req.method} ${req.originalUrl}: ${result.reason}`);
  res.status(403).json({ error: "Cross-origin request rejected" });
}
