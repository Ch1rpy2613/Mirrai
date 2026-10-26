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
    // The shift is the difference between the user's clock and the
    // server's, so it depends on where the server is — but it has to
    // carry the half hour of a half-hour zone.
    const shift = dayShiftMinutes("Asia/Kolkata");
    expect(Math.abs(shift % 60)).toBe(30);
    const sql = dialect.sqlToQuery(userDayColumn("Asia/Kolkata")).sql;
    expect(sql).toContain(`${shift} * INTERVAL '1 minute'`);
  });

  it("does not move the timestamp when there is no zone", () => {
    const sql = dialect.sqlToQuery(userDayColumn(null)).sql;
    expect(sql).toContain("0 * INTERVAL '1 minute'");
  });
});
