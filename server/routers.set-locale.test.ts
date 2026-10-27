import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The language switch.
 *
 * It is on the landing page — the front door, shown to anybody who has
 * not signed in. So it sent a request that only a signed-in user may
 * send, got "please sign in" back, and the app's own handler for that
 * threw the visitor out to the sign-in page: to change the language you
 * had to sign in.
 *
 * The language itself was already saved in the browser. They were thrown
 * out for nothing.
 */

const setUserLocale = vi.fn();

vi.mock("./db", () => ({
  setUserLocale: (...a: unknown[]) => setUserLocale(...a),
}));

import { appRouter } from "./routers";

function ctxFor(user: unknown): TrpcContext {
  return {
    user: user as TrpcContext["user"],
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("the language the user reads", () => {
  beforeEach(() => {
    setUserLocale.mockReset();
    setUserLocale.mockResolvedValue(undefined);
  });

  it("works for somebody who is not signed in", async () => {
    const result = await appRouter
      .createCaller(ctxFor(null))
      .user.setLocale({ locale: "en" });

    // No error — so the app does not throw the visitor to the sign-in page.
    expect(result).toEqual({ success: true });
    // And there is nobody to write it for.
    expect(setUserLocale).not.toHaveBeenCalled();
  });

  it("still remembers it for somebody who is signed in", async () => {
    const user = { id: 7, username: "sample", passwordHash: "h" };
    const result = await appRouter
      .createCaller(ctxFor(user))
      .user.setLocale({ locale: "en" });

    expect(result).toEqual({ success: true });
    expect(setUserLocale).toHaveBeenCalledWith(7, "en");
  });
});
