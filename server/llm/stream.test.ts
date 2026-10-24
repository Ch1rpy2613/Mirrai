/**
 * Streaming primitives shared by every provider.
 *
 * The parsers are the part of the LLM layer that is easy to get subtly wrong:
 * a frame split across two TCP chunks, a malformed NDJSON line or a missing
 * `[DONE]` marker all turn into a truncated answer rather than an error. These
 * tests pin the framing behaviour down with real `Response` objects.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import { parseNDJSON, parseSSEData } from "./sse";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { DifyProvider } from "./providers/dify";
import { XunfeiProvider } from "./providers/xunfei";

/** Builds a real `Response` whose body is delivered in the given chunks. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Drains an async iterable into an array. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("parseSSEData", () => {
  it("delivers a frame that arrived split across two chunks", async () => {
    const response = streamResponse(['data: {"text":"hel', 'lo"}\n\n']);

    expect(await collect(parseSSEData(response))).toEqual(['{"text":"hello"}']);
  });

  it("yields every frame when one chunk carries several of them", async () => {
    const response = streamResponse(["data: one\n\ndata: two\n\ndata: three\n\n"]);

    expect(await collect(parseSSEData(response))).toEqual(["one", "two", "three"]);
  });

  it("skips a frame that carries no data field", async () => {
    const response = streamResponse(["event: ping\nid: 7\n\n"]);

    expect(await collect(parseSSEData(response))).toEqual([]);
  });

  it("skips comment lines (keep-alives)", async () => {
    const response = streamResponse([": keep-alive\n\ndata: real\n\n"]);

    expect(await collect(parseSSEData(response))).toEqual(["real"]);
  });

  it("surfaces the [DONE] marker so the caller can stop", async () => {
    const response = streamResponse(["data: one\n\ndata: [DONE]\n\n"]);

    expect(await collect(parseSSEData(response))).toEqual(["one", "[DONE]"]);
  });

  it("delivers a trailing frame that arrived without its terminator", async () => {
    const response = streamResponse(["data: last"]);

    expect(await collect(parseSSEData(response))).toEqual(["last"]);
  });
});

describe("parseNDJSON", () => {
  it("yields one message per line", async () => {
    const response = streamResponse([
      '{"message":{"role":"assistant","content":"你"}}\n',
      '{"message":{"role":"assistant","content":"好"}}\n',
    ]);

    expect(await collect(parseNDJSON(response))).toEqual(["你", "好"]);
  });

  it("skips a malformed line instead of throwing", async () => {
    const response = streamResponse([
      '{"message":{"content":"好"}}\n',
      "this is not json\n",
      '{"message":{"content":"在"}}\n',
    ]);

    expect(await collect(parseNDJSON(response))).toEqual(["好", "在"]);
  });

  it("skips a line that carries no content (the terminal frame)", async () => {
    const response = streamResponse([
      '{"message":{"content":"好"}}\n',
      '{"done":true,"done_reason":"stop"}\n',
    ]);

    expect(await collect(parseNDJSON(response))).toEqual(["好"]);
  });

  // The last line must arrive even without a trailing newline — the SSE
  // parser flushes its tail, and the NDJSON parser has to do the same or the
  // final chunk of a reply is lost.
  it("delivers the last line even without a trailing newline", async () => {
    const response = streamResponse([
      '{"message":{"content":"好"}}\n',
      '{"message":{"content":"最后一句"}}',
    ]);

    expect(await collect(parseNDJSON(response))).toEqual(["好", "最后一句"]);
  });
});

describe("provider capabilities", () => {
  it("declares vision support for the providers that understand images", () => {
    const openai = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    const claude = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");

    expect(openai.capabilities.vision).toBe(true);
    expect(claude.capabilities.vision).toBe(true);
  });

  it("declares no vision support for the providers that drop image parts", () => {
    const ollama = new OllamaProvider("http://localhost:11434", "llama3");
    const dify = new DifyProvider("app-test", "https://example.invalid");
    const xunfei = new XunfeiProvider("app-id", "api-key", "api-secret", "v3.5");

    // These three endpoints never see the image, so they must say so —
    // otherwise the image is silently dropped and the model answers as if it
    // had seen it.
    expect(ollama.capabilities.vision).toBe(false);
    expect(dify.capabilities.vision).toBe(false);
    expect(xunfei.capabilities.vision).toBe(false);
  });

  it("declares the full capability set for every provider", () => {
    const providers = [
      new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o"),
      new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid"),
      new OllamaProvider("http://localhost:11434", "llama3"),
      new DifyProvider("app-test", "https://example.invalid"),
      new XunfeiProvider("app-id", "api-key", "api-secret", "v3.5"),
    ];

    for (const provider of providers) {
      expect(Object.keys(provider.capabilities).sort()).toEqual([
        "jsonMode",
        "streaming",
        "tools",
        "vision",
      ]);
      expect(provider.capabilities.streaming).toBe(true);
    }
  });
});

describe("provider stream()", () => {
  const messages = [{ role: "user" as const, content: "在吗" }];

  it("yields the OpenAI text deltas and stops at [DONE]", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        "data: [DONE]\n\n",
        'data: {"choices":[{"delta":{"content":"不该出现"}}]}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    const chunks = await collect(provider.stream(messages));

    expect(chunks.map((c) => c.text).join("")).toBe("你好");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("yields the Claude content deltas", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":" there"}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    const chunks = await collect(provider.stream(messages));

    expect(chunks.map((c) => c.text).join("")).toBe("Hello there");
  });

  it("yields the Dify answer chunks", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(['data: {"answer":"在"}\n\n', 'data: {"answer":"的"}\n\n', "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DifyProvider("app-test", "https://example.invalid");
    const chunks = await collect(provider.stream(messages));

    expect(chunks.map((c) => c.text).join("")).toBe("在的");
  });

  it("yields the Ollama NDJSON content", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(['{"message":{"content":"在"}}\n', '{"message":{"content":"的"}}\n']),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    const chunks = await collect(provider.stream(messages));

    expect(chunks.map((c) => c.text).join("")).toBe("在的");
  });

  it("skips frames that are not JSON (keep-alives)", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(["data: ping\n\n", 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n']),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    const chunks = await collect(provider.stream(messages));

    expect(chunks.map((c) => c.text).join("")).toBe("好");
  });
});
