/**
 * The user's side of the relationship.
 *
 * The app was built to rebuild a person: their tone, their habits, their
 * history. It was never built to know the person who is talking to that
 * rebuild. Every table scoped by `userId` was a permission key, not a
 * description of a human being.
 *
 * These are the pieces that make the user a person the app knows: how they
 * want to be addressed, what they no longer want to hear about, and how
 * they have been doing.
 */

/**
 * How the user has been doing.
 *
 * These are the user's own, and they are deliberately not the persona's
 * six states. The persona's moods are what the app infers from the
 * conversation; these are what the user says about themselves.
 */
import { copy } from "./copy";
import { zonedDateKey } from "./timezone";

export type UserMood = "great" | "okay" | "low" | "down" | "anxious" | "numb";

export const USER_MOODS: readonly UserMood[] = [
  "great",
  "okay",
  "low",
  "down",
  "anxious",
  "numb",
];


export function isUserMood(value: unknown): value is UserMood {
  return (
    typeof value === "string" && (USER_MOODS as readonly string[]).includes(value)
  );
}

/**
 * The user's own state, and how the persona should read it.
 *
 * The wording matters: the persona is not a therapist reading a chart, and
 * it is not a nurse checking a triage score. It is the person who knows
 * the user, noticing how they are.
 */
export const USER_MOOD_LABELS: Record<UserMood, { zh: string; en: string }> = {
  great: { zh: "很好", en: "great" },
  okay: { zh: "还行", en: "okay" },
  low: { zh: "有点低落", en: "a bit low" },
  down: { zh: "很难过", en: "really down" },
  anxious: { zh: "有点不安", en: "anxious" },
  numb: { zh: "说不上来", en: "not sure how to describe it" },
};

/**
 * What kind of thing happened in the relationship.
 *
 * The list is the user's own vocabulary for their own life, so it is
 * short. "triggered" is the one that needs the most care: it is the user
 * saying that something reminded them of something painful.
 */
export const RELATIONSHIP_EVENT_KINDS = [
  "together",
  "apart",
  "reunion",
  "breakup",
  "conflict",
  "reconciliation",
  "news",
  "meetup",
  "triggered",
] as const;

export type RelationshipEventKind = (typeof RELATIONSHIP_EVENT_KINDS)[number];

