import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";

export class DifyProvider implements LLMProvider {
  name = "dify";

  constructor(
    private apiKey: string,
    private url: string,
  ) {}

  isConfigured(): boolean {
    return !!this.apiKey && !!this.url;
  }

  async invoke(messages: LLMMessage[], _options?: LLMOptions): Promise<string> {
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    const query = lastUserMsg ? getTextContent(lastUserMsg.content) : "";

    const response = await fetch(`${this.url.replace(/\/+$/, "")}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: "blocking",
        user: "girlfriend-bot",
        files: [],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Dify] error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.answer ?? "";
  }
}
