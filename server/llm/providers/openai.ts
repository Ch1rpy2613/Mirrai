import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { getTextContent } from "../types";

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
  ) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const allMessages = this.systemMessage
      ? [{ role: "system" as const, content: this.systemMessage }, ...messages]
      : messages;

    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: allMessages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })),
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}
