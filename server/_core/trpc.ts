import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { rateLimiter, resolveRateLimitKey, type RateLimitRule } from "./rate-limit";
import { copy } from "@shared/copy";

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
  if (error instanceof TRPCError) {
    const code = error.code;
    const locale = ctx?.locale ?? "zh";
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
      return {
        ...shape,
        message: "Something went wrong on the server.",
        data: { ...shape.data, message: undefined },
      };
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
    if (shape.message && shape.message !== code) return shape;
    return {
      ...shape,
      message: copy(locale, `errors.code.${codeKey(code)}`),
    };
  }
  return {
    ...shape,
    message: "Something went wrong on the server.",
    data: { ...shape.data, message: undefined },
  };
}

/**
 * The copy key for a tRPC error code.
 *
 * The code is upper case and joined with underscores; the key is
 * camel case and joined with a dot.
 */
function codeKey(code: string): string {
  const known = [
    "NOT_FOUND", "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT",
    "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "TOO_MANY_REQUESTS",
    "INTERNAL_SERVER_ERROR", "TIMEOUT",
  ];
  if (!known.includes(code)) return "unknown";
  return code
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
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
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
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
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
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
