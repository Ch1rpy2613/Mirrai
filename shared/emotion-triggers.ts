/**
 * The emotion trigger words, shared by the server and the client.
 *
 * The heuristic behind `computeEmotionalState` is only a fallback for when
 * the model is unavailable; it is deliberately conservative so it never fights
 * the model's judgement. The words live here so that the server and the
 * client speak about the same triggers — the plan (§6.2) asks for the table
 * to be a shared artefact in the shape `{ zh: [...], en: [...] }`.
 *
 * The patterns are the canonical copy: they are what the heuristic matches
 * against. The flat word lists are derived from them, so the two can never
 * drift apart.
 */

/** The emotional states a trigger can point at. */
export type EmotionTriggerState =
  | "nostalgic"
  | "playful"
  | "melancholy"
  | "happy"
  | "distant";

/** The states, in the order the heuristic tries them. */
export const EMOTION_TRIGGER_STATES: readonly EmotionTriggerState[] = [
  "nostalgic",
  "playful",
  "melancholy",
  "happy",
  "distant",
];

/**
 * The trigger patterns, per language.
 *
 * These are the words the server already used; they are copied here exactly,
 * so a persona's emotional state does not change when the heuristic starts
 * reading them from this module.
 */
export const EMOTION_TRIGGER_PATTERNS: {
  zh: Record<EmotionTriggerState, RegExp>;
  en: Record<EmotionTriggerState, RegExp>;
} = {
  zh: {
    nostalgic: /想你|思念|好久|那时候|记得吗|以前/,
    playful: /哈哈|笑死|好玩|有意思|逗|搞笑/,
    melancholy: /难过|伤心|哭|委屈|不开心/,
    happy: /开心|高兴|棒|太好了|耶|爱你/,
    distant: /随便|无所谓|算了|不想说/,
  },
  en: {
    nostalgic: /miss you|i miss you|remember when|used to|reminds me of/,
    playful: /haha|lol|that'?s funny|joking|kidding/,
    melancholy: /sad|crying|upset|hurt|heartbroken/,
    happy: /happy|great|awesome|i love you|so glad/,
    distant: /whatever|doesn'?t matter|forget it|not talking/,
  },
};

/**
 * Splits a pattern's alternatives into plain words.
 *
 * The optional apostrophe (`that'?s funny`) matches two spellings, so it is
 * expanded into both rather than left as a regex fragment.
 */
function wordsOf(pattern: RegExp): string[] {
  const words: string[] = [];
  for (const alternative of pattern.source.split("|")) {
    const trimmed = alternative.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("'?");
    if (parts.length === 2) {
      words.push(parts[0] + parts[1], parts[0] + "'" + parts[1]);
    } else {
      words.push(trimmed);
    }
  }
  return words;
}

/**
 * The trigger words, per language.
 *
 * The order follows the patterns: the states come first, the alternatives
 * within a state keep the order they are written in.
 */
export const EMOTION_TRIGGER_WORDS: { zh: string[]; en: string[] } = {
  zh: EMOTION_TRIGGER_STATES.flatMap((state) => wordsOf(EMOTION_TRIGGER_PATTERNS.zh[state])),
  en: EMOTION_TRIGGER_STATES.flatMap((state) => wordsOf(EMOTION_TRIGGER_PATTERNS.en[state])),
};

/**
 * The state the triggers point at, or null when none of them match.
 *
 * The order of the states decides which one wins, exactly as the server's
 * heuristic does.
 */
export function matchEmotionTrigger(
  text: string,
  locale: "zh" | "en" = "zh",
): EmotionTriggerState | null {
  const patterns = EMOTION_TRIGGER_PATTERNS[locale] ?? EMOTION_TRIGGER_PATTERNS.zh;
  for (const state of EMOTION_TRIGGER_STATES) {
    if (patterns[state].test(text)) return state;
  }
  return null;
}
