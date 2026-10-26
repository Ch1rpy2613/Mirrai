/**
 * Imperfection, per state.
 *
 * `realismLevel` is a single number between 0 and 100: how imperfect this
 * persona is. But nobody is imperfect at a constant rate. The same person
 * is loose and expansive when they are happy and clipped when they are
 * not; the way they fail to be perfect changes with what is happening to
 * them.
 *
 * So imperfection is not a scalar but a *conditional* profile — one entry
 * per emotional state, each saying what this person's imperfection looks
 * like in that state. A distant persona is not generically cold; it is
 * cold in the way *this* person is cold, which is a different thing
 * entirely and the difference between a template and a person.
 *
 * `realismLevel` keeps its meaning as a global intensity: it scales how
 * strongly the per-state deviations apply.
 */
import { copy } from "./copy";

/** The states a persona can be in. Mirrors `emotional_state` in the schema. */
export type ImperfectionState =
  | "warm"
  | "playful"
  | "nostalgic"
  | "melancholy"
  | "happy"
  | "distant";

/** The states, in the order they appear in the interface. */
export const IMPERFECTION_STATES: readonly ImperfectionState[] = [
  "warm",
  "playful",
  "nostalgic",
  "melancholy",
  "happy",
  "distant",
];

/** What this person's imperfection looks like in one state. */
export interface ImperfectionEntry {
  state: ImperfectionState;
  /** The deviations, in the user's own words. */
  deviations: string[];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isState(value: unknown): value is ImperfectionState {
  return typeof value === "string" && (IMPERFECTION_STATES as readonly string[]).includes(value);
}

/**
 * Coerces stored imperfection into the canonical shape.
 *
 * Entries for unknown states are dropped rather than kept — a rule for a
 * state the persona can never be in is dead weight in every prompt.
 *
 * A state that is present but empty falls back to the default for that
 * state: the user asked for imperfection in that state, so giving them
 * none would be worse than giving them the generic one.
 *
 * A persona with *no* profile at all stays empty. That is deliberate —
 * it means every persona that was built before this field existed keeps
 * behaving exactly as it did, rather than quietly gaining a personality
 * nobody chose for it.
 */
export function normalizeImperfectionProfile(
  value: unknown,
  locale: "zh" | "en" = "zh",
): ImperfectionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ImperfectionEntry[] = [];
  const seen = new Set<string>();
  const defaults = new Map(defaultImperfectionProfile(locale).map((e) => [e.state, e.deviations]));
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const state = record.state;
    if (!isState(state) || seen.has(state)) continue;
    const deviations = Array.isArray(record.deviations)
      ? record.deviations.map((v) => toText(v)).filter(Boolean)
      : toText(record.deviations)
          .split(/[；;\n]/)
          .map((v) => v.trim())
          .filter(Boolean);
    seen.add(state);
    out.push({
      state,
      deviations: deviations.length ? deviations : (defaults.get(state) ?? []),
    });
  }
  return out;
}

/**
 * The profile with every state filled in.
 *
 * Used by the interface, so that the user is shown a complete picture —
 * six states, each with something in it — rather than the empty gaps that
 * are technically what is stored.
 */
export function mergeImperfectionDefaults(
  profile: ImperfectionEntry[],
  locale: "zh" | "en" = "zh",
): ImperfectionEntry[] {
  const defaults = defaultImperfectionProfile(locale);
  const byState = new Map(profile.map((entry) => [entry.state, entry]));
  return defaults.map((fallback) => {
    const existing = byState.get(fallback.state);
    return existing && existing.deviations.length ? existing : fallback;
  });
}

/**
 * The profile a persona starts with.
 *
 * It is deliberately generic: these are the ways a person tends to be
 * imperfect in each state, offered as a starting point the user can
 * replace with what they actually know. The defaults are written in the
 * app's language because they are the app's instructions; a user who
 * writes their own writes them in their own words, and those stay.
 */
export function defaultImperfectionProfile(locale: "zh" | "en" = "zh"): ImperfectionEntry[] {
  return IMPERFECTION_STATES.map((state) => ({
    state,
    deviations: copy(locale, `labels.imperfection.${state}`)
      .split(/[；;\n]/)
      .map((v) => v.trim())
      .filter(Boolean),
  }));
}

/**
 * The deviations that apply in one state.
 *
 * An empty list is an honest answer: the persona has no known deviation
 * in that state, and the prompt should say nothing rather than invent
 * one.
 */
export function selectImperfection(
  profile: ImperfectionEntry[] | null | undefined,
  state: string | null | undefined,
): ImperfectionEntry | null {
  if (!profile || !profile.length || !state) return null;
  return profile.find((entry) => entry.state === state) ?? null;
}

/**
 * The deviations, written for the model.
 *
 * The intensity word scales how strongly they apply, so a persona with a
 * `realismLevel` of 20 is only slightly off and one at 90 is visibly
 * rough around the edges.
 */
export function renderImperfection(
  entry: ImperfectionEntry | null,
  realismLevel: number,
  locale: "zh" | "en" = "zh",
): string {
  if (!entry || !entry.deviations.length) return "";
  const level = Math.max(0, Math.min(100, Number(realismLevel) || 0));
  if (level === 0) return "";
  const intensity = copy(
    locale,
    level >= 70
      ? "prompt.realismIntensityHigh"
      : level >= 40
        ? "prompt.realismIntensityMedium"
        : "prompt.realismIntensityLow",
  );
  const lines = entry.deviations.map((d) => copy(locale, "prompt.imperfectionLine", { value: d }));
  return [
    copy(locale, "prompt.imperfectionHeading"),
    copy(locale, "prompt.imperfectionIntensity", { intensity }),
    ...lines,
  ].join("\n");
}
