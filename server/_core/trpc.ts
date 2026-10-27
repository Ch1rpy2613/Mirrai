import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { rateLimiter, resolveRateLimitKey, type RateLimitRule } from "./rate-limit";
import { copy, type CopyKey } from "@shared/copy";

/**
 * What the client is told when something goes wrong.
 *
 * Every uncaught error used to reach the client word for word, and an
 * uncaught error here is usually a Postgres one: a unique-violation
 * race that names the constraint, a foreign-key violation that names
 * the tables, or "DB not available". The user is told "duplicate key
 * value violates unique constraint users_username_key" and learns the
 * shape of the database, and a stranger learns it too.
 *
 * The message of a `TRPCError` is the app's own — it was written for
 * the person reading it — so it is passed through. Everything else is
 * replaced with something that says what happened without saying how.
 *
 * Exported so it can be tested on its own: the error formatter runs at
 * the edge, and a test that goes through the router never reaches it.
 */
export function formatErrorForClient({
  shape,
  error,
  ctx,
}: {
  shape: { message: string; code: number; data: Record<string, unknown> };
  error: unknown;
  ctx?: { locale?: "zh" | "en" };
}): { message: string; code: number; data: Record<string, unknown> } {
  const locale = ctx?.locale ?? "zh";
  /**
   * The code, by name, for the machine.
   *
   * tRPC puts a *number* in the error's data — `data.code` is
   * `-32001`, not `"UNAUTHORIZED"`. So every place in the interface
   * that compared `error.data?.code` with a name was comparing a number
   * with a string, and never matched:
   *
   * - the retry policy, which never stopped retrying an error that
   *   said the session was over;
   * - the sign-in redirect, which looked for the English message
   *   instead;
   * - the chat page, which showed a generic error and a retry button
   *   where the "this persona is gone" page belonged;
   * - the sign-out, which swallowed the errors that were not really
   *   about the session at all.
   *
   * So the name goes into the data — and the number stays where tRPC
   * put it, because tRPC's own client checks the *top-level* code and
   * that one has to stay a number.
   */
  const withCode = (
    result: { message: string; code: number; data: Record<string, unknown> },
    code: string,
  ) => ({ ...result, data: { ...result.data, code } });

  if (error instanceof TRPCError) {
    const code = error.code;
    /**
     * An error from somewhere else.
     *
     * tRPC wraps an unknown error in a `TRPCError` with the original
     * as its `cause` — and the message becomes the cause's message. So
     * a Postgres error reached the browser word for word: the SQL, the
     * table names, the constraint names and the parameter values.
     *
     * The test for this used a plain `Error`, which the formatter never
     * sees — tRPC has already wrapped it by then. The test passed and
     * the leak was still there.
     */
    if (error.cause) {
      /**
       * A field the user filled in badly.
       *
       * tRPC's input validation fails with the Zod error as the cause —
       * and the message became "Something went wrong on the server",
       * which blames the server for something the user typed. And it
       * was in English, in a Chinese-first app.
       */
      if (isValidationError(error.cause)) {
        return withCode(
          {
            ...shape,
            message: copy(locale, "errors.invalidInput"),
            data: { ...shape.data, message: undefined },
          },
          code,
        );
      }
      return withCode(
        {
          ...shape,
          // The reader's language. The message used to be an English
          // string in a Chinese-first app — so every failure that was
          // not the app's own said itself in a language the reader may
          // not read.
          message: copy(locale, "errors.code.internalServerError"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    /**
     * The two the app says on its own behalf.
     *
     * They used to be English strings with an internal code in them —
     * "Please login (10001)" and "You do not have required permission
     * (10002)" — and they were thrown as the error's message, so they
     * were passed through to the interface. So a Chinese user whose
     * session had expired was told, in a Chinese interface, in English,
     * with a code number that means nothing to them.
     *
     * The shared copy table already had the right sentences for exactly
     * these two codes; they just were not used.
     */
    if (code === "UNAUTHORIZED") {
      return withCode(
        {
          ...shape,
          message: copy(locale, "errors.code.unauthorized"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    if (code === "FORBIDDEN") {
      return withCode(
        {
          ...shape,
          message: copy(locale, "errors.code.forbidden"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    /**
     * A procedure that throws without a message gets the *code* as its
     * message.
     *
     * tRPC fills it in: `message = opts.message ?? cause?.message ??
     * opts.code`. So `new TRPCError({ code: "NOT_FOUND" })` reached the
     * interface as the token "NOT_FOUND" — and every toast that shows
     * `e.message` showed it too.
     *
     * The code is for the machine. This is for the person.
     */
    if (shape.message && shape.message !== code) {
      return withCode(shape, code);
    }
    return withCode(
      {
        ...shape,
        message: copy(locale, codeKey(code)),
      },
      code,
    );
  }
  return withCode(
    {
      ...shape,
      message: copy(locale, "errors.code.internalServerError"),
      data: { ...shape.data, message: undefined },
    },
    "INTERNAL_SERVER_ERROR",
  );
}

/**
 * Whether an error is the app's own input validation.
 *
 * The shape is checked rather than the class: there can be more than
 * one copy of the validation library in the tree, and `instanceof` says
 * "no" when the error came from the other one.
 */
function isValidationError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const record = cause as { name?: unknown; issues?: unknown };
  return record.name === "ZodError" || Array.isArray(record.issues);
}

/**
 * The copy key for a tRPC error code.
 *
 * The code is upper case and joined with underscores; the key is
 * camel case and joined with a dot.
 *
 * The result is typed as a copy key, so the table of codes and the
 * table of sentences cannot drift apart: a code that has no sentence
 * would be a compile error rather than a key that renders as itself
 * in the interface.
 */
function codeKey(code: string): CopyKey {
  const known = [
    "NOT_FOUND", "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT",
    "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "TOO_MANY_REQUESTS",
    "INTERNAL_SERVER_ERROR", "TIMEOUT",
  ] as const;
  if (!known.includes(code as (typeof known)[number])) return "errors.code.unknown";
  const camel = (code as string)
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
  return `errors.code.${camel}` as CopyKey;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: formatErrorForClient,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    // The message is replaced by the formatter, in the reader's
    // language — what is left here is only the code.
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      // The message is replaced by the formatter, in the reader's
      // language — what is left here is only the code.
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Restricts how often a procedure may be called.
 *
 * The bucket is keyed by the authenticated user when one is available, and
 * by client IP otherwise — so the limit cannot be side-stepped by signing in
 * as somebody else, nor by logging out.
 */
export function rateLimit(rule: RateLimitRule) {
  return t.middleware(async opts => {
      const key = resolveRateLimitKey(opts.ctx.req, rule, opts.ctx.user?.id);
      const result = await rateLimiter.check(key, rule);
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: copy(opts.ctx.locale, "errors.rateLimited"),
        });
      }
      return opts.next();
  });
}
