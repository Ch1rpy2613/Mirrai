import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, RATE_LIMITS, type RateLimitRule } from "./rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 60_000, scope: "user" };

describe("MemoryRateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("user-1", rule).allowed).toBe(true);
    }
    expect(limiter.check("user-1", rule).allowed).toBe(false);
  });

  it("keeps separate buckets per key", () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("user-1", rule);
    expect(limiter.check("user-1", rule).allowed).toBe(false);
    expect(limiter.check("user-2", rule).allowed).toBe(true);
  });

  it("keeps separate buckets per rule name", () => {
    const limiter = new MemoryRateLimiter();
    const other: RateLimitRule = { ...rule, name: "other" };
    for (let i = 0; i < 3; i++) limiter.check("user-1", rule);
    expect(limiter.check("user-1", other).allowed).toBe(true);
  });

  it("reports how long to wait when it refuses", () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("user-1", rule);
    const result = limiter.check("user-1", rule);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills once the window has passed", async () => {
    const limiter = new MemoryRateLimiter();
    const fastRule: RateLimitRule = { name: "fast", limit: 1, windowMs: 40, scope: "user" };
    expect(limiter.check("user-1", fastRule).allowed).toBe(true);
    expect(limiter.check("user-1", fastRule).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(limiter.check("user-1", fastRule).allowed).toBe(true);
  });

  it("resets a single key", () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("user-1", rule);
    limiter.reset("user-1");
    expect(limiter.check("user-1", rule).allowed).toBe(true);
  });

  it("resets everything", () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("user-1", rule);
    limiter.reset();
    expect(limiter.check("user-1", rule).allowed).toBe(true);
  });

  it("evicts old buckets once the cap is reached", () => {
    const limiter = new MemoryRateLimiter(10);
    for (let i = 0; i < 50; i++) limiter.check(`user-${i}`, rule);
    // The limiter keeps working; it just stops growing without bound.
    expect(limiter.check("user-0", rule).allowed).toBe(true);
  });
});

describe("the shipped rate limits", () => {
  it("scopes the auth limit to the IP", () => {
    expect(RATE_LIMITS.auth.scope).toBe("ip");
  });

  it("scopes the LLM limits to the user", () => {
    expect(RATE_LIMITS.llm.scope).toBe("user");
    expect(RATE_LIMITS.llmHeavy.scope).toBe("user");
  });

  it("allows a burst then refuses", () => {
    const limiter = new MemoryRateLimiter();
    let allowed = 0;
    for (let i = 0; i < RATE_LIMITS.llm.limit + 5; i++) {
      if (limiter.check("user-1", RATE_LIMITS.llm).allowed) allowed++;
    }
    expect(allowed).toBe(RATE_LIMITS.llm.limit);
  });
});
