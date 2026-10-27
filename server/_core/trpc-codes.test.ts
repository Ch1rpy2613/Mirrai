import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { formatErrorForClient } from "./trpc";

/**
 * What the client is told when something goes wrong, and how it knows.
 *
 * tRPC puts a *number* in the error's data — `data.code` is `-32001`,
 * not `"UNAUTHORIZED"`. So every place in the interface that compared
 * `error.data?.code` with a name was comparing a number with a string,
 * and never matched:
 *
 * - the retry policy, which never stopped retrying an error that said
 *   the session was over;
 * - the sign-in redirect, which looked for an English message instead;
 * - the chat page, which showed a generic error and a retry button
 *   where the "this persona is gone" page belonged;
 * - the sign-out, which swallowed the errors that were not really
 *   about the session at all.
 *
 * And the two errors the app says on its own behalf were English
 * strings with an internal code in them, thrown as the error's message
 * — so they were passed through to a Chinese interface, in English,
 * with a code number that means nothing to the reader.
 */

/** The shape the formatter actually sees. */
function shapeFor(code: string, message?: string) {
  return {
    message: message ?? code,
    code: -32001,
    data: { code: -32001, httpStatus: 401, path: "x" },
  };
}

describe("the code the client reads", () => {
  it("is the name of the code, not the number", () => {
    const error = new TRPCError({ code: "UNAUTHORIZED" });
    const formatted = formatErrorForClient({
      shape: shapeFor("UNAUTHORIZED"),
      error,
      ctx: { locale: "zh" },
    });

    /**
     * The number is what tRPC put there.
     *
     * Every comparison in the interface was against a name, so it never
     * matched — the retry never stopped, the redirect never fired, the
     * "this persona is gone" page never appeared.
     */
    expect(formatted.data.code).toBe("UNAUTHORIZED");
  });

  it("is there for every code, including the ones with a message", () => {
    const error = new TRPCError({ code: "NOT_FOUND", message: "没有找到" });
    const formatted = formatErrorForClient({
      shape: shapeFor("NOT_FOUND", "没有找到"),
      error,
      ctx: { locale: "zh" },
    });
    expect(formatted.data.code).toBe("NOT_FOUND");
    // The app's own message is still passed through.
    expect(formatted.message).toBe("没有找到");
  });

  it("is there for an error that was never a TRPCError", () => {
    const formatted = formatErrorForClient({
      shape: shapeFor("INTERNAL_SERVER_ERROR"),
      error: new Error("something"),
      ctx: { locale: "zh" },
    });
    expect(formatted.data.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("the two errors the app says on its own behalf", () => {
  it("says the session one in the reader's language", () => {
    /**
     * The shape the formatter really saw.
     *
     * The middleware threw the error *with* a message — "Please login
     * (10001)" — and the formatter passes an error's own message
     * through. So that English string, with the internal code in it,
     * was what reached a Chinese interface.
     */
    const error = new TRPCError({
      code: "UNAUTHORIZED",
      message: "Please login (10001)",
    });
    const chinese = formatErrorForClient({
      shape: shapeFor("UNAUTHORIZED", "Please login (10001)"),
      error,
      ctx: { locale: "zh" },
    });
    const english = formatErrorForClient({
      shape: shapeFor("UNAUTHORIZED", "Please login (10001)"),
      error,
      ctx: { locale: "en" },
    });

    /**
     * Not "Please login (10001)".
     *
     * That was an English string with an internal code in it, thrown as
     * the error's message — so it was passed through to a Chinese
     * interface, in English, with a number that means nothing to the
     * reader.
     */
    expect(chinese.message).toBe("请先登录。");
    expect(english.message).toBe("Please sign in first.");
    expect(chinese.message).not.toMatch(/10001/);
    expect(english.message).not.toMatch(/10001/);
  });

  it("says the permission one in the reader's language", () => {
    const error = new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have required permission (10002)",
    });
    const chinese = formatErrorForClient({
      shape: shapeFor("FORBIDDEN", "You do not have required permission (10002)"),
      error,
      ctx: { locale: "zh" },
    });
    const english = formatErrorForClient({
      shape: shapeFor("FORBIDDEN", "You do not have required permission (10002)"),
      error,
      ctx: { locale: "en" },
    });

    expect(chinese.message).toBe("没有权限做这件事。");
    expect(english.message).toBe("You are not allowed to do that.");
    expect(chinese.message).not.toMatch(/10002/);
  });
});
