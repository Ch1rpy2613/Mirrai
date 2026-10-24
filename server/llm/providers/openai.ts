import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { parseSSEData } from "../sse";

function toOpenAIContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private systemMessage?: string,
    public readonly maxAttempts = 3,
  ) {}

  capabilities = {
    streaming: true,
    vision: true,
    tools: true,
    jsonMode: true,
  };

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private buildMessages(messages: LLMMessage[]): LLMMessage[] {
    return this.systemMessage
      ? [{ role: "system" as const, content: this.systemMessage }, ...messages]
      : messages;
  }

  private buildBody(messages: LLMMessage[], options: LLMOptions | undefined, stream: boolean) {
    return JSON.stringify({
      model: this.model,
      messages: this.buildMessages(messages).map(m => ({
        role: m.role,
        content: toOpenAIContent(m.content),
      })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      ...(stream ? { stream: true } : {}),
    });
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildBody(messages, options, false),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildBody(messages, options, true),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield { text: delta };
      } catch {
        // Skip frames that are not JSON (keep-alives, for instance).
      }
    }
  }
}
