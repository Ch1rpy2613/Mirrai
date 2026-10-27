import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { formatErrorForClient } from "./trpc";

/**
 * What the client is told when something goes wrong.
 *
 * An uncaught error in a procedure is usually a Postgres one, and a
 * Postgres error says a great deal about the shape of the database: the
 * name of the constraint, the name of the tables, the fact that the
 * database was not there at all. The user is told
 * "duplicate key value violates unique constraint users_username_key"
 * and learns the shape of the database, and so does a stranger.
 *
 * The message of a `TRPCError` is the app's own — it was written for
 * the person reading it — so that one is passed through.
 */
const shape = {
  message: "duplicate key value violates unique constraint \"users_username_key\"",
  code: -32603,
  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "x" },
};

describe("the errors the client is told", () => {
  it("does not leak a database error", () => {
    const error = new Error(
      'duplicate key value violates unique constraint "users_username_key"',
    );
    const formatted = formatErrorForClient({ shape, error });
    expect(formatted.message).not.toMatch(/constraint|duplicate key/i);
    expect(formatted.message).toBe("出了点问题。");
  });

  it("does not leak a database error that tRPC has already wrapped", () => {
    // This is the shape the formatter actually sees.
    //
    // tRPC wraps an unknown error in a `TRPCError` with the original as
    // its cause — and the message becomes the cause's message. So the
    // test above, which used a plain `Error`, never exercised the path
    // that runs in production: the leak was still there, and the test
    // said it was not.
    const cause = new Error(
      'duplicate key value violates unique constraint "users_username_key"',
    );
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
    const formatted = formatErrorForClient({
      shape: { message: cause.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
      error,
    });
    expect(formatted.message).not.toMatch(/constraint|duplicate key/i);
    expect(formatted.message).toBe("出了点问题。");
  });

  it("does not leak the SQL of a failed query", () => {
    const cause = new Error(
      'Failed query: select "id" from "users" where "users"."username" = $1 params: someone',
    );
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
    const formatted = formatErrorForClient({
      shape: { message: cause.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
      error,
    });
    expect(formatted.message).not.toMatch(/select|Failed query|params/i);
    expect(formatted.message).toBe("出了点问题。");
  });

  it("does not leak the path of a procedure either", () => {
    const formatted = formatErrorForClient({ shape, error: new Error("boom") });
    expect(JSON.stringify(formatted.data)).not.toContain("users_username_key");
  });

  it("says something a person can read when the code is the message", () => {
    // A procedure that throws `new TRPCError({ code: "NOT_FOUND" })`
    // without a message gets the *code* as its message — so the
    // interface showed the token "NOT_FOUND" under a heading that said
    // "not found".
    const error = new TRPCError({ code: "NOT_FOUND" });
    expect(error.message).toBe("NOT_FOUND");
    const formatted = formatErrorForClient({
      shape: { message: "NOT_FOUND", code: -32004, data: { code: "NOT_FOUND", httpStatus: 404 } },
      error,
      ctx: { locale: "zh" },
    });
    expect(formatted.message).not.toBe("NOT_FOUND");
    expect(formatted.message).toBe("没有找到要找的东西。");
  });

  it("says it in the reader's language", () => {
    const error = new TRPCError({ code: "FORBIDDEN" });
    const formatted = formatErrorForClient({
      shape: { message: "FORBIDDEN", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403 } },
      error,
      ctx: { locale: "en" },
    });
    expect(formatted.message).toBe("You are not allowed to do that.");
  });

  it("says it in the reader's language when the server fails", () => {
    // The message used to be an English string in a Chinese-first app —
    // so every failure that was not the app's own said itself in a
    // language the reader may not read.
    const cause = new Error("the database is not there");
    const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
    const formatted = formatErrorForClient({
      shape: { message: cause.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
      error,
      ctx: { locale: "en" },
    });
    expect(formatted.message).toBe("Something went wrong.");
  });

  it("does not blame the server for something the user typed", () => {
    /**
     * The input validation fails with the Zod error as the cause.
     *
     * The message became "Something went wrong on the server" — which
     * blames the server for a field the user filled in badly. And it
     * was in English, in a Chinese-first app.
     */
    const cause = { name: "ZodError", issues: [{ code: "invalid_type", path: ["name"] }] };
    const error = new TRPCError({ code: "BAD_REQUEST", cause: cause as any });
    const formatted = formatErrorForClient({
      shape: { message: "Invalid input", code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400 } },
      error,
      ctx: { locale: "zh" },
    });
    expect(formatted.message).toBe("这一项填得不对，请检查一下。");
    expect(formatted.message).not.toMatch(/server/i);
  });

  it("passes the app's own message through", () => {
    const error = new TRPCError({ code: "BAD_REQUEST", message: "A message the app wrote." });
    const formatted = formatErrorForClient({
      shape: { message: "A message the app wrote.", code: -32000, data: { code: "BAD_REQUEST", httpStatus: 400 } },
      error,
    });
    expect(formatted.message).toBe("A message the app wrote.");
  });
});
