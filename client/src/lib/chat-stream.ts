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

export interface StreamDoneInfo {
  messageId: number;
  emotionalState: string;
  graduationSuggested: boolean;
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
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { personaId, message, locale, signal, callbacks } = options;

  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ personaId, message, locale }),
    signal,
  });

  if (!response.ok) {
    const error = new Error(`Streaming request failed with status ${response.status}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const body = response.body;
  if (!body) {
    throw new Error("Streaming response has no body");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        handleEvent(parsed, callbacks);
      }
    }

    // A frame that arrived without its terminator is still worth handling.
    const tail = buffer.trim();
    if (tail) {
      const parsed = parseFrame(tail);
      if (parsed) handleEvent(parsed, callbacks);
    }
  } finally {
    reader.releaseLock();
  }
}

function handleEvent(
  parsed: { event: string; data: unknown },
  callbacks: StreamChatCallbacks,
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
      callbacks.onError?.(data?.message ?? "Unknown error", !!data?.partial);
      break;
    default:
      break;
  }
}
