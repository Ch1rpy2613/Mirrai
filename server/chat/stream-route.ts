/**
 * Token-by-token chat over Server-Sent Events.
 *
 * tRPC v11 has no streaming transport, so the streaming path is a plain
 * Express route. It shares the conversation pipeline with the tRPC
 * mutations — `runConversation` in `server/chat/service.ts` — so both paths
 * produce identical results.
 *
 * Event protocol:
 *   event: delta    data: {"text":"..."}
 *   event: emotion  data: {"state":"warm","reason":"..."}
 *   event: done     data: {"messageId":1,"emotionalState":"warm","graduationSuggested":false,"careNote":null}
 *   event: error    data: {"message":"...","partial":true}
 */
import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticateRequest } from "../_core/auth";
import { RATE_LIMITS, rateLimiter, resolveRateLimitKey } from "../_core/rate-limit";
import * as db from "../db";
import { runConversation } from "./service";

const inputSchema = z.object({
  personaId: z.number(),
  message: z.string().min(1).max(2000),
  // The interface language — it decides which emotion triggers the
  // heuristic uses and which language the prompt is written in.
  locale: z.enum(["zh", "en"]).default("zh"),
});

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerChatStreamRoute(app: Express): void {
  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    let user;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const limit = rateLimiter.check(
      resolveRateLimitKey(req, RATE_LIMITS.llm, user.id),
      RATE_LIMITS.llm,
    );
    if (!limit.allowed) {
      res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const persona = await db.getPersonaById(parsed.data.personaId, user.id);
    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    if (persona.analysisStatus !== "ready") {
      res.status(400).json({ error: "分身还未准备好，请先完成 AI 解析" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Stops reverse proxies from buffering the stream.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // If the client goes away, stop the upstream call — there is no point
    // paying for tokens nobody will read.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on("close", onClose);
    res.on("close", onClose);

    try {
      for await (const event of runConversation({
        persona,
        userId: user.id,
        message: parsed.data.message,
        providerName: (persona as any).llmProvider || undefined,
        mode: "stream",
        locale: parsed.data.locale,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;

        if (event.type === "delta") {
          writeEvent(res, "delta", { text: event.text });
        } else if (event.type === "emotion") {
          writeEvent(res, "emotion", { state: event.state, reason: event.reason });
        } else if (event.type === "done") {
          writeEvent(res, "done", {
            messageId: event.messageId,
            emotionalState: event.emotionalState,
            graduationSuggested: event.graduationSuggested,
            careNote: event.careNote,
            crisis: event.crisis,
          });
        } else if (event.type === "error") {
          writeEvent(res, "error", { message: event.message, partial: event.partial });
        }
      }
    } catch (e) {
      console.error("[ChatStream] Failed:", e);
      try {
        writeEvent(res, "error", {
          message: e instanceof TRPCError ? e.message : (e as Error).message,
          partial: false,
        });
      } catch {
        // The connection may already be gone.
      }
    } finally {
      req.off("close", onClose);
      res.off("close", onClose);
      res.end();
    }
  });
}
