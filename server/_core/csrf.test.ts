import { describe, expect, it } from "vitest";
import { checkOrigin, getRequestOrigin } from "./csrf";
import type { Request } from "express";

function makeRequest(options: {
  method?: string;
  origin?: string;
  referer?: string;
  host?: string;
  protocol?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (options.origin) headers.origin = options.origin;
  if (options.referer) headers.referer = options.referer;
  if (options.host) headers.host = options.host;

  return {
    method: options.method ?? "POST",
    protocol: options.protocol ?? "http",
    headers,
  } as unknown as Request;
}

describe("checkOrigin", () => {
  it("allows safe methods", () => {
    expect(checkOrigin(makeRequest({ method: "GET" })).allowed).toBe(true);
    expect(checkOrigin(makeRequest({ method: "HEAD" })).allowed).toBe(true);
    expect(checkOrigin(makeRequest({ method: "OPTIONS" })).allowed).toBe(true);
  });

  it("allows a same-origin write", () => {
    const result = checkOrigin(
      makeRequest({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects a cross-origin write", () => {
    const result = checkOrigin(
      makeRequest({ origin: "https://evil.example", host: "localhost:3000" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("evil.example");
  });

  it("falls back to the referer when there is no origin", () => {
    const result = checkOrigin(
      makeRequest({ referer: "https://evil.example/page", host: "localhost:3000" }),
    );
    expect(result.allowed).toBe(false);
  });

  it("allows a request with neither header", () => {
    // A non-browser client; there is no origin to compare against.
    expect(checkOrigin(makeRequest({ host: "localhost:3000" })).allowed).toBe(true);
  });

  it("rejects a cross-origin referer", () => {
    const result = checkOrigin(
      makeRequest({ referer: "https://evil.example/", host: "localhost:3000" }),
    );
    expect(result.allowed).toBe(false);
  });

  it("does not treat a prefix of the host as the same origin", () => {
    const result = checkOrigin(
      makeRequest({ origin: "http://localhost:3000.evil.example", host: "localhost:3000" }),
    );
    expect(result.allowed).toBe(false);
  });
});

describe("getRequestOrigin", () => {
  it("combines the protocol and host", () => {
    expect(getRequestOrigin(makeRequest({ host: "example.com", protocol: "https" }))).toBe(
      "https://example.com",
    );
  });

  it("honours a forwarded protocol", () => {
    const req = {
      method: "POST",
      protocol: "http",
      headers: { host: "example.com", "x-forwarded-proto": "https" },
    } as unknown as Request;
    expect(getRequestOrigin(req)).toBe("https://example.com");
  });

  it("returns null without a host", () => {
    expect(getRequestOrigin({ method: "POST", protocol: "http", headers: {} } as unknown as Request)).toBeNull();
  });
});
