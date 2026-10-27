/**
 * The dates, in the reader's own language.
 *
 * The interface prints dates in the reader's locale and format — and
 * a few places printed the stored value instead: "2026-03-01", or
 * "2021-05", next to dates that were formatted. Two dates about the
 * same thing, in two formats, on the same screen.
 */

/**
 * A day key — "2026-03-01" — as a date in the reader's language.
 *
 * The key is a day, not an instant, so it is read in the browser's
 * own zone: there is no hour to shift.
 */
export function formatDayKey(dayKey: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey ?? ""));
  if (!match) return String(dayKey ?? "");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return String(dayKey);
  return date.toLocaleDateString(locale);
}

/**
 * A month key — "2021-05" — as a month in the reader's language.
 *
 * The first of the month is the day that is used, so the month shown
 * is the month the key names — whatever the zone.
 */
export function formatMonthKey(monthKey: string, locale: string): string {
  /**
   * Both shapes are accepted.
   *
   * The editor asks for "2021-05" — but the date picker in the lobby
   * hands over "2021-05-01", and the questionnaire takes whatever the
   * user typed. So the month is read out of either.
   */
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(monthKey ?? ""));
  if (!match) return String(monthKey ?? "");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return String(monthKey);
  return date.toLocaleDateString(locale, { year: "numeric", month: "long" });
}

/**
 * An instant, as a date in the reader's own calendar.
 *
 * The browser's zone and the zone the user has chosen are not always
 * the same: a person whose partner is abroad, one whose machine is set
 * to the wrong city, one who travels. Every other date on the pages is
 * read in the zone the user chose, so this one has to be as well —
 * otherwise the date a persona said goodbye on is a day off from the
 * date the timeline right above it says.
 *
 * A day key is not an instant, so it is read with `formatDayKey`; this
 * is for the values that carry an hour.
 */
export function formatInstantInZone(
  value: string | number | Date | null | undefined,
  locale: string,
  timeZone?: string | null,
): string {
  const date = value instanceof Date ? value : new Date(value ?? NaN);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || "zh", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // A zone this browser does not know.
    return date.toLocaleDateString(locale);
  }
}

/**
 * An instant, as a time in the reader's own calendar.
 *
 * The same rule as `formatInstantInZone`: the browser's zone and the
 * zone the user has chosen are not always the same, and the times on
 * the messages are read in the zone the user chose like every other
 * date on the app.
 */
export function formatTimeInZone(
  value: string | number | Date | null | undefined,
  locale: string,
  timeZone?: string | null,
): string {
  const date = value instanceof Date ? value : new Date(value ?? NaN);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || "zh", {
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // A zone this browser does not know.
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
}

/**
 * An instant, as a date and a time in the reader's own calendar.
 *
 * The same rule as `formatInstantInZone`: the user's zone, not the
 * browser's.
 */
export function formatDateTimeInZone(
  value: string | number | Date | null | undefined,
  locale: string,
  timeZone?: string | null,
): string {
  const date = value instanceof Date ? value : new Date(value ?? NaN);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || "zh", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // A zone this browser does not know.
    return date.toLocaleString(locale);
  }
}
