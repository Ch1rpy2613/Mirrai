import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

/**
 * Every column, and the migration that adds it.
 *
 * The plan said the behaviour profile needed no SQL, on the grounds that
 * `personaData` is jsonb. That was true of the fields *inside*
 * `personaData` and not true of `personas.behaviorProfile`, which is a
 * column of its own — and an upgraded install would have failed on every
 * read of a persona, because the column is selected with the rest of
 * them.
 *
 * Nothing caught it: the schema check compared the schema against a
 * database built from that same schema, so a column missing from the
 * migrations looked fine. This test compares the schema against the
 * *migrations* instead, which is the other direction.
 */
const ROOT = path.resolve(__dirname, "..");
const schema = readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
const migrations = readdirSync(path.join(ROOT, "drizzle"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(path.join(ROOT, "drizzle", name), "utf-8"))
  .join("\n");

/** The columns each table declares, as `table -> [column]`. */
function declaredColumns(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const tablePattern = /export const (\w+) = pgTable\("([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(schema)) !== null) {
    const tableName = match[2];
    // The table body runs until the next `pgTable(` or the end.
    const start = match.index;
    // The search starts past this table's own declaration, or it finds
    // this table again and reads an empty body.
    const next = schema.indexOf("= pgTable(", match.index + match[0].length);
    const body = schema.slice(start, next === -1 ? schema.length : next);
    const columns = new Set<string>();
    for (const column of body.matchAll(/\w+\(\s*"([^"]+)"\s*\)/g)) {
      columns.add(column[1]);
    }
    out[tableName] = [...columns];
  }
  return out;
}

/** The tables the migrations create. */
function createdTables(): Set<string> {
  const out = new Set<string>();
  for (const match of migrations.matchAll(
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi,
  )) {
    out.add(match[1]);
  }
  return out;
}

/** The columns the migrations add to an existing table. */
function addedColumns(): Set<string> {
  const out = new Set<string>();
  for (const match of migrations.matchAll(
    /ALTER TABLE(?:\s+IF EXISTS)?\s+"([^"]+)"\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi,
  )) {
    out.add(`${match[1]}.${match[2]}`);
  }
  return out;
}

describe("the migrations cover the schema", () => {
  const tables = declaredColumns();
  const created = createdTables();
  const added = addedColumns();

  it("finds the tables in the schema", () => {
    expect(Object.keys(tables).length).toBeGreaterThan(5);
  });

  it("creates every table, or adds its columns to one that exists", () => {
    const uncovered: string[] = [];
    for (const [table, columns] of Object.entries(tables)) {
      // A table that no migration creates must have been created before
      // this phase — the base schema. Its columns are covered by the
      // full-schema dumps in 0000/0001.
      if (created.has(table)) continue;
      const coveredByOldDumps = table !== "personas";
      if (coveredByOldDumps) continue;
      for (const column of columns) {
        if (!added.has(`${table}.${column}`)) uncovered.push(`${table}.${column}`);
      }
    }
    expect(
      uncovered,
      "these columns are in the schema but no migration adds them — an " +
        "upgraded install would fail on every read of the table",
    ).toEqual([]);
  });

  it("adds every column the plan added to the personas table", () => {
    // The three columns this phase put on the persona itself, each of
    // which is selected with the rest of the row.
    for (const column of [
      "behaviorProfile",
      "farewellDegraded",
      "farewellDraft",
    ]) {
      expect(
        added.has(`personas.${column}`),
        `personas.${column} is declared in the schema but no migration adds it`,
      ).toBe(true);
    }
  });

  it("gives every migration of this phase a way back", () => {
    // A migration that cannot be undone cannot be rolled back, and a
    // rollback that stops halfway is worse than one that refuses to
    // start. So each one carries its own down section.
    const files = readdirSync(path.join(ROOT, "drizzle")).filter((name) =>
      name.endsWith(".sql"),
    );
    const withoutDown: string[] = [];
    for (const name of files) {
      const sql = readFileSync(path.join(ROOT, "drizzle", name), "utf-8");
      if (!sql.includes("mirrai: idempotent-migration")) continue;
      // The migrations of this phase. The ones before it predate the
      // rollback, and the script says so rather than undoing half a
      // chain — a migration without a down section is simply not
      // undoable, and it is named in the error when it comes up.
      if (Number.parseInt(name, 10) < 20) continue;
      if (!sql.includes("mirrai: down")) withoutDown.push(name);
    }
    expect(
      withoutDown,
      "these migrations cannot be rolled back",
    ).toEqual([]);
  });

  it("puts the down section after the up one", () => {
    // The up half is everything before the down marker, so a down
    // section that came first would undo the migration as it was
    // applied.
    for (const name of readdirSync(path.join(ROOT, "drizzle")).filter((n) =>
      n.endsWith(".sql"),
    )) {
      const sql = readFileSync(path.join(ROOT, "drizzle", name), "utf-8");
      const down = sql.indexOf("mirrai: down");
      if (down === -1) continue;
      const up = sql.indexOf("mirrai: idempotent-migration");
      expect(up, `${name} has a down section before its up one`).toBeLessThan(down);
    }
  });

  it("adds every column the plan added to the new tables", () => {
    for (const [table, columns] of Object.entries(tables)) {
      if (!created.has(table)) continue;
      // A created table brings all of its columns with it.
      expect(columns.length).toBeGreaterThan(0);
    }
    for (const table of ["eval_cases", "eval_runs", "outbound_letters"]) {
      expect(created.has(table), `${table} is never created by a migration`).toBe(true);
    }
  });
});
