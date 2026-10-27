/**
 * Conversation-intensity monitoring.
 *
 * The product document describes three signals the app should watch for:
 * a single conversation that runs too long, too many conversations in a day,
 * and a rising dependency trend. None of them existed in code before; this
 * module implements them.
 */
import * as db from "../db";
import { copy } from "@shared/copy";
import { dayShiftMinutes, zonedDateKey } from "@shared/timezone";

/** A single unbroken conversation longer than this triggers a check-in. */
export const LONG_SESSION_MS = 2 * 60 * 60 * 1000;

/**
 * How long a silence has to be before it ends a conversation session.
 *
 * A session is a run of messages with no long pause in it. This is what
 * separates "one long conversation" from "the user came back tonight".
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** More than this many messages in a day triggers a check-in. */
export const DAILY_MESSAGE_LIMIT = 5;

/** Dependency trend: recent frequency against the previous week. */
export const DEPENDENCY_RATIO = 1.5;
export const DEPENDENCY_RISING_DAYS = 3;

/**
 * The days the dependency comparison is made over.
 *
 * Two full weeks of days that are over, and then today.
 *
 * The series used to be fourteen long — one day was taken off the end
 * for "today", and the two halves were cut at seven — so the recent
 * half was a day short of the previous one. The ratio is written as
 * 1.5×, and a rise of 1.5× over seven days is 1.75× over six, so the
 * signal could not fire in the case it was written for: exactly when
 * the user's own use was climbing fastest.
 */
export const DEPENDENCY_WINDOW_DAYS = 14;

export interface UsageSignals {
  /** How long the current conversation session has been running. */
  sessionDurationMs: number;
  /** Messages the user sent today. */
  dailyMessageCount: number;
  /** Whether the dependency trend looks like it is climbing. */
  dependencyRising: boolean;
  /** Daily message counts for the last 15 days, oldest first. */
  dailyCounts: number[];
}

/**
 * The start of the user's own day, in the server's own clock.
 *
 * The messages are stored with the server's wall clock — so the start of
 * the user's day has to be expressed in it too.
 *
 * It used to be the *server's* midnight, and the day key it was looked
 * up under was the *UTC* date: three calendars for one measurement. So
 * the "five messages a day" limit, and — worse — the dependency signal
 * built from the daily counts, were measured on a shifted series. On any
 * server that is not on UTC the last, partial day was dropped and every
 * other day was looked up under the wrong key.
 */
function startOfUserDay(now: Date, timezone?: string | null): Date {
  const start = new Date(now.getTime());
  const shift = dayShiftMinutes(timezone, now);
  start.setMinutes(start.getMinutes() + shift);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(start.getMinutes() - shift);
  return start;
}

/**
 * Collects the current usage signals for a user and persona.
 *
 * The session duration is measured from the start of the current run of
 * messages, not from the gap before the newest one. The old measurement
 * was the gap, so a five-hour conversation never tripped the check while
 * a user returning after three hours away tripped it at once.
 *
 * The daily counts are the user's own messages. Counting the persona's
 * replies as well meant "five a day" was really "three conversations a
 * day", and the threshold fired at twice the rate it was written for.
 */
