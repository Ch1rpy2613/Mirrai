/**
 * Client side of the streaming chat endpoint.
 *
 * The server answers `POST /api/chat/stream` with Server-Sent Events:
 *
 *   event: delta    data: {"text":"..."}
 *   event: emotion  data: {"state":"warm","reason":"..."}
 *   event: done     data: {"messageId":1,"emotionalState":"warm",...}
 *   event: error    data: {"message":"...","partial":true}
 *
 * Frames can be split across network chunks, so the buffer is only consumed
 * once a complete frame (terminated by a blank line) is available.
 */

import { translate, type Locale } from "@/i18n";

export interface StreamDoneInfo {
  messageId: number;
  emotionalState: string;
  graduationSuggested: boolean;
  /**
   * The memories that were injected into this turn.
   *
   * The retrieval used to be invisible, so the persona could bring up
   * something from three months ago and the user had no way to know it
   * had been pulled from the store rather than invented.
   */
  recalled?: Array<{ id: number; title: string; subject: string }>;
  /**
   * A gentle nudge from the safety layer.
   *
   * `textKey` points at a dictionary entry so the wording follows the
   * interface language; `text` is the server's own Chinese fallback.
   */
  careNote: {
    kind: string;
    text: string;
    textKey?: string;
    showBanner: boolean;
  } | null;
  crisis: boolean;
}

export interface StreamChatCallbacks {
  /** Called for every chunk of the reply. */
  onDelta: (text: string) => void;
  onEmotion?: (state: string, reason?: string) => void;
  onDone?: (info: StreamDoneInfo) => void;
  onError?: (message: string, partial: boolean) => void;
}

export interface StreamChatOptions {
  personaId: number;
  message: string;
  /** The interface language — it decides the language of the prompt. */
  locale?: "zh" | "en";
  /**
   * The message being replied to.
   *
   * Without it every reply is a reply to "whatever came last", and a
   * long conversation becomes impossible to follow.
   */
  replyToId?: number;
  signal?: AbortSignal;
  callbacks: StreamChatCallbacks;
}

/**
 * True when the response indicates the streaming route is not available.
 *
 * The client then falls back to the ordinary tRPC mutation, so a server that
 * predates streaming still works.
 */
export function isStreamingUnsupported(status: number): boolean {
  return status === 404 || status === 501;
}

/**
 * Splits a raw SSE buffer into complete frames.
 *
 * Exported for testing: the splitting rules are the fiddly part.
 */
export function extractFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

/** Parses one SSE frame into its event name and JSON payload. */
export function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;

  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/**
 * Sends a message and streams the reply.
 */
/**
 * The sentence the server sent with the failure.
 *
 * The server answers with `{"error":"…"}` in the reader's language. It
 * used to answer with an English technical string, and the interface
 * showed it inside its own message.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const message = parsed.error ?? parsed.message;
      return typeof message === "string" ? message : "";
    } catch {
      // Not JSON — the body is the message.
      return text.slice(0, 300);
    }
  } catch {
    return "";
  }
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { personaId, message, replyToId, signal, callbacks } = options;
  /**
   * The interface's language.
   *
   * The client always sends one, but the option is optional — so the
   * error path passed `undefined` to `translate`, which threw inside
   * the error handler.
   */
  const locale: Locale = options.locale === "en" ? "en" : "zh";

  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ personaId, message, locale, replyToId }),
    signal,
  });

  if (!response.ok) {
    /**
     * The server's own sentence.
     *
     * The client used to make its own: "Streaming request failed with
     * status 429". So the interface showed an English technical string
     * inside its own Chinese message — for the one error the user was
     * most likely to hit.
     */
    const message = await readErrorMessage(response);
    const error = new Error(
      message || translate(locale, "errors.streamFailed", { status: response.status }),
    ) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const body = response.body;
  if (!body) {
    throw new Error(translate(locale, "errors.streamNoBody"));
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /**
   * Whether the turn was finished.
   *
   * The stream can end without a `done` — the connection drops, the
   * server is killed by a proxy, the body is truncated. The bubble was
   * then left streaming for ever: the interface showed a reply that
   * never stopped arriving, and there was nothing to press.
   */
  let settled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = extractFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (!parsed) continue;
        if (parsed.event === "done" || parsed.event === "error") settled = true;
        handleEvent(parsed, callbacks, locale);
      }
    }

    // A frame that arrived without its terminator is still worth handling.
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseFrame(tail);
      if (parsed) {
        if (parsed.event === "done" || parsed.event === "error") settled = true;
        handleEvent(parsed, callbacks, locale);
      }
    }

    /**
     * The turn ended without finishing.
     *
     * The bubble is left alone, so it keeps its spinning marker for
     * the rest of the session. The user is told the connection ended,
     * and what arrived is kept.
     */
    if (!settled) {
      callbacks.onError?.(
        translate(locale, "errors.streamEndedEarly"),
        true,
      );
    }
  } finally {
    /**
     * The body is cancelled, not just unlocked.
     *
     * Releasing the lock hands the reader back but leaves the body
     * unread, so the connection was not returned to the pool — and when
     * the user pressed "stop", the request was aborted while the
     * server was still writing into it.
     */
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function handleEvent(
  parsed: { event: string; data: unknown },
  callbacks: StreamChatCallbacks,
  locale: Locale,
): void {
  const data = parsed.data as Record<string, any>;

  switch (parsed.event) {
    case "delta":
      if (typeof data?.text === "string" && data.text) {
        callbacks.onDelta(data.text);
      }
      break;
    case "emotion":
      callbacks.onEmotion?.(data?.state, data?.reason);
      break;
    case "done":
      callbacks.onDone?.(data as StreamDoneInfo);
      break;
    case "error":
      /**
       * The sentence is the server's own — and when there is none, the
       * interface's.
       *
       * It was a hard-coded English "Unknown error", in a message that
       * is otherwise in the reader's language: so a Chinese reader saw
       * "生成中断：Unknown error".
       */
      callbacks.onError?.(
        data?.message || translate(locale, "errors.unknown"),
        !!data?.partial,
      );
      break;
    default:
      break;
  }
}
