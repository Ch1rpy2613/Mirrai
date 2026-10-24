/**
 * Emotional state inference.
 *
 * The keyword heuristic in `persona-utils.ts` is cheap but brittle: "想你" in
 * any context forces `nostalgic`, and unseen phrasing falls back to the current
 * state. This module asks the LLM to read the actual exchange and pick a
 * state, then falls back to the heuristic whenever the model is unavailable,
 * errors, or returns something outside the enum.
 */
import { llmService } from "../llm";
import { extractJsonObject } from "./json";
import { computeEmotionalState } from "./persona-utils";
import { ENV } from "./env";
import type { LLMProvider } from "../llm/types";

export const EMOTIONAL_STATES = [
  "warm",
  "playful",
  "nostalgic",
  "melancholy",
  "happy",
  "distant",
] as const;

export type EmotionalState = (typeof EMOTIONAL_STATES)[number];

export function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (EMOTIONAL_STATES as readonly string[]).includes(value);
}

const SYSTEM_PROMPT = `你是一个情感状态分类器。阅读一段对话，判断"分身"此刻的六大情绪状态之一。

六大状态及其含义：
- warm: 温柔、放松、亲近、有回应感（默认基调）
- playful: 俏皮、开玩笑、活泼、撒娇
- nostalgic: 怀念过去、触景生情、提到回忆或从前
- melancholy: 低落、难过、失落、脆弱
- happy: 明显开心、兴奋、愉悦
- distant: 疏离、敷衍、心不在焉、想结束话题

判断依据：
1. 以分身（assistant）的语气为主要依据，而不是用户说了什么。用户说"想你"不等于分身处于怀念状态。
2. 考虑整段对话的情绪走向，不要只看单个词。
3. 如果没有明确的情绪信号，保留当前状态。
4. 区分近义状态：怀念≠难过，开心的活跃≠俏皮撒娇，敷衍冷淡≠忧郁低落。

只返回 JSON，不要任何其他文字：{"state":"<六个状态之一>","reason":"<15字以内理由>"}`;

const SYSTEM_PROMPT_EN = `You are an emotional state classifier. Read a conversation and decide which of the six states the persona is in.

The six states:
- warm: relaxed, affectionate, responsive (the default tone)
- playful: joking, lively, a little spoiled
- nostalgic: thinking back, reminded of the past, mentioning memories
- melancholy: low, sad, vulnerable
- happy: clearly happy, excited, cheerful
- distant: aloof, perfunctory, distracted, ending the topic

Guidelines:
1. Judge primarily by the persona's (assistant) tone, not by what the user said.
2. Consider the emotional direction of the whole exchange, not a single word.
3. If there is no clear signal, keep the current state.
4. Distinguish near neighbours: nostalgic is not melancholy, cheerful is not playful, curt is not sad.

Return JSON only: {"state":"<one of the six states>","reason":"<15 words or fewer>"}`;

export interface EmotionInferenceResult {
  state: EmotionalState;
  source: "llm" | "heuristic";
  reason?: string;
}

/**
 * Infers the persona's emotional state after an exchange.
 *
 * `provider` selects which configured LLM to use; when omitted the registry
 * default (or first configured provider) is used. `providerInstance` is the
 * already-resolved provider — pass it when the caller has one, so the
 * classifier runs on the same credentials as the rest of the conversation
 * instead of silently falling back to the environment key.
 */
export async function inferEmotionalState(params: {
  userMessage: string;
  assistantReply: string;
  currentState: string;
  provider?: string;
  providerInstance?: LLMProvider;
  locale?: "zh" | "en";
}): Promise<EmotionInferenceResult> {
  const locale = params.locale ?? "zh";
  const useHeuristic = (): EmotionInferenceResult => ({
    state: computeEmotionalState(
      params.userMessage,
      params.assistantReply,
      params.currentState,
      locale,
    ) as EmotionalState,
    source: "heuristic",
  });

  // Explicit opt-out: keyword heuristic only, no extra LLM round-trip.
  if (ENV.emotionEngine === "heuristic") {
    return useHeuristic();
  }

  try {
    const messages = [
      { role: "system" as const, content: locale === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT },
      {
        role: "user" as const,
        content:
          locale === "en"
            ? `Current state: ${params.currentState || "warm"}\n\nUser: ${params.userMessage}\n\nPersona: ${params.assistantReply}`
            : `当前状态：${params.currentState || "warm"}\n\n用户：${params.userMessage}\n\n分身：${params.assistantReply}`,
      },
    ];

    const response = params.providerInstance
      ? await llmService.invokeWithProvider(params.providerInstance, {
          messages,
          options: { provider: params.provider, temperature: 0, maxTokens: 200 },
        })
      : await llmService.invoke({
          messages,
          options: { provider: params.provider, temperature: 0, maxTokens: 200 },
        });

    const parsed = extractJsonObject(response);
    const state = parsed?.state;
    if (!isEmotionalState(state)) {
      return useHeuristic();
    }

    const reason = typeof parsed?.reason === "string" ? parsed.reason.slice(0, 60) : undefined;
    return { state, source: "llm", reason };
  } catch (e) {
    console.warn("[Emotion] LLM inference failed, using heuristic:", (e as Error).message);
    return useHeuristic();
  }
}
