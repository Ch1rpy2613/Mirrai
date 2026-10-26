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
    expect(formatted.message).toBe("Something went wrong on the server.");
  });

  it("does not leak the path of a procedure either", () => {
    const formatted = formatErrorForClient({ shape, error: new Error("boom") });
    expect(JSON.stringify(formatted.data)).not.toContain("users_username_key");
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
