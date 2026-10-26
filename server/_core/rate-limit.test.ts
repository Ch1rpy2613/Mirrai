import { describe, expect, it } from "vitest";
import { MemoryRateLimiter, RATE_LIMITS, getClientIp, type RateLimitRule } from "./rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 60_000, scope: "user" };

describe("MemoryRateLimiter", () => {
  it("allows requests up to the limit", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect((await limiter.check("user-1", rule)).allowed).toBe(true);
    }
    expect((await limiter.check("user-1", rule)).allowed).toBe(false);
  });

  it("keeps separate buckets per key", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) await limiter.check("user-1", rule);
    expect((await limiter.check("user-1", rule)).allowed).toBe(false);
    expect((await limiter.check("user-2", rule)).allowed).toBe(true);
  });

  it("keeps separate buckets per rule name", async () => {
    const limiter = new MemoryRateLimiter();
    const other: RateLimitRule = { ...rule, name: "other" };
    for (let i = 0; i < 3; i++) await limiter.check("user-1", rule);
    expect((await limiter.check("user-1", other)).allowed).toBe(true);
  });

  it("reports how long to wait when it refuses", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) await limiter.check("user-1", rule);
    const result = await limiter.check("user-1", rule);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills once the window has passed", async () => {
    const limiter = new MemoryRateLimiter();
    const fastRule: RateLimitRule = { name: "fast", limit: 1, windowMs: 40, scope: "user" };
    expect((await limiter.check("user-1", fastRule)).allowed).toBe(true);
    expect((await limiter.check("user-1", fastRule)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await limiter.check("user-1", fastRule)).allowed).toBe(true);
  });

  it("resets a single key", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) await limiter.check("user-1", rule);
    await limiter.reset("user-1");
    expect((await limiter.check("user-1", rule)).allowed).toBe(true);
  });

  it("resets everything", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) await limiter.check("user-1", rule);
    await limiter.reset();
    expect((await limiter.check("user-1", rule)).allowed).toBe(true);
  });

  it("evicts old buckets once the cap is reached", async () => {
    const limiter = new MemoryRateLimiter(10);
    for (let i = 0; i < 50; i++) await limiter.check(`user-${i}`, rule);
    // The limiter keeps working; it just stops growing without bound.
    expect((await limiter.check("user-0", rule)).allowed).toBe(true);
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

  it("allows a burst then refuses", async () => {
    const limiter = new MemoryRateLimiter();
    let allowed = 0;
    for (let i = 0; i < RATE_LIMITS.llm.limit + 5; i++) {
      if ((await limiter.check("user-1", RATE_LIMITS.llm)).allowed) allowed++;
    }
    expect(allowed).toBe(RATE_LIMITS.llm.limit);
  });
});

describe("the client's address", () => {
  it("is the address of the connection, not a header the client chose", () => {
    // The `X-Forwarded-For` header used to be believed, which made the
    // login limit — the only defence against credential stuffing — a
    // matter of sending one more header.
    const req = {
      ip: "203.0.113.7",
      socket: { remoteAddress: "203.0.113.7" },
      headers: { "x-forwarded-for": "1.2.3.4" },
    } as any;
    expect(getClientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to the socket when there is nothing else", () => {
    const req = { socket: { remoteAddress: "198.51.100.4" } } as any;
    expect(getClientIp(req)).toBe("198.51.100.4");
  });

  it("is never empty", () => {
    expect(getClientIp({} as any)).toBe("unknown");
  });
});
