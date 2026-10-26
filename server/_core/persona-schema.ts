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
 *
 * `realismLevel` and `relationshipPhase` are not layers but quality knobs:
 * how human the persona sounds, and which stage the relationship is in.
 */
import { copy, type Locale } from "@shared/copy";
import {
  normalizeMicroRules,
  type MicroRule,
} from "@shared/micro-rules";
import {
  normalizeImperfectionProfile,
  type ImperfectionEntry,
} from "@shared/imperfection";

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
  /**
   * How human the persona sounds, 0-100. Higher means more imperfection.
   *
   * Optional so that personas stored before this field existed still satisfy
   * the type — the normaliser fills in the default.
   */
  realismLevel?: number;
  /** The stage the relationship is in. Optional for the same reason. */
  relationshipPhase?: RelationshipPhase;
  /**
   * The rules this person discriminates by.
   *
   * A persona is prose, and prose is read as *meaning* — which is how the
   * sharpest thing anyone knows about another person gets flattened into
   * "she gets cold when she is angry". A rule keeps the distinction: a
   * trigger, what it means, and what the person actually does about it.
   */
  microRules?: MicroRule[];
  /**
   * How this person is imperfect in each emotional state.
   *
   * `realismLevel` says how imperfect they are; this says what that looks
   * like when they are happy, and what it looks like when they are not —
   * because nobody is imperfect at a constant rate.
   */
  imperfectionProfile?: ImperfectionEntry[];
}

/** The stages a relationship can be in. */
export type RelationshipPhase = "initial" | "growing" | "stable" | "strained" | "closing";

/** A `PersonaData` with every field filled in — what the normaliser returns. */
export type NormalizedPersonaData = PersonaData & {
  realismLevel: number;
  relationshipPhase: RelationshipPhase;
};

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
  "realismLevel",
  "relationshipPhase",
  "microRules",
  "imperfectionProfile",
];

/**
 * The fields that go into the generated document, in the order they go in.
 *
 * The order is the one the document reads in, which is not the order of
 * `PERSONA_DATA_FIELDS`: the memories come near the end, where the
 * summary they belong to is.
 *
 * The fields of `PERSONA_DATA_FIELDS` that are *not* here are the ones
 * the document does not carry — and the test says which they are, so
 * a new field cannot be added to one list and forgotten in the other.
 */
export const PERSONA_DOCUMENT_FIELDS: Array<keyof PersonaData> = [
  "personality",
  "speakingStyle",
  "catchphrases",
  "nickname",
  "attachmentStyle",
  "loveLanguage",
  "conflictStyle",
  "touchingMoments",
  "memories",
  "summary",
];

/**
 * The fields the generated document deliberately leaves out.
 *
 * The realism level and the relationship stage are settings rather than
 * prose; the rules and the imperfection have their own sections.
 */
export const PERSONA_DOCUMENT_EXCLUDED_FIELDS: Array<keyof PersonaData> = [
  "realismLevel",
  "relationshipPhase",
  "microRules",
  "imperfectionProfile",
];

/** The default realism level: noticeably imperfect, but not a mess. */
export const DEFAULT_REALISM_LEVEL = 70;

/** The default relationship stage for a persona that never had one. */
export const DEFAULT_RELATIONSHIP_PHASE: RelationshipPhase = "initial";

const RELATIONSHIP_PHASES: RelationshipPhase[] = [
  "initial",
  "growing",
  "stable",
  "strained",
  "closing",
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

/** Coerces a value to a realism level between 0 and 100. */
function toRealismLevel(value: unknown): number | null {
  let level: number;
  if (typeof value === "number") {
    level = value;
  } else if (typeof value === "string" && value.trim()) {
    level = Number(value);
  } else {
    return null;
  }
  if (!Number.isFinite(level)) return null;
  return Math.max(0, Math.min(100, Math.round(level)));
}

/** Coerces a value to one of the known relationship stages. */
function toRelationshipPhase(value: unknown): RelationshipPhase | null {
  if (typeof value !== "string") return null;
  const phase = value.trim() as RelationshipPhase;
  return RELATIONSHIP_PHASES.includes(phase) ? phase : null;
}

/**
 * Normalizes raw LLM output into a complete `PersonaData`.
 *
 * LLM output is inconsistent: `catchphrases` may arrive as a delimited string
 * instead of an array, and `memories` may be a list of objects. Everything is
 * coerced into the canonical types, and missing fields fall back to a sensible
 * default so a partially-formed response never produces an empty persona.
 *
 * The fallbacks are the persona's own words, so they follow the language the
 * persona is written in rather than the language of the interface.
 */
export function normalizePersonaData(
  raw: Record<string, unknown> | null | undefined,
  options: { name: string; fallback?: Partial<PersonaData>; locale?: Locale },
): NormalizedPersonaData {
  const fallback = options.fallback ?? {};
  const source = raw ?? {};
  const locale = options.locale ?? "zh";

  const personality =
    toText(source.personality) ||
    fallback.personality ||
    copy(locale, "labels.persona.fallbackPersonality", { name: options.name });
  const speakingStyle =
    toText(source.speakingStyle) ||
    fallback.speakingStyle ||
    copy(locale, "labels.persona.fallbackSpeakingStyle");

  const rawCatchphrases = source.catchphrases ?? source.catchPhrase;
  const catchphrases = toStringList(rawCatchphrases);
  const resolvedCatchphrases = catchphrases.length
    ? catchphrases
    : fallback.catchphrases ?? toStringList(copy(locale, "labels.persona.fallbackCatchphrases"));

  const nickname = toText(source.nickname) || fallback.nickname || copy(locale, "labels.persona.fallbackNickname");
  const memories = toText(source.memories) || fallback.memories || "";
  const attachmentStyle =
    toText(source.attachmentStyle) || fallback.attachmentStyle || copy(locale, "labels.persona.fallbackAttachmentStyle");
  const loveLanguage = toText(source.loveLanguage) || fallback.loveLanguage || copy(locale, "labels.persona.unknown");
  const conflictStyle = toText(source.conflictStyle) || fallback.conflictStyle || copy(locale, "labels.persona.unknown");
  const touchingMoments = toText(source.touchingMoments) || fallback.touchingMoments || "";
  const summary =
    toText(source.summary) ||
    fallback.summary ||
    copy(locale, "labels.persona.fallbackSummary", { name: options.name });

  // The persona-quality fields were added after the first release, so old
  // personas do not have them — they get the plan's defaults instead.
  const realismLevel =
    toRealismLevel(source.realismLevel ?? fallback.realismLevel) ?? DEFAULT_REALISM_LEVEL;
  const relationshipPhase =
    toRelationshipPhase(source.relationshipPhase ?? fallback.relationshipPhase) ??
    DEFAULT_RELATIONSHIP_PHASE;

  // The rules and the per-state imperfection are opt-in. A persona that
  // was distilled before either of them existed keeps behaving exactly as
  // it did — the empty list means "nothing is said about this", which is
  // an honest answer and not a gap.
  const microRules = normalizeMicroRules(source.microRules ?? fallback.microRules);
  const imperfectionProfile = normalizeImperfectionProfile(
    source.imperfectionProfile ?? fallback.imperfectionProfile,
    locale,
  );

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
    realismLevel,
    relationshipPhase,
    microRules,
    imperfectionProfile,
  };
}
