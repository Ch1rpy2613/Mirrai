import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "drizzle");

/**
 * The fold-down before a unique index.
 *
 * A table that says "one row per X" but was written with a read and
 * then a write has two rows for one X. Before the constraint can be
 * added, the duplicates are folded down to one — and *which* one is
 * kept is the whole point.
 *
 * It was the wrong one. The comparison deleted the row with the higher
 * id, so the fold kept the **oldest**: the first summary of the day
 * rather than the one written afterwards, and the older of two sets of
 * credentials rather than the ones the user had just re-authenticated.
 *
 * The file's own comment said "the newest of each day" — so the code
 * said one thing and did the other, and nobody noticed for a long time.
 */
describe("the fold-down before a unique index", () => {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"));

  it("has migrations to look at", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const name of files) {
    it(`${name} keeps the newest of the duplicates`, () => {
      const source = readFileSync(path.join(MIGRATIONS, name), "utf-8");
      // The up half only: the down half is not a fold.
      const at = source.indexOf("-- mirrai: down");
      const up = at === -1 ? source : source.slice(0, at);

      // Every fold is a DELETE that pairs a row with a "newer" one.
      const pattern =
        /DELETE FROM\s+"([\w]+)"\s*"old"\s*\nUSING\s+"([\w]+)"\s*"newer"([\s\S]*?);/g;
      for (const match of up.matchAll(pattern)) {
        const [, table, otherTable, conditions] = match;
        // The two are the same table — that is what "folding down" means.
        expect(otherTable, `${name}: the fold pairs two different tables`).toBe(table);
        // And the row that is kept is the newer one: the comparison
        // deletes the OLDER of the two.
        //
        // The column the comparison is on does not matter — the id, or
        // the timestamp the row was written at. What matters is the
        // direction: "old" is the one that goes.
        const comparison = conditions.match(
          /"old"\."(\w+)"\s*(<|>)\s*"newer"\."\1"/,
        );
        expect(
          comparison,
          `${name}: the fold of "${table}" does not compare the two rows`,
        ).not.toBeNull();
        expect(
          comparison?.[2],
          `${name}: the fold of "${table}" keeps the OLDEST of the duplicates — ` +
            `the older row is the one that has to go`,
        ).toBe("<");
      }
    });
  }
});