export function isRelationshipEventKind(
  value: unknown,
): value is RelationshipEventKind {
  return (
    typeof value === "string" &&
    (RELATIONSHIP_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The kinds that mean the relationship itself has changed shape.
 *
 * The app's behaviour follows these: a breakup stops the anniversaries,
 * a reconciliation brings them back.
 */
export const RELATIONSHIP_PHASE_EVENTS: readonly RelationshipEventKind[] = [
  "together",
  "apart",
  "reunion",
  "breakup",
  "reconciliation",
];

export interface UserContext {
  /** The user's own name, if they gave one. */
  name?: string | null;
  /** How they want to be addressed. */
  addressStyle?: string | null;
  /** What the persona should not bring up. */
  boundaries?: string | null;
  /** The user's time zone, as an IANA name. */
  timezone?: string | null;
}

/**
 * The block of the system prompt that tells the persona who it is talking
 * to.
 *
 * Without it the persona knows everything about the other person and
 * nothing about the one in front of it — which is why it said "宝贝" to
 * someone who had asked to be left alone, and why it said it was
 * afternoon when the user was in the middle of the night.
 */
export function buildUserContextBlock(
  context: UserContext,
  options: { locale?: "zh" | "en"; mood?: UserMood | null } = {},
): string {
  const locale = options.locale ?? "zh";
  const parts: string[] = [];

  const name = context.name?.trim();
  const address = context.addressStyle?.trim();
  const boundaries = context.boundaries?.trim();
  const timeZone = context.timezone?.trim();

  if (name) parts.push(copy(locale, "userSide.talkingTo", { name }));
  if (address) parts.push(copy(locale, "userSide.address", { address }));
  if (boundaries) {
    parts.push(copy(locale, "userSide.boundaries", { boundaries }));
  }
  /**
   * Where the user is.
   *
   * The block had a field for the time zone and never read it — so the
   * persona was told the time of day but not where the user was, and
   * could not tell "it is late" from "it is late for you".
   */
  if (timeZone) {
    parts.push(copy(locale, "userSide.timezone", { zone: timeZone }));
  }
  if (options.mood) {
    const label = USER_MOOD_LABELS[options.mood][locale];
    parts.push(copy(locale, "userSide.mood", { label }));
  }

  if (parts.length === 0) return "";
  return `${copy(locale, "userSide.heading")}\n${parts.join("\n")}`;
}

/**
 * The relationship phase, as the events record it.
 *
 * The phase used to be written once by the distillation pipeline and never
 * touched again, so a persona whose relationship had ended kept speaking
 * as if the two of them were together.
 */
export function resolveRelationshipPhase(
  events: Array<{ kind: string; happenedAt?: Date | string | null }>,
): RelationshipEventKind | null {
  const relevant = events
    .filter((event) =>
      (RELATIONSHIP_PHASE_EVENTS as readonly string[]).includes(event.kind),
    )
    .sort((a, b) => {
      const at = a.happenedAt ? new Date(a.happenedAt).getTime() : 0;
      const bt = b.happenedAt ? new Date(b.happenedAt).getTime() : 0;
      return at - bt;
    });
  const last = relevant[relevant.length - 1];
  return last ? (last.kind as RelationshipEventKind) : null;
}

/**
 * How each kind of event is described to the persona.
 *
 * The wording is the persona's own — it is told what happened, and it
 * reacts in character. The point is that the persona is not left speaking
 * from a snapshot of the relationship taken on the day it was built.
 */
export const EVENT_LABELS: Record<RelationshipEventKind, { zh: string; en: string }> = {
  together: { zh: "我们在一起了", en: "we got back together" },
  apart: { zh: "我们暂时分开了", en: "we are apart for a while" },
  reunion: { zh: "我们复合了", en: "we got back together" },
  breakup: { zh: "我们分手了", en: "we broke up" },
  conflict: { zh: "我们吵了一架", en: "we had a fight" },
  reconciliation: { zh: "我们和好了", en: "we made up" },
  news: { zh: "有件事想告诉你", en: "there is something to tell you" },
  meetup: { zh: "我们见面了", en: "we met up" },
  triggered: { zh: "我今天想起了一些难受的事", en: "something painful came up today" },
};

/**
 * The block of the system prompt that tells the persona what has been
 * happening in the relationship.
 *
 * The events are the user's own record. They are presented as facts the
 * persona knows — because the user is the one who told it, and a persona
 * that does not listen to what it is told is not a persona at all.
 */
/**
 * How long a trigger stays a trigger.
 *
 * The restraint instruction has to expire. A trigger from six months
 * ago is a memory; if the instruction never expired, every message for
 * ever would carry "the user is hurting, do not push" — which is not
 * restraint, it is a permanent tone, and it would stop the persona
 * from ever being warm again.
 */
export const TRIGGER_FRESHNESS_DAYS = 3;

export function buildRelationshipSection(
  events: Array<{
    kind: string;
    title: string;
    detail?: string | null;
    happenedAt?: Date | string | null;
  }>,
  phase: RelationshipEventKind | null,
  locale: "zh" | "en" = "zh",
  now: Date = new Date(),
  /**
   * The user's own time zone.
   *
   * Without it, "today" and "yesterday" were the server's days — and
   * the user and the server are not always on the same day.
   */
  timeZone?: string | null,
): string {
  if (!events || events.length === 0) return "";

  const parts: string[] = [];
  for (const event of events.slice(0, 8)) {
    const kind = isRelationshipEventKind(event.kind) ? event.kind : null;
    const label = kind ? EVENT_LABELS[kind][locale] : null;
    const when = event.happenedAt ? formatWhen(event.happenedAt, locale, now, timeZone) : null;
    // The punctuation follows the language.
    //
    // It was full-width in both: an English persona's system prompt
    // said "2026-01-01，there is something to tell you：x" — a sentence
    // in two languages at once, which is exactly what the rest of the
    // prompt code avoids.
    const comma = locale === "en" ? ", " : "，";
    const colon = locale === "en" ? ": " : "：";
    const line = label
      ? `${when ? `${when}${comma}` : ""}${label}${colon}${event.title}`
      : event.title;
    const detail = event.detail?.trim();
    parts.push(detail ? `- ${line}\n  ${detail}` : `- ${line}`);
  }

  if (phase) {
    const heading = copy(locale, "userSide.phaseHeading");
    const phaseLine = copy(locale, `userSide.phase.${phase}`);
    const open = locale === "en" ? "(" : "（";
    const close = locale === "en" ? ")" : "）";
    const colon = locale === "en" ? ": " : "：";
    parts.push(`${open}${heading}${colon}${phaseLine}${close}`);
  }

  const title = copy(locale, "userSide.eventsTitle");
  const note = copy(locale, "userSide.eventsNote");

  /**
   * The instruction for a trigger.
   *
   * "I saw them get back together" / "he blocked me" / "I saw her posts" —
   * none of these are crisis words, so a keyword list never catches them.
   * When the user says that something hurt, the persona has to do very
   * little: acknowledge it, and not push. Anything more becomes a reason
   * to keep thinking about it, which is the opposite of the point.
   */
  const triggered = events.some((event) => {
    if (event.kind !== "triggered") return false;
    if (!event.happenedAt) return true;
    const then = new Date(event.happenedAt).getTime();
    if (Number.isNaN(then)) return true;
    /**
     * Calendar days, on the user's own clock.
     *
     * It was elapsed twenty-four-hour periods: a trigger recorded at
     * eleven in the evening three days ago was 3.02 days old, so the
     * instruction — "the user is hurting, acknowledge it and stop
     * there" — was dropped, while the same trigger recorded at half
     * past midnight was 2.99 days old and kept it. The rule that says
     * "three days" did not mean three days.
     */
    const days = calendarDaysBetween(new Date(then), now, timeZone);
    return days <= TRIGGER_FRESHNESS_DAYS;
  });
  const restraint = triggered ? copy(locale, "userSide.triggeredRestraint") : "";

  return `${title}\n${parts.join("\n")}\n${note}${restraint ? `\n${restraint}` : ""}`;
}



/**
 * How many calendar days apart two moments are, on the user's own clock.
 *
 * It used to be `Math.floor((now - then) / 86_400_000)` — elapsed
 * twenty-four-hour periods, not calendar days. So an event recorded at
 * half past eleven in the evening was "yesterday" at half past twelve
 * that night: the same evening, one hour apart, and the persona was
 * told the user had been together with them *today* when it had
 * happened the day before.
 *
 * Every event recorded in the evening was mislabelled, and the persona
 * was told it as a fact it already knows.
 *
 * The count is now the distance between the two day keys, on the user's
 * own clock — so the day a thing happened on is the day it is called.
 */
export function calendarDaysBetween(
  earlier: Date | string,
  later: Date | string,
  timeZone?: string | null,
): number {
  const from = new Date(earlier);
  const to = new Date(later);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const fromKey = zonedDateKey(from, timeZone);
  const toKey = zonedDateKey(to, timeZone);
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromKey);
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toKey);
  if (!fromMatch || !toMatch) return 0;
  // The keys are calendar days, so the distance between them is a
  // calendar distance: the day count, done on the Gregorian calendar
  // rather than on a clock.
  const fromUtc = Date.UTC(
    Number(fromMatch[1]),
    Number(fromMatch[2]) - 1,
    Number(fromMatch[3]),
  );
  const toUtc = Date.UTC(
    Number(toMatch[1]),
    Number(toMatch[2]) - 1,
    Number(toMatch[3]),
  );
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * A short, human date for an event.
 *
 * The `now` is the one the caller was given, not the wall clock: the
 * relative dates in the prompt were wrong whenever a caller supplied a
 * `now` — the scheduler's sweeps, the evaluations, the replays — and
 * the same function's freshness check used a different clock than its
 * own date labels.
 *
 * The days are calendar days on the user's own clock, not elapsed
 * twenty-four-hour periods — see `calendarDaysBetween`.
 */
function formatWhen(
  value: Date | string,
  locale: "zh" | "en",
  now: Date = new Date(),
  timeZone?: string | null,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = calendarDaysBetween(date, now, timeZone);
  if (days === 0) return copy(locale, "userSide.when.today");
  if (days === 1) return copy(locale, "userSide.when.yesterday");
  if (days < 7) return copy(locale, "userSide.when.daysAgo", { days });
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return copy(
      locale,
      weeks > 1 ? "userSide.when.weeksAgo" : "userSide.when.weekAgo",
      { weeks },
    );
  }
  /**
   * The day, in the server's own calendar.
   *
   * The value is a wall clock with no time zone in it — the server's
   * own — and `toISOString()` converts it to UTC. So a relationship
   * event recorded on the first of January at half past midnight on a
   * server east of Greenwich was printed as the thirty-first of
   * December: the persona was told the wrong day for every event older
   * than a month.
   */
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether the two of them can currently reach each other.
 *
 * A distance is not a breakup. The app had no way to say that, so "we
 * are apart" and "we broke up" were the same thing — and a person who
 * was simply out of touch was treated as though it were over.
 */
export type Reachability = "reachable" | "unreachable";

export const REACHABILITIES: readonly Reachability[] = ["reachable", "unreachable"];

export function isReachability(value: unknown): value is Reachability {
  return (
    typeof value === "string" &&
    (REACHABILITIES as readonly string[]).includes(value)
  );
}

/**
 * The line that goes into the prompt when the two of them are out of
 * touch.
 *
 * The register changes: somebody you cannot reach gets a letter, not a
 * text message. That is not a punishment — it is what the situation
 * actually sounds like.
 */
export function buildReachabilityNote(
  reachability: Reachability,
  locale: "zh" | "en" = "zh",
): string {
  if (reachability !== "unreachable") return "";
  return copy(locale, "userSide.unreachable");
}

/**
 * The memory ids a message recorded.
 *
 * The value is a JSON array of ids, written down when the turn happened.
 * A malformed value is treated as no memories rather than an error: it
 * is a note, not a document.
 */
export function parseRecalledIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    /**
     * Only a number, or a string that is one.
     *
     * `Number(null)` is zero — so a list that held a null held the
     * memory with the id zero, and the id zero is not a memory. A
     * memory that was never written down must not be looked up.
     */
    return parsed
      .map((n) => {
        if (typeof n === "number") return n;
        if (typeof n === "string" && n.trim() !== "") return Number(n);
        return Number.NaN;
      })
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}
