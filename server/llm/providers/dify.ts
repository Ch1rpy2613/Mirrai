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

  /**
   * The query, and everything that has to go with it.
   *
   * Dify's workflow endpoint takes the *user's* message and nothing
   * else. The system prompt was dropped on the floor — so a persona
   * configured with Dify had no personality, no memory of the
   * relationship and no safety lines at all — and so was the
   * conversation: the persona replied as if every message were the
   * first.
   *
   * The system prompt is put at the front and the recent turns are put
   * in front of the question, separated by clear markers. It is a
   * transcript rather than a native multi-turn request, because Dify's
   * own multi-turn needs a `conversation_id` that this provider has
   * nowhere to keep.
   */
  private buildQuery(messages: LLMMessage[]): string {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => getTextContent(m.content))
      .filter(Boolean)
      .join("\n\n");

    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const lastUserMsg = turns.filter((m) => m.role === "user").pop();
    if (!lastUserMsg) return system;

    // The question itself, and the few turns before it.
    const history = turns
      .slice(-12)
      .map((m) => {
        const who = m.role === "user" ? "User" : "Assistant";
        return `${who}: ${getTextContent(m.content)}`;
      })
      .join("\n");

    const parts: string[] = [];
    if (system) parts.push(system);
    if (turns.length > 1) parts.push(history);
    parts.push(getTextContent(lastUserMsg.content));
    return parts.join("\n\n");
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
