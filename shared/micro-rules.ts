/**
 * Discriminative rules — the part of a person that prose cannot carry.
 *
 * A persona is written as prose: seven paragraphs describing a
 * personality, a speaking style, a set of catchphrases. Prose is read by
 * a model as *meaning*, and meaning is exactly what gets lost. The
 * sharpest thing anyone knows about another person is usually not a
 * paragraph — it is a distinction:
 *
 *   "她生气的时候会说『随便你』，但如果她说的是『随便』，没有『你』，
 *    那就是真的生气了。"
 *
 * Written into a `speakingStyle` paragraph, that becomes "she gets cold
 * when she is angry". Written as a rule, it stays what it is: a trigger,
 * a meaning, and a rendering. The model is not asked to *understand* it;
 * it is asked to *obey* it.
 *
 * The rules also carry their evidence — the messages they were read off.
 * A rule the user cannot check is a rule the user cannot trust, and a
 * rule the model cannot source is a rule the model will hallucinate from.
 */
import { copy } from "./copy";

/** One message the rule was read off. */
export interface MicroRuleEvidence {
  /** When it happened, if it came from a record with a timestamp. */
  at?: string;
  /** The message itself. */
  snippet: string;
}

/** A rule about how this person discriminates. */
export interface MicroRule {
  id: string;
  /** The tokens that fire it. */
  trigger: string[];
  /** What the trigger means. */
  meaning: string;
  /** How the person renders it — what they actually do. */
  rendering: string;
  /** How sure the miner is, 0–1. */
  confidence: number;
  /** Where the rule came from: mined from records, or written by the user. */
  source: "auto" | "manual";
  /** Whether the user has confirmed it. An unverified rule is a candidate. */
  verified: boolean;
  /** The messages the rule was read off. */
  evidence: MicroRuleEvidence[];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

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

function toEvidence(value: unknown): MicroRuleEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: MicroRuleEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = toText(record.snippet);
    if (!snippet) continue;
    const at = toText(record.at);
    out.push(at ? { at, snippet } : { snippet });
  }
  return out;
}

/**
 * The confidence of a rule, as a number between nothing and one.
 *
 * A rule with no confidence stored has an *unknown* confidence — and
 * that is what the middle of the scale means. It used to come out as
 * zero: `Number("")` is zero, and zero is a number, so the check for a
 * number that is not a number never fired. So every rule the app had
 * not measured was shown as "0% certain" — which reads as "we checked
 * and it is worthless", and it is not what was known.
 */
function toConfidence(value: unknown): number {
  if (value === undefined || value === null) return 0.5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
  }
  const text = toText(value);
  if (!text) return 0.5;
  const n = Number(text);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function toId(value: unknown, fallback: string): string {
  const id = toText(value);
  return id || fallback;
}

/**
 * Coerces whatever was stored into a list of usable rules.
 *
 * A rule without a trigger, a meaning or a rendering cannot be obeyed, so
 * it is dropped rather than kept as a decoration. Rules that were mined
 * automatically but never confirmed are kept — they are candidates the
 * user may want — but they are marked as unverified.
 */
export function normalizeMicroRules(value: unknown): MicroRule[] {
  if (!Array.isArray(value)) return [];
  const out: MicroRule[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const trigger = toStringList(record.trigger);
    const meaning = toText(record.meaning);
    const rendering = toText(record.rendering);
    if (!trigger.length || !meaning || !rendering) return;
    const source = record.source === "manual" ? "manual" : "auto";
    out.push({
      id: toId(record.id, `rule-${index + 1}`),
      trigger,
      meaning,
      rendering,
      confidence: toConfidence(record.confidence),
      source,
      verified: source === "manual" ? record.verified !== false : record.verified === true,
      evidence: toEvidence(record.evidence),
    });
  });
  return out;
}

/**
 * Whether the rule is one the model should be told about.
 *
 * Unverified mined rules are excluded by default: a rule the user has not
 * looked at is a guess, and a wrong guess in a hard constraint is worse
 * than no rule at all.
 */
export function activeMicroRules(rules: MicroRule[], includeUnverified = false): MicroRule[] {
  return rules.filter((rule) => (includeUnverified ? true : rule.verified));
}

/**
 * Whether the text carries one of the rule's triggers.
 *
 * Used by the miner to check a rule against a record, and by the tests.
 */
export function matchesMicroRule(rule: MicroRule, text: string): boolean {
  if (!text) return false;
  return rule.trigger.some((token) => token && text.includes(token));
}

/**
 * The rules, written for the model.
 *
 * The wording matters: these are instructions, not descriptions, and they
 * are placed in the prompt with the same weight as the persona's own
 * hard rules — a model told "you may" will sometimes do otherwise.
 */
export function renderMicroRules(rules: MicroRule[], locale: "zh" | "en" = "zh"): string {
  const active = activeMicroRules(rules);
  if (!active.length) return "";
  const lines = active.map((rule) =>
    copy(locale, "prompt.microRuleLine", {
      // The separator follows the language: the Chinese one is the
      // enumeration comma, and the whole prompt otherwise uses it.
      trigger: rule.trigger.join(locale === "en" ? " / " : "、"),
      meaning: rule.meaning,
      rendering: rule.rendering,
    }),
  );
  return [copy(locale, "prompt.microRulesHeading"), copy(locale, "prompt.microRulesIntro"), ...lines].join(
    "\n",
  );
}
