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
import { copy } from "@shared/copy";

const inputSchema = z.object({
  personaId: z.number(),
  message: z.string().min(1).max(2000),
  // The interface language — it decides which emotion triggers the
  // heuristic uses and which language the prompt is written in.
  locale: z.enum(["zh", "en"]).default("zh"),
  // The message being replied to, so the persona answers the thing that
  // was actually said rather than whatever came last.
  replyToId: z.number().optional(),
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

    const limit = await rateLimiter.check(
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
      // 410, not 404. A 404 here means "this route does not exist", and
      // the client uses that to decide the server is too old to stream and
      // to fall back to the ordinary request. A persona that is gone is
      // not an old server, and the fallback only produced a second,
      // confusing failure.
      res.status(410).json({ error: "Persona not found" });
      return;
    }
    if (persona.analysisStatus !== "ready") {
      res.status(400).json({ error: copy(parsed.data.locale, "errors.personaNotReady") });
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
    //
    // The response is what knows the connection is gone. The *request*
    // emits `close` as soon as its body has been read, which — because
    // the JSON parser reads it before this handler runs — happens before
    // a single token has been produced. Listening to it aborted every
    // stream before it began, and the client got an empty reply.
    const controller = new AbortController();
    const onClose = () => {
      // The response was ended normally; nothing to cancel.
      if (res.writableEnded) return;
      if (!controller.signal.aborted) controller.abort();
    };
    res.on("close", onClose);

    try {
      for await (const event of runConversation({
        persona,
        userId: user.id,
        message: parsed.data.message,
        providerName: (persona as any).llmProvider || undefined,
        mode: "stream",
        locale: parsed.data.locale,
        replyToId: parsed.data.replyToId,
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
            // Which memories went into this turn. The client reads them,
            // and the stream was the only place they were live — so the
            // chip that says what the persona recalled never appeared
            // until the history was polled again.
            recalled: event.recalled,
          });
        } else if (event.type === "error") {
          /**
           * The message the browser gets is the app's own.
           *
           * The pipeline's error carries the provider's own words — the
           * raw response body, the endpoint, the model name. That text
           * was written straight to the browser, and a Postgres error
           * can echo a stored value.
           */
          writeEvent(res, "error", {
            message: copy(parsed.data.locale, "errors.replyFailed"),
            partial: event.partial,
          });
        }
      }
    } catch (e) {
      console.error("[ChatStream] Failed:", e);
      try {
        writeEvent(res, "error", {
          /**
           * The app's own words, unless the error was written for the
           * person reading it.
           *
           * Everything else — a Postgres error, a provider's raw
           * response — is kept on the server.
           */
          message: e instanceof TRPCError
            ? e.message
            : copy(parsed.data.locale, "errors.replyFailed"),
          partial: false,
        });
      } catch {
        // The connection may already be gone.
      }
    } finally {
      res.off("close", onClose);
      res.end();
    }
  });
}
