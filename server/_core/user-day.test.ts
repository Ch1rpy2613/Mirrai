import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { userDayColumn } from "./user-day";
import { dayShiftMinutes } from "@shared/timezone";

/**
 * The day a message belongs to.
 *
 * The expression is used in the select, in the group by and in the order
 * by, and Postgres compares those literally. So the expression must not
 * carry a parameter: two placeholders are two different expressions, and
 * the query is rejected with "column messages.createdAt must appear in
 * the GROUP BY clause".
 *
 * It did carry one — and every chart of the day was a 500: the volume,
 * the daily counts, the streak, the activity. The page showed nothing
 * at all rather than an empty chart, and nothing said why.
 */
const dialect = new PgDialect();

describe("the day a message belongs to", () => {
  it("carries no parameter", () => {
    const query = dialect.sqlToQuery(userDayColumn("Asia/Shanghai"));
    expect(query.params).toEqual([]);
  });

  it("is the same expression wherever it is used", () => {
    // Rendered twice, as it is in the query: in the select list and in
    // the group by. Postgres sees the two texts, and they have to match.
    const inSelect = dialect.sqlToQuery(userDayColumn("Asia/Shanghai")).sql;
    const inGroupBy = dialect.sqlToQuery(userDayColumn("Asia/Shanghai")).sql;
    expect(inSelect).toBe(inGroupBy);
    expect(inSelect).not.toMatch(/\$\d/);
  });

  it("moves the timestamp into the user's calendar", () => {
    // The zone names are used, so Postgres works out the offset of
    // *every* row — a shift in minutes is fixed at "now", and an hour
    // is enough to put a message on the neighbouring day for the days
    // on the far side of a daylight-saving change.
    const sql = dialect.sqlToQuery(userDayColumn("Asia/Kolkata")).sql;
    expect(sql).toContain("AT TIME ZONE");
    expect(sql).toContain("'Asia/Kolkata'");
  });

  it("does not move the timestamp when there is no zone", () => {
    const sql = dialect.sqlToQuery(userDayColumn(null)).sql;
    expect(sql).toContain("0 * INTERVAL '1 minute'");
  });

  it("falls back to the shift when the zone is not one the runtime knows", () => {
    // The user's zone is a free string in their profile, so it cannot
    // be written into the SQL as it is — and a name the runtime does
    // not know would make Postgres refuse the query outright.
    const shift = dayShiftMinutes("Not/AZone");
    const sql = dialect.sqlToQuery(userDayColumn("Not/AZone")).sql;
    expect(sql).toContain(`${shift} * INTERVAL '1 minute'`);
    expect(sql).not.toContain("Not/AZone");
  });

  it("refuses a zone name that tries to be something else", () => {
    const sql = dialect.sqlToQuery(userDayColumn("UTC'; DROP TABLE messages; --")).sql;
    expect(sql).not.toContain("DROP TABLE");
  });
});
