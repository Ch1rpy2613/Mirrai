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

/**
 * The name of the zone this process runs in.
 *
 * The stored wall clock is the *server's* clock — the `pg` driver
 * writes a Date in the process's own zone — so the conversion from it
 * to the user's day has to start from the process's zone.
 */
function serverZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * A zone name that can be written into the SQL.
 *
 * The zone names are written into the SQL literally — Postgres compares
 * the select, the group by and the order by *literally*, so two
 * placeholders are two different expressions and the query is rejected
 * with "column messages.createdAt must appear in the GROUP BY clause".
 *
 * So the name has to be safe to write in. The user's zone is a free
 * string in their profile, so it is checked against the runtime's own
 * list of zones first: a name the runtime does not know is refused (and
 * the shift is used instead), and a name that tries to be something
 * else never reaches the SQL at all.
 */
function safeZoneName(zone: string | null | undefined): string | null {
  if (!zone || zone.length > 64) return null;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * The day a message belongs to, in the user's own calendar.
 *
 * The zone names are used, not a shift in minutes.
 *
 * The shift was fixed: the difference between the user's offset *now*
 * and the server's offset *now*. But the offset of a zone is not the
 * same all year — so for the days on the far side of a daylight-saving
 * change, the shift was an hour out, and an hour is enough to put a
 * message on the neighbouring day. The count was then looked up under
 * the key the *JavaScript* computed (which is right, because it knows
 * the offset of that date), and the row was not there: so the daily
 * series silently lost an hour's worth of every day on the far side of
 * a transition, and the dependency signal that is built on it read a
 * series with days missing from it.
 *
 * Postgres knows the offset of every date, so the zone names are used
 * and the offset is worked out per row.
 */
export function userDayColumn(timezone?: string | null) {
  const userZone = safeZoneName(timezone);
  const serverZone = safeZoneName(serverZoneName()) ?? "UTC";
  if (!userZone) {
    /**
     * The zone is not a name we can write into the SQL.
     *
     * The shift is used then — the same shift as before, with its
     * daylight-saving blind spot. It is the better of the two for a
     * zone the runtime does not know.
     */
    const shift = dayShiftMinutes(timezone);
    return sql<string>`TO_CHAR(${messages.createdAt} + (${sql.raw(String(shift))} * INTERVAL '1 minute'), 'YYYY-MM-DD')`;
  }
  return sql<string>`TO_CHAR(${messages.createdAt} AT TIME ZONE ${sql.raw(`'${serverZone}'`)} AT TIME ZONE ${sql.raw(`'${userZone}'`)}, 'YYYY-MM-DD')`;
}
