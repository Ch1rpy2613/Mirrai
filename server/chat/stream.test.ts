import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * The SSE route is the only part of the streaming path that is not covered by
 * `service.test.ts`: the protocol itself (headers, event framing, ordering)
 * and the cancellation contract — a client that walks away has to abort the
 * upstream model call, otherwise somebody pays for tokens nobody reads.
 */

const authenticateRequest = vi.fn();
const getPersonaById = vi.fn();
const runConversation = vi.fn();

vi.mock("../_core/auth", () => ({
  authenticateRequest: (...a: unknown[]) => authenticateRequest(...a),
}));

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./service", () => ({
  runConversation: (...a: unknown[]) => runConversation(...a),
}));

vi.mock("../_core/rate-limit", () => {
  const RATE_LIMITS = {
    auth: { name: "auth", limit: 10, windowMs: 60_000, scope: "ip" },
    llm: { name: "llm", limit: 30, windowMs: 60_000, scope: "user" },
    llmHeavy: { name: "llm-heavy", limit: 10, windowMs: 60_000, scope: "user" },
    upload: { name: "upload", limit: 20, windowMs: 3_600_000, scope: "user" },
  };
  return {
    RATE_LIMITS,
    rateLimiter: {
      check: vi.fn(() => ({ allowed: true, retryAfterMs: 0, remaining: 29 })),
    },
    resolveRateLimitKey: vi.fn(() => "user:1"),
    getClientIp: vi.fn(() => "127.0.0.1"),
  };
});

import { registerChatStreamRoute } from "./stream-route";
import { rateLimiter } from "../_core/rate-limit";

type Frame = { event: string; data: any };

/** Reads an SSE response into frames. */
async function readFrames(
  response: Response,
  signal?: AbortSignal,
): Promise<Frame[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          frames.push({ event, data: JSON.parse(dataLines.join("\n")) });
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch {
    // The stream was aborted by the caller — that is the point of one of the
    // tests below.
    if (!signal?.aborted) throw new Error("stream read failed unexpectedly");
  }

  return frames;
}

let server: Server;
let baseUrl: string;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    registerChatStreamRoute(app);
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前任",
    togetherFrom: "2021-05",
    togetherTo: null,
    personaData: { personality: "温柔" },
    analysisStatus: "ready",
    emotionalState: "warm",
    chatCount: 10,
    intimacyScore: 120,
    intimacyLevel: "familiar",
    graduationStatus: null,
    llmProvider: null,
    activeSceneId: null,
    ...overrides,
  } as any;
}

describe("POST /api/chat/stream", () => {
  beforeEach(async () => {
    authenticateRequest.mockReset();
    getPersonaById.mockReset();
    runConversation.mockReset();
    (rateLimiter.check as any).mockClear();
    (rateLimiter.check as any).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
      remaining: 29,
    });

    authenticateRequest.mockResolvedValue({ id: 1, username: "tester" });
    getPersonaById.mockResolvedValue(persona());

    await startApp();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects an unauthenticated request", async () => {
    authenticateRequest.mockRejectedValue(new Error("no session"));

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
    });

    expect(res.status).toBe(401);
    expect(runConversation).not.toHaveBeenCalled();
  });

  it("rejects a request that trips the rate limit", async () => {
    (rateLimiter.check as any).mockReturnValue({
      allowed: false,
      retryAfterMs: 12_000,
      remaining: 0,
    });

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(runConversation).not.toHaveBeenCalled();
  });

  it("rejects a body that does not match the schema", async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: "not-a-number", message: "" }),
    });

    expect(res.status).toBe(400);
    expect(runConversation).not.toHaveBeenCalled();
  });

  it("returns 404 when the persona does not belong to the user", async () => {
    getPersonaById.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 99, message: "在吗" }),
    });

    expect(res.status).toBe(404);
    expect(runConversation).not.toHaveBeenCalled();
  });

  it("sends the SSE headers", async () => {
    runConversation.mockImplementation(async function* () {
      yield { type: "delta", text: "在" };
      yield {
        type: "done",
        messageId: 7,
        emotionalState: "warm",
        graduationSuggested: false,
        careNote: null,
        crisis: false,
      };
    });

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    await readFrames(res);
  });

  it("emits the deltas in order and closes with a done event", async () => {
    runConversation.mockImplementation(async function* () {
      yield { type: "delta", text: "在" };
      yield { type: "delta", text: "的" };
      yield { type: "emotion", state: "warm", reason: "日常问候" };
      yield {
        type: "done",
        messageId: 42,
        emotionalState: "warm",
        graduationSuggested: false,
        careNote: null,
        crisis: false,
      };
    });

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
    });

    const frames = await readFrames(res);

    expect(frames.map((f) => f.event)).toEqual([
      "delta",
      "delta",
      "emotion",
      "done",
    ]);
    expect(frames[0].data.text).toBe("在");
    expect(frames[1].data.text).toBe("的");
    expect(frames[2].data.state).toBe("warm");
    expect(frames[3].data.messageId).toBe(42);
    expect(frames[3].data.emotionalState).toBe("warm");

    // The joined deltas are the reply — the same text the non-streaming path
    // stores.
    expect(
      frames
        .filter((f) => f.event === "delta")
        .map((f) => f.data.text)
        .join(""),
    ).toBe("在的");
  });

  it("reports a mid-stream failure as an error event and keeps the partial text", async () => {
    runConversation.mockImplementation(async function* () {
      yield { type: "delta", text: "我在" };
      yield { type: "error", message: "upstream exploded", partial: true };
    });

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
    });

    const frames = await readFrames(res);
    const error = frames.find((f) => f.event === "error");

    expect(error).toBeDefined();
    expect(error!.data.message).toBe("upstream exploded");
    expect(error!.data.partial).toBe(true);
  });

  it("aborts the upstream call when the client disconnects", async () => {
    let capturedSignal: AbortSignal | undefined;
    let upstreamAborted = false;

    runConversation.mockImplementation(async function* (options: any) {
      capturedSignal = options?.signal;
      yield { type: "delta", text: "在" };
      // Stay open so the client has a chance to walk away.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      if (capturedSignal?.aborted) upstreamAborted = true;
    });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, message: "在吗" }),
      signal: controller.signal,
    });

    // Read the first frame, then hang up.
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();

    expect(capturedSignal).toBeDefined();
    // Give the server a moment to notice the closed socket.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(capturedSignal!.aborted).toBe(true);
  });
});
