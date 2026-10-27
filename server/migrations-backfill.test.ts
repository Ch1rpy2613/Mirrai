import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "drizzle");

/**
 * The backfill after a new column.
 *
 * A column that is added and then filled in has to be added
 * *without* the not-null first — the not-null is what the backfill
 * breaks:
 *
 *   ALTER TABLE t ADD COLUMN c timestamp DEFAULT now() NOT NULL;
 *   UPDATE t SET c = extracted_at WHERE c IS NULL;
 *
 * The second statement can never match a row. The column is not null
 * and it cannot be — the default filled it in when the column was
 * added. So every row that was already there was stamped with the
 * moment the migration ran, and the backfill did nothing at all.
 *
 * The right order is: add it nullable, backfill it, and then make it
 * not null.
 */
describe("the backfill after a new column", () => {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"));

  it("has migrations to look at", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const name of files) {
    it(`${name} has a backfill that can match a row`, () => {
      const source = readFileSync(path.join(MIGRATIONS, name), "utf-8");
      const at = source.indexOf("-- mirrai: down");
      const up = at === -1 ? source : source.slice(0, at);

      // Every backfill: UPDATE <table> SET "col" = ... WHERE "col" IS NULL
      const backfill =
        /UPDATE\s+"?(\w+)"?\s+SET\s+"?(\w+)"?\s*=\s*[^;]*?WHERE\s+"?(\w+)"?\s+IS\s+NULL/gi;
      for (const match of up.matchAll(backfill)) {
        const [, , column, whereColumn] = match;
        // The column that is set is the one that has to be null.
        expect(whereColumn).toBe(column);

        // The column is added somewhere in this file (or another one).
        const added = new RegExp(
          `ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${column}"?\\s+[^;]*;`,
          "gi",
        ).test(up);

        if (!added) continue; // The column was already there — nothing to check.

        // Now: is the ADD COLUMN statement the one that makes it not null?
        const statement = up.match(
          new RegExp(
            `ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${column}"?\\s+[^;]*;`,
            "i",
          ),
        )!;

        expect(
          statement[0],
          `${name}: the backfill of "${column}" can never match a row — ` +
            `the column is added NOT NULL, so it is never null and the ` +
            `UPDATE finds nothing. Add it nullable, backfill it, and ` +
            `then make it not null.`,
        ).not.toMatch(/\bNOT\s+NULL\b/i);
      }
    });
  }
});
