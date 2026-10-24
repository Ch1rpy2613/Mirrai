import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";
import { parseNDJSON } from "../sse";

export class OllamaProvider implements LLMProvider {
  name = "Ollama";

  constructor(
    private url: string,
    private model: string,
  ) {}

  /**
   * Ollama accepts image parts in its API, but the chat endpoint used here
   * drops them. Declaring `vision: false` makes the caller report the
   * limitation instead of answering as if the image had been seen.
   */
  capabilities = {
    streaming: true,
    vision: false,
    tools: false,
    jsonMode: false,
  };

  isConfigured(): boolean {
    return !!this.url && !!this.model;
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
        stream: false,
        options: options?.temperature != null ? { temperature: options.temperature } : undefined,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Ollama] error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.message?.content ?? "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
        stream: true,
        options: options?.temperature != null ? { temperature: options.temperature } : undefined,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Ollama] error ${response.status}: ${err}`);
    }

    for await (const text of parseNDJSON(response)) {
      yield { text };
    }
  }
}
