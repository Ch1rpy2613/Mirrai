import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { getTextContent } from "../types";
import { parseSSEData } from "../sse";

function toClaudeContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image", source: { type: "url", url: p.url } };
  });
}

export class ClaudeProvider implements LLMProvider {
  name = "Claude";

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
  ) {}

  capabilities = {
    streaming: true,
    vision: true,
    tools: true,
    jsonMode: false,
  };

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Splits the system prompt out; Claude takes it as a top-level field. */
  private splitMessages(messages: LLMMessage[]) {
    let system: string | undefined;
    const filtered: LLMMessage[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        system = (system ? system + "\n" : "") + getTextContent(m.content);
      } else {
        filtered.push(m);
      }
    }
    return { system, filtered };
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const { system, filtered } = this.splitMessages(messages);

    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system,
        messages: filtered.map(m => ({ role: m.role, content: toClaudeContent(m.content) })),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Claude] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const textBlock = data.content?.find((b: any) => b.type === "text");
    return textBlock?.text ?? "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const { system, filtered } = this.splitMessages(messages);

    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system,
        stream: true,
        messages: filtered.map(m => ({ role: m.role, content: toClaudeContent(m.content) })),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Claude] LLM error ${response.status}: ${err}`);
    }

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.type === "content_block_delta") {
          const delta = parsed?.delta?.text;
          if (typeof delta === "string" && delta) yield { text: delta };
        }
      } catch {
        // Skip non-JSON frames.
      }
    }
  }
}
