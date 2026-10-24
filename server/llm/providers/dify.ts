import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";
import { parseSSEData } from "../sse";

export class DifyProvider implements LLMProvider {
  name = "dify";

  constructor(
    private apiKey: string,
    private url: string,
  ) {}

  /**
   * Dify's workflow endpoint accepts only the latest user message, so image
   * parts never reach the model.
   */
  capabilities = {
    streaming: true,
    vision: false,
    tools: false,
    jsonMode: false,
  };

  isConfigured(): boolean {
    return !!this.apiKey && !!this.url;
  }

  private buildQuery(messages: LLMMessage[]): string {
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    return lastUserMsg ? getTextContent(lastUserMsg.content) : "";
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        inputs: {},
        query: this.buildQuery(messages),
        response_mode: "blocking",
        user: "girlfriend-bot",
        files: [],
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Dify] error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.answer ?? "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        inputs: {},
        query: this.buildQuery(messages),
        response_mode: "streaming",
        user: "girlfriend-bot",
        files: [],
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Dify] error ${response.status}: ${err}`);
    }

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        const answer = parsed?.answer;
        if (typeof answer === "string" && answer) yield { text: answer };
      } catch {
        // Skip non-JSON frames.
      }
    }
  }
}
