export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
};

export type LLMOptions = {
  maxTokens?: number;
  temperature?: number;
  provider?: string;
  /** Cancels an in-flight request (used by the streaming route). */
  signal?: AbortSignal;
};

/**
 * What a provider is able to do.
 *
 * The capability flags exist so a caller can fail loudly instead of silently
 * degrading: before this existed, sending an image to Ollama or Dify quietly
 * dropped the image and answered from the text alone.
 */
export interface LLMCapabilities {
  /** Supports token-by-token streaming. */
  streaming: boolean;
  /** Understands `image_url` content parts. */
  vision: boolean;
  /** Supports function/tool calling. */
  tools: boolean;
  /** Supports a native structured-JSON output mode. */
  jsonMode: boolean;
}

export const NO_CAPABILITIES: LLMCapabilities = {
  streaming: false,
  vision: false,
  tools: false,
  jsonMode: false,
};

export type LLMStreamChunk = { text: string };

export type InvokeParams = {
  messages: LLMMessage[];
  options?: LLMOptions;
};

export type InvokeResult = string;

export interface LLMProvider {
  name: string;
  maxAttempts?: number;
  /** Declared once at construction; every provider must set it. */
  capabilities: LLMCapabilities;
  isConfigured(): boolean;
  invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  /** Optional: yields text incrementally. */
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
}

export function getTextContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => (p as { type: "text"; text: string }).text).join("\n");
}

/** True when the message carries at least one non-text part. */
export function hasNonTextContent(content: string | LLMContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some(p => p.type !== "text");
}
