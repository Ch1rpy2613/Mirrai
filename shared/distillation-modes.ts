/**
 * The distillation presets — the named ways a persona can be built.
 *
 * Distilling a persona used to be described in two vocabularies: a
 * "character family" (a partner, a colleague, a public figure) and a
 * "research profile" that only the public-figure family understood. Both
 * were real, but neither of them told the user what a run would cost or
 * how much material it would read — and the two drop-downs that offered
 * them lived on the settings page, nowhere near the upload page where the
 * distillation actually starts.
 *
 * A preset bundles the whole decision into one name the user can pick:
 *   fast       — a fast look; a small sample and few calls
 *   standard   — the default; the middle ground
 *   deep       — reads much more of the material
 *   colleague  — a colleague, with the work dimension
 *   celebrity  — a public figure, with the full research flow
 *
 * The list lives here so the server and the client read the same one.
 */

export type DistillationMode = "fast" | "standard" | "deep" | "colleague" | "celebrity";

/** The family of prompts a run uses. */
export type DistillationFamily = "relationship" | "colleague" | "celebrity";

/** The celebrity research profile; null means the research flow does not run. */
export type DistillationResearchProfile = "budget-friendly" | "budget-unfriendly";

/**
 * The interface dictionary keys of the presets.
 *
 * They used to be plain strings, so the call to `t()` had to be cast
 * with `as any` — and a key that did not exist was not a compile
 * error, it was the raw key shown to the reader.
 *
 * They are the keys themselves now, so a typo in one of them fails the
 * build.
 */
export type DistillationClientLabelKey =
  | "distillation.presets.fast.label"
  | "distillation.presets.standard.label"
  | "distillation.presets.deep.label"
  | "distillation.presets.colleague.label"
  | "distillation.presets.celebrity.label";

export type DistillationClientDescriptionKey =
  | "distillation.presets.fast.description"
  | "distillation.presets.standard.description"
  | "distillation.presets.deep.description"
  | "distillation.presets.colleague.description"
  | "distillation.presets.celebrity.description";

export interface DistillationPreset {
  id: DistillationMode;
  /**
   * The *interface* dictionary key of the preset's name.
   *
   * The client dictionary, not the shared one: the server never renders
   * the label. It used to read as if it were the shared table, and a
   * call to `copy()` with it returned the key itself.
   */
  clientLabelKey: DistillationClientLabelKey;
  /** The *interface* dictionary key of the preset's explanation. */
  clientDescriptionKey: DistillationClientDescriptionKey;
  /** The family of prompts the run uses. */
  characterFamily: DistillationFamily;
  /** The research profile; null means the research flow does not run. */
  researchProfile: DistillationResearchProfile | null;
  /** How much of the chat history the analysis stages may read. */
  chatSampleLimit: number;
  /**
   * The temperature of the extraction stages.
   *
   * These stages pull facts out of the material, so a lower temperature
   * makes them more repeatable; a higher one only makes them more
   * variable. The provider's own default is 0.7, which is a strange
   * choice for an extraction.
   */
  analysisTemperature: number;
  /** How many photos may be described. */
  maxImages: number;
  /** Roughly how many model calls a run costs — shown in the interface. */
  approxCalls: number;
}

export const DISTILLATION_PRESETS: DistillationPreset[] = [
  {
    id: "fast",
    clientLabelKey: "distillation.presets.fast.label",
    clientDescriptionKey: "distillation.presets.fast.description",
    characterFamily: "relationship",
    researchProfile: null,
    chatSampleLimit: 4000,
    analysisTemperature: 0.2,
    maxImages: 3,
    approxCalls: 4,
  },
  {
    id: "standard",
    clientLabelKey: "distillation.presets.standard.label",
    clientDescriptionKey: "distillation.presets.standard.description",
    characterFamily: "relationship",
    researchProfile: null,
    chatSampleLimit: 10000,
    analysisTemperature: 0.3,
    maxImages: 6,
    approxCalls: 4,
  },
  {
    id: "deep",
    clientLabelKey: "distillation.presets.deep.label",
    clientDescriptionKey: "distillation.presets.deep.description",
    characterFamily: "relationship",
    researchProfile: null,
    chatSampleLimit: 30000,
    analysisTemperature: 0.3,
    maxImages: 12,
    approxCalls: 4,
  },
  {
    id: "colleague",
    clientLabelKey: "distillation.presets.colleague.label",
    clientDescriptionKey: "distillation.presets.colleague.description",
    characterFamily: "colleague",
    researchProfile: null,
    chatSampleLimit: 10000,
    analysisTemperature: 0.3,
    maxImages: 6,
    approxCalls: 6,
  },
  {
    id: "celebrity",
    clientLabelKey: "distillation.presets.celebrity.label",
    clientDescriptionKey: "distillation.presets.celebrity.description",
    characterFamily: "celebrity",
    researchProfile: "budget-unfriendly",
    chatSampleLimit: 30000,
    analysisTemperature: 0.3,
    maxImages: 12,
    approxCalls: 15,
  },
];

/** The preset a persona uses when nothing was chosen. */
export const DEFAULT_DISTILLATION_MODE: DistillationMode = "standard";

/** Whether a stored value names one of the presets. */
export function isDistillationMode(value: unknown): value is DistillationMode {
  return (
    typeof value === "string" &&
    DISTILLATION_PRESETS.some((preset) => preset.id === value)
  );
}

/**
 * The preset for a mode.
 *
 * An unknown or missing mode falls back to the standard preset, which is
 * what the app did before the presets existed — a missing choice must
 * never change the shape of a run.
 */
export function getDistillationPreset(mode?: string | null): DistillationPreset {
  const found = DISTILLATION_PRESETS.find((preset) => preset.id === mode);
  return found ?? getDistillationPreset(DEFAULT_DISTILLATION_MODE);
}