export async function evaluateUsage(params: {
  userId: number;
  personaId: number;
  now?: number;
  /** The user's own time zone. */
  timezone?: string | null;
}): Promise<UsageSignals> {
  const nowMs = params.now ?? Date.now();
  const now = new Date(nowMs);
  const timezone = params.timezone ?? null;

  const sessionStart = await db
    .getSessionStartAt(params.personaId, params.userId, SESSION_GAP_MS)
    .catch(() => null);
  const sessionDurationMs = sessionStart ? nowMs - sessionStart.getTime() : 0;

  const dailyMessageCount = await db.getUserMessageCountSince(
    params.userId,
    startOfUserDay(now, timezone),
  );

  /**
   * The days, oldest first: two full weeks that are over, and today.
   */
  const seriesLength = DEPENDENCY_WINDOW_DAYS + 1;
  // The rows are filed under the user's own day keys.
  const rows = await db.getDailyUserChatCounts(params.userId, seriesLength, timezone);
  const byDate = new Map(rows.map((r) => [r.date, Number(r.count)]));
  const dailyCounts: number[] = [];
  for (let i = seriesLength - 1; i >= 0; i--) {
    const date = new Date(now.getTime());
    date.setDate(date.getDate() - i);
    // The key is the user's day, not the UTC date.
    dailyCounts.push(byDate.get(zonedDateKey(date, timezone)) ?? 0);
  }

  /**
   * The days that are over.
   *
   * Today is not one of them: it is a day in progress. So the
   * comparison of the last few days included it — and a day that is
   * half over is almost always smaller than the day before it, so the
   * "rising" test could not fire. The signal was under-reported by
   * exactly the case it was written for.
   *
   * The weeks are compared the same way, so that both sides are
   * counted over whole days.
   */
  const completeDays = dailyCounts.slice(0, -1);
  const todayCount = dailyCounts[dailyCounts.length - 1] ?? 0;
  const recentWeek = completeDays.slice(DEPENDENCY_WINDOW_DAYS / 2).reduce((a, b) => a + b, 0);
  const previousWeek = completeDays.slice(0, DEPENDENCY_WINDOW_DAYS / 2).reduce((a, b) => a + b, 0);

  const lastDays = completeDays.slice(-DEPENDENCY_RISING_DAYS);
  const risingConsecutively = lastDays.every(
    (value, index) => index === 0 || value >= lastDays[index - 1],
  ) && lastDays[lastDays.length - 1] > 0;

  /**
   * The user has spoken today.
   *
   * The rise is read from the days that are over — but a burst that
   * ended yesterday is not a rise either, and the only sign of that
   * is a day with nothing in it. So today has to have something in
   * it: a user who has not said anything yet today has not come to
   * the app *more* and more.
   */
  const spokeToday = todayCount > 0;

  // A user who went from nothing to a lot of messages is the onset case worth
  // catching: there is no previous week to compare against, so the ratio
  // rule cannot fire on its own.
  const grewFromNothing = previousWeek === 0 && recentWeek > 0;
  const grewFromBefore = previousWeek > 0 && recentWeek > previousWeek * DEPENDENCY_RATIO;

  const dependencyRising =
    (grewFromNothing || grewFromBefore) && risingConsecutively && spokeToday;

  return {
    sessionDurationMs,
    dailyMessageCount,
    dependencyRising,
    dailyCounts,
  };
}

export type CareNoteKind = "long_session" | "daily_frequency" | "dependency";

/**
 * The translation keys the client renders.
 *
 * The server still sends the Chinese line as `text`, but a client that
 * speaks another language should render its own wording — so every note
 * carries the key it came from.
 */
export type CareNoteTextKey =
  | "safety.care.longSession"
  | "safety.care.dailyLimit"
  | "safety.care.dependency";

export interface CareNote {
  kind: CareNoteKind;
  /** The line appended to the persona's reply — the Chinese fallback. */
  text: string;
  /** The key the client translates; preferred over `text`. */
  textKey: CareNoteTextKey;
  /** Whether the UI should also show a banner. */
  showBanner: boolean;
}

/**
 * Chooses the care note to append, if any.
 *
 * At most one note is returned — stacking them would turn a reply into a
 * lecture.
 *
 * The dependency signal comes first. It is the one that speaks to the risk
 * the product names outright ("情感依赖"), and it is the rarest: the daily
 * threshold trips after a few conversations, so it used to pre-empt the
 * dependency note every single time it could have fired.
 */
export function pickCareNote(signals: UsageSignals, locale: "zh" | "en" = "zh"): CareNote | null {
  if (signals.dependencyRising) {
    return {
      kind: "dependency",
      text: copy(locale, "labels.care.dependency"),
      textKey: "safety.care.dependency",
      showBanner: true,
    };
  }

  if (signals.sessionDurationMs > LONG_SESSION_MS) {
    return {
      kind: "long_session",
      text: copy(locale, "labels.care.longSession"),
      textKey: "safety.care.longSession",
      showBanner: false,
    };
  }

  if (signals.dailyMessageCount > DAILY_MESSAGE_LIMIT) {
    return {
      kind: "daily_frequency",
      text: copy(locale, "labels.care.dailyLimit"),
      textKey: "safety.care.dailyLimit",
      showBanner: true,
    };
  }

  return null;
}
