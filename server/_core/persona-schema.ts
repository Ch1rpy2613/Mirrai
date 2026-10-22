/**
 * Canonical `personaData` contract.
 *
 * Both the distillation pipeline and the system-prompt builder read the same
 * shape, so the field list lives here instead of being duplicated as a string
 * literal in two different prompts.
 *
 * The seven persona layers map to fields as follows:
 *   1. personality      — 性格
 *   2. speakingStyle    — 说话方式
 *   3. catchphrases     — 口头禅
 *   4. attachmentStyle  — 依恋类型
 *   5. loveLanguage     — 爱的语言
 *   6. conflictStyle    — 争吵方式
 *   7. touchingMoments  — 动人时刻
 */

export interface PersonaData {
  personality: string;
  speakingStyle: string;
  catchphrases: string[];
  nickname: string;
  memories: string;
  attachmentStyle: string;
  loveLanguage: string;
  conflictStyle: string;
  touchingMoments: string;
  summary: string;
}

export const PERSONA_DATA_FIELDS: Array<keyof PersonaData> = [
  "personality",
  "speakingStyle",
  "catchphrases",
  "nickname",
  "memories",
  "attachmentStyle",
  "loveLanguage",
  "conflictStyle",
  "touchingMoments",
  "summary",
];

/** Coerces anything to a trimmed non-empty string, or "" when unusable. */
function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => toText(v)).filter(Boolean).join("；");
  }
  return "";
}

/** Coerces a value to a string array, accepting a single string or a delimited string. */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => toText(v)).filter(Boolean);
  }
  const text = toText(value);
  if (!text) return [];
  return text
    .split(/[、,，;；\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Normalizes raw LLM output into a complete `PersonaData`.
 *
 * LLM output is inconsistent: `catchphrases` may arrive as a delimited string
 * instead of an array, and `memories` may be a list of objects. Everything is
 * coerced into the canonical types, and missing fields fall back to a sensible
 * default so a partially-formed response never produces an empty persona.
 */
export function normalizePersonaData(
  raw: Record<string, unknown> | null | undefined,
  options: { name: string; fallback?: Partial<PersonaData> },
): PersonaData {
  const fallback = options.fallback ?? {};
  const source = raw ?? {};

  const personality =
    toText(source.personality) || fallback.personality || `${options.name}是一个温柔体贴的人。`;
  const speakingStyle =
    toText(source.speakingStyle) || fallback.speakingStyle || "说话温柔自然，喜欢用可爱的语气词";

  const rawCatchphrases = source.catchphrases ?? source.catchPhrase;
  const catchphrases = toStringList(rawCatchphrases);
  const resolvedCatchphrases = catchphrases.length
    ? catchphrases
    : fallback.catchphrases ?? ["嗯嗯", "好呀", "哈哈"];

  const nickname = toText(source.nickname) || fallback.nickname || "宝贝";
  const memories = toText(source.memories) || fallback.memories || "";
  const attachmentStyle = toText(source.attachmentStyle) || fallback.attachmentStyle || "安全型";
  const loveLanguage = toText(source.loveLanguage) || fallback.loveLanguage || "未知";
  const conflictStyle = toText(source.conflictStyle) || fallback.conflictStyle || "未知";
  const touchingMoments = toText(source.touchingMoments) || fallback.touchingMoments || "";
  const summary = toText(source.summary) || fallback.summary || `${options.name}是一个温暖、真诚的人`;

  return {
    personality,
    speakingStyle,
    catchphrases: resolvedCatchphrases,
    nickname,
    memories,
    attachmentStyle,
    loveLanguage,
    conflictStyle,
    touchingMoments,
    summary,
  };
}
