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
import { runConversation, PersonaAsleepError } from "./service";
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
  // codeql[js/missing-rate-limiting]
  app.post("/api/chat/stream", (req: Request, res: Response) => {
    /**
     * The route is limited.
     *
     * CodeQL cannot see it: the check is behind `rateLimiter.check`,
     * and it happens after the caller is known — because the limit is
     * keyed by the *user*, not by the address. A limit keyed by the
     * address would put everyone behind one NAT in the same bucket.
     */
    /**
     * The handler's failure is handled here.
     *
     * Express 4 does not wait for the promise an async handler
     * returns — so a rejection inside it is an unhandled rejection,
     * and Node ends the process. The whole app — the sessions, the
     * scheduler, the WeChat and Feishu channels — would go down
     * because the database blinked while somebody was reading a
     * reply.
     *
     * So the handler is a separate function and its failure is
     * answered here: the user gets an error, and the app keeps
     * running.
     */
    handleChatStream(req, res).catch((error) => {
      console.error("[ChatStream] The request failed:", error);
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      const locale = (req.body as { locale?: unknown } | undefined)?.locale === "en" ? "en" : "zh";
      res.status(500).json({ error: copy(locale, "errors.streamServerError") });
    });
  });
}

/**
 * The stream request itself.
 */
async function handleChatStream(req: Request, res: Response): Promise<void> {
    /**
     * The language the answer is in.
     *
     * The errors used to be English strings, and the interface showed
     * them inside its own message: "generation failed: Streaming
     * request failed with status 429". So the one error the user was
     * most likely to hit — they typed too fast — was the one they could
     * read least.
     *
     * The body is read leniently, because the request has not been
     * checked yet and the check needs the locale.
     */
    const askedLocale = (() => {
      const body = (req.body ?? {}) as { locale?: unknown };
      return body.locale === "en" ? "en" : "zh";
    })();

    let user;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: copy(askedLocale, "errors.streamUnauthorized") });
      return;
    }

    const limit = await rateLimiter.check(
      resolveRateLimitKey(req, RATE_LIMITS.llm, user.id),
      RATE_LIMITS.llm,
    );
    if (!limit.allowed) {
      res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
      res.status(429).json({ error: copy(askedLocale, "errors.streamTooManyRequests") });
      return;
    }

    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      /**
       * The message was too long.
       *
       * The generic "that request was not complete" says nothing about
       * what to do — and the text the user had written was lost with
       * it, because the composer is emptied before the request.
       */
      const tooLong = typeof (req.body as { message?: unknown })?.message === "string"
        && String((req.body as { message?: unknown }).message).length > 2000;
      res.status(400).json({
        error: copy(
          askedLocale,
          tooLong ? "errors.streamMessageTooLong" : "errors.streamInvalidRequest",
        ),
      });
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
          message: e instanceof TRPCError || e instanceof PersonaAsleepError
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
}
