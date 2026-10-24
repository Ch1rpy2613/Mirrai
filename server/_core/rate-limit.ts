/**
 * In-process rate limiting.
 *
 * Mirrai is a self-hosted app that normally runs as a single process, so an
 * in-memory limiter is enough for the common case. The `RateLimiter` interface
 * exists so a shared-store implementation (Redis, Postgres) can be dropped in
 * later without touching call sites — see the note in `RATE_LIMITS` about
 * multi-instance deployments.
 */
import type { Request } from "express";

export interface RateLimitRule {
  /** Stable name, used for logging and for resetting a bucket. */
  name: string;
  /** How many requests are allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Whether the bucket is keyed by client IP or by authenticated user id. */
  scope: "ip" | "user";
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds the caller should wait before retrying. */
  retryAfterMs: number;
  remaining: number;
}

export interface RateLimiter {
  check(key: string, rule: RateLimitRule): RateLimitResult;
  reset(key?: string): void;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket: tokens refill continuously at `limit / windowMs` per
 * millisecond, so a client can burst up to `limit` requests but settles back
 * to a steady rate.
 */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private maxBuckets = 10_000) {}

  check(key: string, rule: RateLimitRule): RateLimitResult {
    const now = Date.now();
    const bucketKey = `${rule.name}:${key}`;
    let bucket = this.buckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: rule.limit, updatedAt: now };
      this.buckets.set(bucketKey, bucket);
      this.evictIfNeeded();
    } else {
      const elapsed = now - bucket.updatedAt;
      const refillRate = rule.limit / rule.windowMs;
      bucket.tokens = Math.min(rule.limit, bucket.tokens + elapsed * refillRate);
      bucket.updatedAt = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(bucket.tokens) };
    }

    const refillRate = rule.limit / rule.windowMs;
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, Math.ceil(deficit / refillRate)),
      remaining: 0,
    };
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    for (const bucketKey of Array.from(this.buckets.keys())) {
      if (bucketKey.endsWith(`:${key}`)) this.buckets.delete(bucketKey);
    }
  }

  /** Drops the least recently used buckets once the map grows past the cap. */
  private evictIfNeeded() {
    if (this.buckets.size <= this.maxBuckets) return;
    const entries = Array.from(this.buckets.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    const excess = this.buckets.size - this.maxBuckets;
    for (let i = 0; i < excess; i++) {
      this.buckets.delete(entries[i][0]);
    }
  }
}

export const rateLimiter: RateLimiter = new MemoryRateLimiter();

/**
 * Rate limit buckets used by the app.
 *
 * NOTE: these are per-process. A multi-instance deployment would need a
 * shared store, otherwise each instance enforces its own budget and the
 * effective limit is multiplied by the instance count.
 */
export const RATE_LIMITS = {
  /** Registration and login — keyed by IP, to slow credential stuffing. */
  auth: { name: "auth", limit: 10, windowMs: 60_000, scope: "ip" } as RateLimitRule,
  /** Any LLM-costing call — keyed by user id. */
  llm: { name: "llm", limit: 30, windowMs: 60_000, scope: "user" } as RateLimitRule,
  /** Heavier LLM calls (extraction, generation, distillation). */
  llmHeavy: { name: "llm-heavy", limit: 10, windowMs: 60_000, scope: "user" } as RateLimitRule,
  /** File uploads — keyed by user id. */
  upload: { name: "upload", limit: 20, windowMs: 3_600_000, scope: "user" } as RateLimitRule,
};

/** Best-effort client IP, honouring a single proxy hop. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) {
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Resolves the bucket key for a rule, preferring the authenticated user id
 * when the rule is user-scoped and a session is available.
 */
export function resolveRateLimitKey(req: Request, rule: RateLimitRule, userId?: number): string {
  if (rule.scope === "user") return String(userId ?? getClientIp(req));
  return getClientIp(req);
}
