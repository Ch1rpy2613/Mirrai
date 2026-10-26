import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { getTextContent } from "../types";
import { parseSSEData } from "../sse";

function toClaudeContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    /**
     * The picture.
     *
     * Claude takes a base64 source, not a URL — so a `data:` URL has
     * to be taken apart and handed over as the bytes. A plain URL is
     * still accepted, for the providers that fetch it themselves.
     */
    const inlined = /^data:([^;,]+);base64,(.*)$/s.exec(p.url);
    if (inlined) {
      return {
        type: "image",
        source: { type: "base64", media_type: inlined[1], data: inlined[2] },
      };
    }
    return { type: "image", source: { type: "url", url: p.url } };
  });
}

/**
 * Claude's temperature.
 *
 * Claude accepts 0 to 1, so a value meant for another provider is
 * clamped rather than refused: the API answers a temperature of 1.5
 * with an error, and the user would have been told the model failed.
 */
function claudeTemperature(temperature: number | undefined): number {
  if (typeof temperature !== "number" || Number.isNaN(temperature)) return 0.7;
  return Math.min(1, Math.max(0, temperature));
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
        // The temperature the user chose. It was never sent, so every
        // Claude reply used the provider's own default and the setting
        // was silently ignored for that provider.
        temperature: claudeTemperature(options?.temperature),
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
        temperature: claudeTemperature(options?.temperature),
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
