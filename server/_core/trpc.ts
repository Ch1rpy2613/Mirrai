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
}: {
  shape: { message: string; code: number; data: Record<string, unknown> };
  error: unknown;
}): { message: string; code: number; data: Record<string, unknown> } {
  if (error instanceof TRPCError) return shape;
  return {
    ...shape,
    message: "Something went wrong on the server.",
    data: { ...shape.data, message: undefined },
  };
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
