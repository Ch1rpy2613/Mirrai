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
    const asUtc = utcWallClock(
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
 * A calendar day, as the number of milliseconds since the epoch.
 *
 * `Date.UTC` maps a year below a hundred onto 1900–1999 — so the year
 * 99 became 1999, and the day before it came out 1900 years off. The
 * year is set afterwards instead, which does not have that rule.
 */
function utcWallClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
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
 * A day key, moved by a number of days.
 *
 * Pure arithmetic on the key, with no time zone in it: the key is a
 * calendar day, so the day before it is a calendar day too. Doing this
 * with a `Date` would drag the machine's own offset into it.
 */
export function shiftDateKey(key: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(
    utcWallClock(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The midnight of a day, in a zone, as an instant.
 *
 * The offset of a zone is not the same all year — the clocks go forward
 * one Sunday and back the next autumn, and the hour that changes is
 * inside the day. So "the user's midnight" is not "now, shifted by the
 * offset of the zone now": on the day of a change that shift is an hour
 * out, and an hour is enough to put a message on the neighbouring day.
 *
 * So the midnight is worked out from the day it belongs to. The offset
 * is read twice: once for the middle of the day — which is never inside
 * a daylight-saving change — and once for the midnight itself, which is
 * the hour that does change.
 */
export function zonedMidnightForDayKey(dayKey: string, timeZone?: string | null): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  /**
   * No zone: the server's own midnight.
   *
   * The shift was zero then, and the day was the server's — which is
   * what the app has always done for a user who has not chosen a zone.
   */
  if (!timeZone) {
    const start = new Date(utcWallClock(year, month, day));
    start.setHours(0, 0, 0, 0);
    return start;
  }
  // The middle of the day, read as if it were UTC.
  const wallNoon = utcWallClock(year, month, day, 12);
  let offset = zonedOffsetMinutes(new Date(wallNoon), timeZone);
  // The offset at the middle of the day is the offset of the day.
  const offsetAtNoon = zonedOffsetMinutes(new Date(wallNoon - offset * 60_000), timeZone);
  if (offsetAtNoon !== offset) offset = offsetAtNoon;
  // And the midnight has an offset of its own — the hour that changes.
  const wallMidnight = utcWallClock(year, month, day);
  let midnight = wallMidnight - offset * 60_000;
  const offsetAtMidnight = zonedOffsetMinutes(new Date(midnight), timeZone);
  if (offsetAtMidnight !== offset) midnight = wallMidnight - offsetAtMidnight * 60_000;
  return new Date(midnight);
}

/**
 * The user's midnight, as an instant.
 *
 * The day it belongs to is the user's own day — and the midnight is the
 * offset of the zone *at that midnight*, not at the moment the question
 * was asked. See `zonedMidnightForDayKey`.
 */
export function zonedDayStart(
  date: Date,
  timeZone?: string | null,
  daysAgo = 0,
): Date {
  if (!timeZone) {
    // The server's own midnight, N days back.
    const start = new Date(date.getTime());
    start.setHours(0, 0, 0, 0);
    if (daysAgo) start.setDate(start.getDate() - daysAgo);
    return start;
  }
  const key = zonedDateKey(date, timeZone);
  const target = daysAgo ? shiftDateKey(key, -daysAgo) : key;
  return zonedMidnightForDayKey(target, timeZone);
}

/**
 * The middle of a day, in a zone, as an instant.
 *
 * A day the user typed is a calendar day, not an instant — so it is
 * filed at the middle of that day *where they are*, and the interface
 * (which renders it in the reader's own zone) shows the day they meant.
 */
export function zonedNoonForDayKey(dayKey: string, timeZone?: string | null): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return new Date(`${dayKey}T12:00:00Z`);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  /**
   * No zone: the server's own noon.
   *
   * It used to be *UTC* noon — while `zonedMidnightForDayKey`, the
   * other half of the same pair, returns the server's own *local*
   * midnight. So the two disagreed about what "no zone" means: on a
   * server that is eight hours ahead of UTC, a day the user typed was
   * filed at 20:00 in the evening, and the interface showed 20:00 for
   * it. And on a server thirteen hours ahead, the very same entry
   * landed on the next calendar day.
   *
   * The user's own midnight is the server's own midnight — that is the
   * convention the pair follows, and it is the one the database's day
   * column is on.
   */
  if (!timeZone) {
    /**
     * The server's own noon, on the server's own day.
     *
     * It is built with the local constructor — `new Date(year, month,
     * day, 12)`. The first attempt took the *UTC* midnight of that day
     * and then set the local hour to twelve: on a server west of
     * Greenwich the UTC midnight is the *previous* local evening, so
     * the noon came out on the day before — the very thing the caller
     * asks not to happen ("not the day before it for anybody west of
     * Greenwich").
     */
    return new Date(year, month, day, 12, 0, 0, 0);
  }
  const wallNoon = utcWallClock(year, month, day, 12);
  let offset = zonedOffsetMinutes(new Date(wallNoon), timeZone);
  const offsetAtNoon = zonedOffsetMinutes(new Date(wallNoon - offset * 60_000), timeZone);
  if (offsetAtNoon !== offset) offset = offsetAtNoon;
  return new Date(wallNoon - offset * 60_000);
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
  const date = new Date(utcWallClock(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The day key that opens a window of "the last N days".
 *
 * `zonedDayKeySince(days)` is the day `days` days back — which opens a
 * window of N+1 days, today included. A "last thirty days" chart has
 * thirty days in it: the chart of daily messages draws exactly thirty
 * bars, and the chart of the user's own moods right beside it drew
 * thirty-one, starting a day earlier.
 *
 * So the two charts on the analytics page started on different days,
 * and the one the reader's eye lands on last was the one that was
 * wrong.
 */
export function zonedDayKeyWindowStart(
  days: number,
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  return zonedDayKeySince(Math.max(0, days - 1), timeZone, now);
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
    utcWallClock(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
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
  const lastDay = new Date(utcWallClock(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/**
 * Whether a string is a month key — "2021-05".
 *
 * The editor asks for a month: the placeholders say "2021-05", and the
 * questionnaire takes whatever the user typed.
 */
export function isRealMonthKey(monthKey: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * Whether a string is a month key or a day key.
 *
 * Both are accepted, because both are what the app asks for: the date
 * picker hands over a day, and the editor's placeholder asks for a
 * month.
 */
export function isRealStartKey(value: string): boolean {
  return isRealMonthKey(value) || isRealDayKey(value);
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
