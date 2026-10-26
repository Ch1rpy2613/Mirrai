import { sql } from "drizzle-orm";
import { messages } from "../../drizzle/schema";
import { dayShiftMinutes } from "@shared/timezone";

/**
 * The day a message belongs to, in the user's own calendar.
 *
 * The shift is written into the SQL rather than bound as a parameter.
 *
 * The same expression is used in the select, the group by and the order
 * by, and Postgres compares those literally — two different placeholders
 * are two different expressions, so the query is rejected with
 * "column messages.createdAt must appear in the GROUP BY clause".
 *
 * Every chart of the day — the volume, the daily counts, the streak, the
 * activity — was failing with that, and the failure was a 500, so the
 * page showed nothing at all rather than an empty chart.
 *
 * The shift is a number computed here, not anything the user typed, so
 * writing it into the SQL is safe.
 *
 * The shift is in minutes: an interval in hours cannot carry the half
 * hour that India, Adelaide, Kathmandu and Chatham are on, and a rounded
 * shift put the user's day boundary out by up to forty-five minutes.
 */
/**
 * The hour a message was written at, in the user's own calendar.
 *
 * The same shift as the day, for the same reason: the chart of the
 * active hours and the chart of the days have to be on the same
 * calendar, or the same page shows two different days.
 */
export function userHourColumn(timezone?: string | null) {
  const shift = dayShiftMinutes(timezone);
  return sql<number>`EXTRACT(HOUR FROM ${messages.createdAt} + (${sql.raw(String(shift))} * INTERVAL '1 minute'))::int`;
}

export function userDayColumn(timezone?: string | null) {
  const shift = dayShiftMinutes(timezone);
  return sql<string>`TO_CHAR(${messages.createdAt} + (${sql.raw(String(shift))} * INTERVAL '1 minute'), 'YYYY-MM-DD')`;
}
