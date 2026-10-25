/**
 * The graduation mode — how much the app may push a persona towards saying
 * goodbye.
 *
 * The product promises that graduation is always a suggestion and never a
 * decision the user did not make. This module is where that promise becomes
 * a value the user can actually choose:
 *
 *   suggest — the app assesses the relationship on every turn and offers a
 *             graduation when the thresholds are met. This is the historical
 *             behaviour and the default.
 *   manual  — the app never brings it up, but the user can start it whenever
 *             they want. The thresholds do not apply: they exist to stop the
 *             app from deciding too early, and the user has already decided.
 *   off     — the graduation mechanism is switched off for this persona.
 *             An already-graduated persona keeps its state; only new
 *             graduations are refused.
 *
 * The setting lives in two places — the user's instance default and a
 * per-persona override — so a multi-user installation can decide per
 * relationship while a single-user one only has to set it once.
 */
export type GraduationMode = "suggest" | "manual" | "off";

/** Every mode, in the order the settings are presented. */
export const GRADUATION_MODES: readonly GraduationMode[] = ["suggest", "manual", "off"];

/** The mode a persona falls back to when nothing else is set. */
export const DEFAULT_GRADUATION_MODE: GraduationMode = "suggest";

/** Whether a stored value is one of the known modes. */
export function isGraduationMode(value: unknown): value is GraduationMode {
  return (
    typeof value === "string" &&
    (GRADUATION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Resolves the mode that applies to a persona.
 *
 * The persona's own setting wins; when it is not set the user's instance
 * default applies, and when neither is set the historical behaviour —
 * "suggest" — is kept. An unrecognised value is treated as "not set" rather
 * than trusted, so a corrupted row cannot silently switch the mechanism off.
 */
export function resolveGraduationMode(
  personaMode: string | null | undefined,
  userMode: string | null | undefined,
): GraduationMode {
  if (isGraduationMode(personaMode)) return personaMode;
  if (isGraduationMode(userMode)) return userMode;
  return DEFAULT_GRADUATION_MODE;
}

/**
 * Whether the persona is around right now.
 *
 * This is deliberately separate from the graduation mode. The mode decides
 * whether the *app* may raise a farewell; presence decides whether the app
 * may reach out at all. A person who has just broken up usually wants
 * neither a suggestion nor a message about their anniversary, and that is
 * a state the product has to be able to express.
 *
 *   active — reachable; outreach and suggestions are allowed
 *   quiet  — the user asked for space; no outreach, no suggestions
 *   asleep — the persona has graduated and must not disturb anyone
 */
export type Presence = "active" | "quiet" | "asleep";

export const PRESENCES: readonly Presence[] = ["active", "quiet", "asleep"];

export const DEFAULT_PRESENCE: Presence = "active";

/** Whether a stored value is one of the known presences. */
export function isPresence(value: unknown): value is Presence {
  return (
    typeof value === "string" &&
    (PRESENCES as readonly string[]).includes(value)
  );
}

/**
 * The presence that actually applies to a persona.
 *
 * A persona that has graduated is asleep whatever the column says — the
 * ritual is the stronger fact. Everything else keeps its own setting.
 */
export function resolvePresence(
  personaPresence: string | null | undefined,
  graduationStatus: string | null | undefined,
): Presence {
  if (graduationStatus === "graduated") return "asleep";
  return isPresence(personaPresence) ? personaPresence : DEFAULT_PRESENCE;
}

/**
 * Whether the app may reach out to the user about this persona.
 *
 * "Quiet" is the user asking for space, and "asleep" is a persona that has
 * said goodbye; neither is a moment to push a notification.
 */
export function mayReachOut(presence: Presence): boolean {
  return presence === "active";
}
