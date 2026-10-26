import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

/**
 * The app serves the user's own files from its own origin: chat logs,
 * photos, synthesised speech. So the browser's own decisions about what
 * a response is matter a great deal — and the app was not making any of
 * them.
 */
function run() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  securityHeaders({} as Request, res, next);
  return { headers, next };
}

describe("the headers every response carries", () => {
  it("tells the browser not to sniff the content", () => {
    // A file named `photo.jpg` can hold anything. Without this the
    // browser may decide that it is really HTML — and it would run in
    // the app's own origin.
    const { headers, next } = run();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(next).toHaveBeenCalled();
  });

  it("keeps other sites from framing the app", () => {
    const { headers } = run();
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("does not leak the address of the page in the referrer", () => {
    const { headers } = run();
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("never lets an uploaded file be a script", () => {
    const policy = contentSecurityPolicy();
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it("allows the styles React sets inline", () => {
    // Without this the app loses every dynamic style it has.
    expect(contentSecurityPolicy()).toContain("style-src 'self' 'unsafe-inline'");
  });
});
