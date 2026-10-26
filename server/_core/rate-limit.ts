/**
 * Rate limiting, shared across every process that runs the app.
 *
 * Mirrai is normally a single process, so an in-memory limiter is enough
 * for the common case. It is *not* enough when a second copy runs — the
 * two copies each enforce their own budget and the effective limit is
 * the sum, so a limit of 30 a minute quietly becomes 60.
 *
 * That is what the Redis store is for. The limiter asks Redis for the
 * bucket, and Redis does the arithmetic, so every copy counts against
 * the same number. The interface is unchanged, so a call site does not
 * know or care which store is behind it.
 *
 * When Redis is not there, the app falls back to the in-memory limiter
 * and says so once in the log. Redis makes the limits correct across
 * processes; it is not what makes the app run.
 */
import type { Request } from "express";
import { connectRedis, type RedisClient } from "./redis";

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
  check(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  reset(key?: string): void | Promise<void>;
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

  async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
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

/**
 * The token bucket, as a Lua script.
 *
 * It has to be one script: reading the bucket and writing it back is two
 * round trips, and between them another process can read the same number.
 *
 * The clock is Redis's own. Two copies of the app on two machines can
 * have their clocks a second apart, and a second is a visible fraction of
 * a 30-request-a-minute budget. Asking Redis what time it is costs
 * nothing and is the same answer for everybody.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

-- Effects replication, so the script may read the clock. Redis 7 does this
-- by default; older versions need to be told.
if redis.replicate_commands then pcall(redis.replicate_commands) end

local now = redis.call('TIME')
local ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)

local state = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(state[1])
local updatedAt = tonumber(state[2])
if tokens == nil then
  tokens = limit
  updatedAt = ms
end

local refill = limit / window
local elapsed = ms - updatedAt
if elapsed < 0 then elapsed = 0 end
tokens = math.min(limit, tokens + elapsed * refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'updatedAt', ms)
redis.call('PEXPIRE', key, math.ceil(window * 2))

local retry = 0
if allowed == 0 then
  retry = math.ceil((1 - tokens) / refill)
end
return { allowed, tostring(math.floor(tokens)), tostring(retry) }
`;

/**
 * The token bucket, counted by Redis.
 *
 * Every process that runs the app counts against the same bucket, so a
 * limit of 30 a minute means 30 a minute.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private client: RedisClient,
    /**
     * What to count on when the shared store is not there.
     *
     * Redis is not what makes the app run — the module says so itself —
     * so an outage has to mean "the limits are counted per process
     * again", not "every request fails". Without this, a Redis restart
     * on the user's machine turned every login and every chat into a
     * 500 with the message "Login failed".
     */
    private fallback: RateLimiter = new MemoryRateLimiter(),
  ) {}

  async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const bucketKey = `mirrai:ratelimit:${rule.name}:${key}`;
    let raw: Array<string | number>;
    try {
      raw = (await this.client.eval(TOKEN_BUCKET_SCRIPT, {
        keys: [bucketKey],
        arguments: [String(rule.limit), String(rule.windowMs)],
      })) as Array<string | number>;
    } catch (e) {
      console.warn(
        "[rate-limit] The shared store is unavailable — counting per process:",
        (e as Error).message,
      );
      return this.fallback.check(key, rule);
    }

    const allowed = Number(raw?.[0] ?? 0) === 1;
    const remaining = Number(raw?.[1] ?? 0);
    const retryAfterMs = Number(raw?.[2] ?? 0);
    return { allowed, retryAfterMs, remaining };
  }

  async reset(key?: string): Promise<void> {
    if (key === undefined) return;
    // `KEYS` walks the whole keyspace and blocks the server while it
    // does, so the keys are found with `SCAN` instead.
    const pattern = `mirrai:ratelimit:*:${key}`;
    const found: string[] = [];
    let cursor = "0";
    do {
      const reply = (await this.client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      })) as unknown as { cursor: string; keys: string[] };
      cursor = reply.cursor;
      found.push(...reply.keys);
    } while (cursor !== "0");
    if (found.length > 0) await this.client.del(found);
  }
}

/**
 * The limiter the app uses.
 *
 * It starts as the in-memory one and is replaced at startup if Redis is
 * reachable. A call site never sees the difference.
 */
export let rateLimiter: RateLimiter = new MemoryRateLimiter();

/**
 * Puts the shared limiter in place, if there is one to be had.
 *
 * Returns true when the limits are now shared across processes.
 */
export async function initRateLimiter(): Promise<boolean> {
  const redis = await connectRedis();
  if (!redis) {
    console.warn(
      "[rate-limit] No shared store — the limits count per process. " +
        "That is fine for one copy of Mirrai; two copies would each allow the full budget.",
    );
    return false;
  }
  rateLimiter = new RedisRateLimiter(redis.client);
  console.log(
    "[rate-limit] Counting against the shared store — the limits mean the same thing in every process.",
  );
  return true;
}

/**
 * Rate limit buckets used by the app.
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
  /**
   * Pictures and voice notes sent into a conversation.
   *
   * Their own bucket, because they are both a model call and a write to
   * the uploads directory. The "llm" bucket allowed thirty of them a
   * minute, which is a hundred megabytes a minute written to disk with
   * nothing ever cleaning it up.
   */
  chatMedia: { name: "chat-media", limit: 20, windowMs: 60_000, scope: "user" } as RateLimitRule,
  /**
   * Text-to-speech — keyed by user id.
   *
   * Its own bucket, because listening to a reply is not a model call and
   * sharing the "llm" bucket meant that pressing play on three messages
   * used up the allowance for three whole conversations.
   */
  tts: { name: "tts", limit: 30, windowMs: 60_000, scope: "user" } as RateLimitRule,
  /**
   * Starting a collection run — keyed by user id.
   *
   * Its own bucket, because a collection run is not a model call: it
   * spawns a Python process, and the DingTalk source drives a browser.
   * One click could therefore be worth a browser and half an hour.
   */
  collector: { name: "collector", limit: 5, windowMs: 60_000, scope: "user" } as RateLimitRule,
};

/**
 * The client's address, as far as the app can tell.
 *
 * The `X-Forwarded-For` header used to be read directly and believed.
 * Nothing ever said which proxies could be trusted with it, so the
 * header was simply whatever the caller said it was — and the only
 * defence against credential stuffing (ten login attempts a minute) was
 * bypassed by sending a different value with each request.
 *
 * The header is now only read when the request came from a proxy the
 * operator has listed in `TRUSTED_PROXIES`, which is also what Express's
 * own `trust proxy` is set from — so `req.ip` already accounts for it.
 */
export function getClientIp(req: Request): string {
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
