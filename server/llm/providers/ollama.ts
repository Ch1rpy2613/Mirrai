import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";

export class OllamaProvider implements LLMProvider {
  name = "Ollama";

  constructor(
    private url: string,
    private model: string,
  ) {}

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
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Ollama] error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.message?.content ?? "";
  }
}
