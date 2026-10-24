import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { rateLimiter, resolveRateLimitKey, type RateLimitRule } from "./rate-limit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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
      const result = rateLimiter.check(key, rule);
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "请求过于频繁，请稍后再试",
        });
      }
      return opts.next();
  });
}
