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

export interface EmotionInferenceResult {
  state: EmotionalState;
  source: "llm" | "heuristic";
  reason?: string;
}

/**
 * Infers the persona's emotional state after an exchange.
 *
 * `provider` selects which configured LLM to use; when omitted the registry
 * default (or first configured provider) is used.
 */
export async function inferEmotionalState(params: {
  userMessage: string;
  assistantReply: string;
  currentState: string;
  provider?: string;
}): Promise<EmotionInferenceResult> {
  const useHeuristic = (): EmotionInferenceResult => ({
    state: computeEmotionalState(params.userMessage, params.assistantReply, params.currentState) as EmotionalState,
    source: "heuristic",
  });

  // Explicit opt-out: keyword heuristic only, no extra LLM round-trip.
  if (ENV.emotionEngine === "heuristic") {
    return useHeuristic();
  }

  try {
    const response = await llmService.invoke({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `当前状态：${params.currentState || "warm"}

用户：${params.userMessage}

分身：${params.assistantReply}`,
        },
      ],
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
