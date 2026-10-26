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
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ""));
  if (!match) return String(monthKey ?? "");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return String(monthKey);
  return date.toLocaleDateString(locale, { year: "numeric", month: "long" });
}
