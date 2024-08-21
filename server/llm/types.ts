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
};

export type InvokeParams = {
  messages: LLMMessage[];
  options?: LLMOptions;
};

export type InvokeResult = string;

export interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
}

export function getTextContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => (p as { type: "text"; text: string }).text).join("\n");
}
