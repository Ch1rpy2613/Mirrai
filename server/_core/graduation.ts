/**
 * Reads the graduation mode that applies to a persona.
 *
 * The mode is stored twice — on the persona and on the user — and this is
 * the one place that turns the two into a single answer. Every gate
 * (the per-turn assessment, the check query, the graduation command and the
 * graduation mutation) asks this module, so the three modes cannot drift
 * apart between the places that enforce them.
 */
import * as db from "../db";
import {
  resolveGraduationMode,
  resolvePresence,
  type GraduationMode,
  type Presence,
} from "@shared/graduation-mode";

export { resolveGraduationMode, resolvePresence };
export type { GraduationMode, Presence };

export interface GraduationModeDetails {
  /** The mode that applies right now. */
  mode: GraduationMode;
  /** The persona's own setting; null means "inherit the user's default". */
  personaMode: string | null;
  /** The user's instance-wide default. */
  userMode: string | null;
}

/**
 * The users whose default could not be read.
 *
 * The warning is worth printing once per user rather than on every turn:
 * a database that does not carry the column yet would otherwise fill the
 * log with the same line.
 */
const unreadableUserModes = new Set<number>();

/**
 * Reads the user's instance default.
 *
 * The read is defensive on purpose: the module is imported by the channel
 * commands, which run against a database that may not carry the column yet
 * (an installation that has not run the newest migration yet), and by tests
 * that only implement part of the database module. In that case the
 * persona's own setting still applies.
 */
async function readUserGraduationMode(userId: number): Promise<string | null> {
  try {
    const user = await db.getUserById(userId);
    return user?.graduationMode ?? null;
  } catch (e) {
    if (!unreadableUserModes.has(userId)) {
      unreadableUserModes.add(userId);
      console.warn(
        "[Graduation] The user's graduation mode is not readable here, so the persona's own setting applies:",
        (e as Error).message,
      );
    }
    return null;
  }
}

/**
 * The mode that applies to a persona right now, with the values it was
 * derived from.
 *
 * The values are read fresh every time, so a change takes effect on the next
 * conversation turn rather than after a restart.
 */
export async function getGraduationModeDetails(params: {
  /** The persona's own override; null means "inherit the user's default". */
  personaMode?: string | null;
  userId: number;
}): Promise<GraduationModeDetails> {
  const userMode = await readUserGraduationMode(params.userId);
  return {
    mode: resolveGraduationMode(params.personaMode, userMode),
    personaMode: params.personaMode ?? null,
    userMode,
  };
}

/**
 * The mode that applies to a persona right now.
 */
export async function getEffectiveGraduationMode(params: {
  personaMode?: string | null;
  userId: number;
}): Promise<GraduationMode> {
  const { mode } = await getGraduationModeDetails(params);
  return mode;
}

/**
 * How long the app waits before it may offer a farewell again.
 *
 * An offer that can only be made once is a decision the user never gets to
 * make; an offer that can be made every turn is nagging. The product
 * promises that graduation is a suggestion, so the suggestion has to
 * arrive occasionally and then go quiet again.
 */
export const RESUGGEST_COOLDOWN_DAYS = 7;

function cooldownMs(): number {
  const raw = Number.parseInt(
    process.env.MIRRAI_GRADUATION_RESUGGEST_DAYS ?? "",
    10,
  );
  const days = Number.isFinite(raw) && raw > 0 ? raw : RESUGGEST_COOLDOWN_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Whether the app may offer a farewell to this persona right now.
 *
 * "graduated" is final. An offer that was made — or explicitly declined —
 * puts the persona in a cooldown, after which the offer may be made again.
 */
export function canOfferGraduation(params: {
  status: string | null | undefined;
  suggestedAt?: Date | null;
  declinedAt?: Date | null;
  now?: Date;
}): { allowed: boolean; reason: "never" | "recently" | "ok" } {
  const status = params.status ?? null;
  if (status === "graduated") return { allowed: false, reason: "never" };

  if (status === "suggested" || status === "declined") {
    // The most recent touch of the ritual decides when the cooldown ends.
    const last = params.declinedAt ?? params.suggestedAt ?? null;
    if (!last) return { allowed: true, reason: "ok" };
    const now = params.now ?? new Date();
    const elapsed = now.getTime() - new Date(last).getTime();
    if (elapsed < cooldownMs()) return { allowed: false, reason: "recently" };
  }

  return { allowed: true, reason: "ok" };
}

/**
 * The presence that applies to a persona right now.
 */
export function getEffectivePresence(params: {
  personaPresence?: string | null;
  graduationStatus?: string | null;
}): Presence {
  return resolvePresence(params.personaPresence, params.graduationStatus);
}
