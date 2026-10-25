import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { RedisRateLimiter } from "./rate-limit";
import { connectRedis, closeRedis, withRedisLock } from "./redis";
import type { RateLimitRule } from "./rate-limit";

/**
 * The shared store.
 *
 * These tests need a Redis. They are skipped when there is not one,
 * because the app must work without it — but when there is one, the
 * limiter has to count against it, not against a local map.
 */
const rule: RateLimitRule = { name: "shared-test", limit: 3, windowMs: 60_000, scope: "user" };

let available = false;

beforeAll(async () => {
  const handle = await connectRedis();
  available = Boolean(handle);
  if (!available) {
    console.warn("[redis.test] No Redis — the shared-store tests are skipped.");
  }
});

afterAll(async () => {
  await closeRedis();
});

describe("the Redis rate limiter", () => {
  it("counts against the shared bucket", async () => {
    if (!available) return;
    const limiter = new RedisRateLimiter((await connectRedis())!.client);
    const key = `user-${Date.now()}`;

    let allowed = 0;
    for (let i = 0; i < 5; i++) {
      if ((await limiter.check(key, rule)).allowed) allowed++;
    }
    expect(allowed).toBe(rule.limit);
  });

  it("gives two limiters the same budget, the way two processes would", async () => {
    if (!available) return;
    const handle = (await connectRedis())!;
    // Two limiters, as though they were two copies of the app.
    const first = new RedisRateLimiter(handle.client);
    const second = new RedisRateLimiter(handle.client);
    const key = `shared-${Date.now()}`;

    let allowed = 0;
    for (let i = 0; i < 2; i++) {
      if ((await first.check(key, rule)).allowed) allowed++;
    }
    for (let i = 0; i < 2; i++) {
      if ((await second.check(key, rule)).allowed) allowed++;
    }
    // The budget is three, not three each.
    expect(allowed).toBe(rule.limit);
  });

  it("keeps separate buckets per key", async () => {
    if (!available) return;
    const limiter = new RedisRateLimiter((await connectRedis())!.client);
    const stamp = Date.now();
    for (let i = 0; i < 3; i++) await limiter.check(`a-${stamp}`, rule);
    expect((await limiter.check(`a-${stamp}`, rule)).allowed).toBe(false);
    expect((await limiter.check(`b-${stamp}`, rule)).allowed).toBe(true);
  });

  it("refills once the window has passed", async () => {
    if (!available) return;
    const limiter = new RedisRateLimiter((await connectRedis())!.client);
    const fast: RateLimitRule = { name: "shared-fast", limit: 1, windowMs: 300, scope: "user" };
    const key = `fast-${Date.now()}`;

    expect((await limiter.check(key, fast)).allowed).toBe(true);
    expect((await limiter.check(key, fast)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await limiter.check(key, fast)).allowed).toBe(true);
  });
});

describe("the cross-process lock", () => {
  it("lets only one holder in at a time", async () => {
    if (!available) return;
    const name = `lock-${Date.now()}`;
    let running = 0;
    let maxConcurrent = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        withRedisLock(name, 5000, async () => {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running--;
          return true;
        }),
      ),
    );

    // Only one holder at a time — that is the whole point.
    expect(maxConcurrent).toBe(1);
  });

  it("reports that it could not take the lock", async () => {
    if (!available) return;
    const name = `lock-busy-${Date.now()}`;
    const held = await withRedisLock(name, 5000, async () => {
      // While this one is held, another must be turned away.
      const second = await withRedisLock(name, 5000, async () => "ran");
      return second;
    });
    expect(held).toBeNull();
  });
});
