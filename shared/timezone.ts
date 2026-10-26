/**
 * Time zones.
 *
 * The app used the server's clock for everything. That is fine for a single
 * person in a single place, and wrong for everyone else: a persona who lives
 * in London was told it was the user's evening, and a persona who lives in
 * Sydney was told it was morning at three in the afternoon.
 *
 * The times are computed with `Intl`, which both the browser and Node
 * understand. A missing or unknown zone falls back to the local time — the
 * old behaviour — rather than throwing.
 */
import { copy } from "./copy";

/** The hour of the day (0-23) in a given time zone. */
export function zonedHour(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value;
    if (hour === undefined) return date.getHours();
    // Intl renders midnight as "24" in some locales.
    return Number.parseInt(hour, 10) % 24;
  } catch {
    return date.getHours();
  }
}

/**
 * The minute of the hour (0-59) in a given time zone.
 *
 * The quiet-hours window is measured in minutes, and the hour alone
 * would put a reminder an hour early or an hour late.
 */
export function zonedMinute(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      minute: "numeric",
      hour12: false,
    }).formatToParts(date);
    const minute = parts.find((part) => part.type === "minute")?.value;
    return minute === undefined ? date.getMinutes() : Number.parseInt(minute, 10);
  } catch {
    return date.getMinutes();
  }
}

/**
 * The offset of a time zone from UTC, in minutes.
 *
 * Minutes, not hours: half-hour zones exist. India is at +5:30,
 * Adelaide at +9:30, Kathmandu at +5:45, Chatham at +12:45 — and
 * rounding them to whole hours put the user's day boundary fifteen to
 * forty-five minutes out, so the first half hour of an Indian user's
 * day was attributed to the day before.
 *
 * This is the number the SQL uses to move a stored timestamp into the
 * user's calendar, and it has to agree exactly with `zonedDateKey` in
 * this same file — which is why it is kept in minutes.
 */
export function zonedOffsetMinutes(date: Date, timeZone?: string | null): number {
  if (!timeZone) return -date.getTimezoneOffset();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const read = (type: string) =>
      Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    );
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return -date.getTimezoneOffset();
  }
}

/**
 * The hour of the day (0-23) in a given time zone, as a UTC offset in hours.
 *
 * A whole number, so it is not exact for the half-hour zones — use
 * `zonedOffsetMinutes` when the difference has to be precise.
 */
export function zonedOffsetHours(date: Date, timeZone?: string | null): number {
  return zonedOffsetMinutes(date, timeZone) / 60;
}

/** A readable local time in a given time zone, e.g. "凌晨 3:20". */
export function formatZonedClock(
  date: Date,
  timeZone?: string | null,
  locale: "zh" | "en" = "zh",
): string {
  if (!timeZone) {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    if (locale === "en") {
      return `${String(hours).padStart(2, "0")}:${minutes}`;
    }
    const period =
      hours < 6
        ? copy(locale, "labels.time.dawn")
        : hours < 12
          ? copy(locale, "labels.time.morning")
          : hours < 18
            ? copy(locale, "labels.time.afternoon")
            : copy(locale, "labels.time.evening");
    return `${period} ${hours}:${minutes}`;
  }
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: locale === "en",
    }).format(date);
  } catch {
    return formatZonedClock(date, null, locale);
  }
}

/**
 * The day, as "YYYY-MM-DD", in a given time zone.
 *
 * A mood recorded at eleven at night in Shanghai belongs to that day in
 * Shanghai, not to whatever day the server thinks it is.
 */
export function zonedDateKey(date: Date, timeZone?: string | null): string {
  /**
   * No zone: the server's own day.
   *
   * It used to be the *UTC* day — and the database's day column is the
   * server's own wall clock. So the two calendars disagreed for the
   * first hours of every local day on any server that is not on UTC,
   * and the places that compare them directly — the consecutive-days
   * streak — broke at local midnight.
   *
   * `localDateKey` is the same key, and it is deliberately not
   * `toISOString().slice(0, 10)`.
   */
  if (!timeZone) return localDateKey(date);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const read = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const year = read("year");
    const month = read("month");
    const day = read("day");
    if (!year || !month || !day) return localDateKey(date);
    return `${year}-${month}-${day}`;
  } catch {
    return localDateKey(date);
  }
}

/**
 * How many hours the user's clock is ahead of the server's.
 *
 * The database stores timestamps as a wall clock with no time zone in it —
 * the server's own. A message written at half past nine in the evening in
 * Shanghai is stored as 21:30, and the day it belongs to is the day it was
 * 21:30 for the *user*, which is not the same day when the server and the
 * user are in different places.
 *
 * This is the number of hours to add to the stored value to land on the
 * user's clock. It is zero when the zone is the same as the server's, and
 * it ignores the hour an hour of daylight saving makes it ambiguous —
 * which is the right trade for counting days.
 */
export function dayShiftHours(timeZone?: string | null, now: Date = new Date()): number {
  if (!timeZone) return 0;
  return zonedOffsetHours(now, timeZone) - zonedOffsetHours(now, null);
}

/**
 * The same shift, in minutes.
 *
 * This is the one the SQL uses: the shift is applied as an interval,
 * and an interval in hours cannot carry the half hour that India,
 * Adelaide, Kathmandu and Chatham are on.
 */
export function dayShiftMinutes(timeZone?: string | null, now: Date = new Date()): number {
  if (!timeZone) return 0;
  return zonedOffsetMinutes(now, timeZone) - zonedOffsetMinutes(now, null);
}

/**
 * The day key, `days` days ago, in a given time zone.
 *
 * It is the key of the day that opens the window — the oldest day a
 * "last N days" chart may show.
 *
 * The rows of a chart carry the user's own day in their `date` column,
 * so the window has to be a day key in the same calendar. Comparing
 * them against the server's clock is how a chart ends up showing one
 * day more than it says.
 */
export function zonedDayKeySince(
  days: number,
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  const key = zonedDateKey(now, timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The day before a "YYYY-MM-DD" key.
 *
 * Pure arithmetic on the key, with no time zone in it: the key is a
 * calendar day, so the day before it is a calendar day too. Doing this
 * with a `Date` would drag the machine's own offset into it.
 */
export function previousDateKey(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The day, as "YYYY-MM-DD", in the server's own calendar.
 *
 * The database stores timestamps *without* a time zone, so a row's day is
 * the day it was written on the machine that wrote it — which is what
 * `DATE(createdAt)` returns in the database. This is the same key, made
 * in JavaScript, so the two can be compared.
 *
 * It is deliberately not `toISOString().slice(0, 10)`: that is the *UTC*
 * day, and on a server that is not on UTC it is the wrong day for half
 * of every day.
 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether a string is a day that exists.
 *
 * "9999-99-99" and "2026-02-30" have the right shape and are not
 * days. A pattern check alone cannot tell the difference, so a day
 * like that could be stored — and then it could never be a day the
 * chart could show.
 */
export function isRealDayKey(dayKey: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // The last day of the month.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/** Whether a time zone name is one this runtime understands. */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The days since the last contact.
 *
 * "How long since you last spoke" is one of the first things a person
 * wants to know about a relationship, and the app used to answer it
 * only in the relative form buried in a card. It is a number, and it
 * belongs somewhere the user can see it.
 */
export function daysSinceContact(
  lastChatAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastChatAt) return null;
  const then = typeof lastChatAt === "string" ? new Date(lastChatAt) : lastChatAt;
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  return days < 0 ? 0 : days;
}
