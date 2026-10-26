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
    // A key on its own is not enough. A provider with no base URL calls
    // "/chat/completions", which is not a URL, and one with no model is
    // refused by the API — and both used to report themselves as ready.
    return !!this.apiKey && !!this.baseUrl && !!this.model;
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

  /**
   * Turns a recording into words.
   *
   * The OpenAI-compatible speech-to-text endpoint: the file goes up,
   * the text comes back. It is the only honest way to hear a voice
   * message — the chat model cannot, and asking it to guess produced
   * words the user never said.
   */
  async transcribe(audio: Buffer, filename: string): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), filename);
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `The speech-to-text service answered ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      return (parsed.text ?? "").trim();
    } catch {
      // Some servers answer with the plain text.
      return raw.trim();
    }
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
    const message = data.choices?.[0]?.message;
    // Some providers answer with the reasoning in `reasoning_content` and
    // leave `content` empty. Reading only `content` turned such a reply
    // into an empty one, which the app then stored as "(silence)".
    const text = message?.content ?? message?.reasoning_content ?? "";
    return typeof text === "string" ? text : "";
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
        const choice = parsed?.choices?.[0]?.delta;
        const delta = choice?.content ?? choice?.reasoning_content;
        if (typeof delta === "string" && delta) yield { text: delta };
      } catch {
        // Skip frames that are not JSON (keep-alives, for instance).
      }
    }
  }
}
