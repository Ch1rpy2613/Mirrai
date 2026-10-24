import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";
import WebSocket from "ws";
import { createHmac } from "crypto";

export class XunfeiProvider implements LLMProvider {
  name = "xunfei";

  constructor(
    private appId: string,
    private apiKey: string,
    private apiSecret: string,
    private modelVersion: string,
  ) {}

  /**
   * The Spark WebSocket endpoint answers with text only and does not accept
   * image parts.
   */
  capabilities = {
    streaming: true,
    vision: false,
    tools: false,
    jsonMode: false,
  };

  isConfigured(): boolean {
    return !!this.appId && !!this.apiKey && !!this.apiSecret;
  }

  private getModelDomain(): string {
    const map: Record<string, string> = {
      "v1.1": "general", "v2.1": "generalv2", "v3.1": "generalv3",
      "v3.5": "generalv3.5", "pro-128k": "pro-128k",
      "max-32k": "max-32k", "v4.0": "4.0Ultra",
    };
    return map[this.modelVersion] || "4.0Ultra";
  }

  private generateWsUrl(): string {
    const host = "spark-api.xf-yun.com";
    const path = `/${this.modelVersion}/chat`;
    const date = new Date().toUTCString();
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signature = createHmac("sha256", this.apiSecret).update(signatureOrigin).digest("base64");
    const authOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authOrigin).toString("base64");
    return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    let result = "";
    for await (const chunk of this.stream(messages, options)) {
      result += chunk.text;
    }
    return result;
  }

  /**
   * The Spark endpoint already streams over its WebSocket; this exposes those
   * frames as an async iterable instead of accumulating them into one string.
   */
  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const wsUrl = this.generateWsUrl();
    const domain = this.getModelDomain();

    const queue: Array<{ text: string } | { error: Error } | { done: true }> = [];
    let notify: (() => void) | null = null;
    const wake = () => {
      notify?.();
      notify = null;
    };

    const socket = new WebSocket(wsUrl);
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // Already closing.
      }
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({
        header: { app_id: this.appId, uid: "girlfriend" },
        parameter: { chat: { domain, temperature: 0.8, max_tokens: 2048 } },
        payload: {
          message: {
            text: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
          },
        },
      }));
    });

    socket.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.header.code !== 0) {
          queue.push({ error: new Error(`[Xunfei] code ${data.header.code}: ${data.header.message}`) });
          wake();
          cleanup();
          return;
        }
        const text = data.payload?.choices?.text?.[0]?.content ?? "";
        if (text) queue.push({ text });
        if (data.header.status === 2) {
          queue.push({ done: true });
          wake();
          setTimeout(cleanup, 200);
        }
      } catch (e) {
        queue.push({ error: e instanceof Error ? e : new Error(String(e)) });
        wake();
        cleanup();
      }
    });

    socket.on("close", () => {
      queue.push({ done: true });
      wake();
    });

    socket.on("error", (e) => {
      queue.push({ error: new Error(`[Xunfei] ws error: ${e.message}`) });
      wake();
      cleanup();
    });

    // Honour cancellation: close the socket so the upstream stops billing.
    options?.signal?.addEventListener("abort", cleanup);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>(resolve => {
            notify = resolve;
          });
          continue;
        }
        const item = queue.shift()!;
        if ("done" in item) return;
        if ("error" in item) throw item.error;
        yield item;
      }
    } finally {
      cleanup();
    }
  }
}
