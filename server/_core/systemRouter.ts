import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { registry } from "../llm";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /**
   * What this server can do.
   *
   * The client uses it to decide whether to stream a reply or to fall back
   * to the ordinary request — without having to discover the answer by
   * making a request that fails.
   */
  capabilities: publicProcedure.query(() => ({
    streaming: true,
    /** The provider that would be used when the client does not choose one. */
    defaultProvider: registry.getDefaultName() || null,
    providers: registry.list().filter((p) => p.configured).map((p) => p.name),
  })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await notifyOwner(input, ctx.user.id);
      return {
        success: result.delivered,
        channel: result.channel,
        ...(result.reason ? { reason: result.reason } : {}),
      } as const;
    }),
});
