import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * The schema and the migrations have to agree.
 *
 * A fresh install builds its schema from `drizzle/schema.ts` (through
 * `drizzle-kit push`), and an existing install applies the SQL files
 * in `drizzle/`. If the two disagree, then the same release behaves
 * differently depending on when it was installed — and the bug that
 * comes out of that is the kind nobody can reproduce.
 *
 * This checks the two of them against each other without a database.
 */
function readSchema(): string {
  return readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
}

/**
 * The up half of every migration.
 *
 * The down half is what a rollback runs, and it is not part of the
 * schema — a `DROP COLUMN` in a down section does not mean the column
 * is missing from the table.
 */
const DOWN_MARKER = "-- mirrai: down";

function readMigrations(): string {
  const dir = path.join(ROOT, "drizzle");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const source = readFileSync(path.join(dir, name), "utf-8");
      const at = source.indexOf(DOWN_MARKER);
      return at === -1 ? source : source.slice(0, at);
    })
    .join("\n");
}

/** The enum values the schema declares, by type name. */
function schemaEnums(): Map<string, Set<string>> {
  const source = readSchema();
  const result = new Map<string, Set<string>>();
  const pattern = /pgEnum\(\s*"([^"]+)"\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const values = new Set<string>();
    for (const value of match[2].matchAll(/"([^"]+)"/g)) values.add(value[1]);
    result.set(match[1], values);
  }
  return result;
}

/** The enum values the migrations produce, by type name. */
function migrationEnums(): Map<string, Set<string>> {
  const source = readMigrations();
  const result = new Map<string, Set<string>>();

  // CREATE TYPE "x" AS ENUM('a', 'b');
  const create = /CREATE TYPE\s+(?:"public"\.)?"([^"]+)"\s+AS ENUM\s*\(([^)]*)\)/g;
  for (const match of source.matchAll(create)) {
    const values = new Set<string>();
    for (const value of match[2].matchAll(/'([^']+)'/g)) values.add(value[1]);
    result.set(match[1], values);
  }

  // ALTER TYPE "x" ADD VALUE [IF NOT EXISTS] 'y';
  const alter = /ALTER TYPE\s+(?:"public"\.)?"([^"]+)"\s+ADD VALUE\s+(?:IF NOT EXISTS\s+)?'([^']+)'/g;
  for (const match of source.matchAll(alter)) {
    const name = match[1];
    if (!result.has(name)) result.set(name, new Set());
    result.get(name)!.add(match[2]);
  }

  return result;
}

/**
 * The columns of a table, by table name.
 *
 * Both the schema and the migrations are read for the column *names*:
 * that is what decides whether a write works at all. The types are
 * checked separately, by the database.
 */
function schemaColumns(): Map<string, Set<string>> {
  const source = readSchema();
  const result = new Map<string, Set<string>>();
  const pattern = /pgTable\(\s*"([^"]+)"\s*,\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    // The body of the table is counted out by its braces, so one table
    // is never read as the next one.
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "{") depth++;
      else if (character === "}") depth--;
      index++;
    }
    const body = source.slice(start, index - 1);
    const columns = new Set<string>();
    for (const column of body.matchAll(/^\s{2}"?([A-Za-z_][A-Za-z0-9_]*)"?\s*[:(]/gm)) {
      columns.add(column[1]);
    }
    result.set(match[1], columns);
  }
  return result;
}

function migrationColumns(): Map<string, Set<string>> {
  const source = readMigrations();
  const result = new Map<string, Set<string>>();

  const ensure = (name: string) => {
    if (!result.has(name)) result.set(name, new Set());
    return result.get(name)!;
  };

  // CREATE TABLE "x" ( "col" type, ... );
  const create = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s*\(([\s\S]*?)\n\);/g;
  for (const match of source.matchAll(create)) {
    const columns = ensure(match[1]);
    for (const column of match[2].matchAll(/^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s/gm)) {
      columns.add(column[1]);
    }
  }

  // ALTER TABLE "x" ADD COLUMN "col" type;
  const alter = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/g;
  for (const match of source.matchAll(alter)) {
    ensure(match[1]).add(match[2]);
  }

  // ALTER TABLE "x" RENAME COLUMN "old" TO "new";
  //
  // A rename is a change of name, not a change of the set: the column
  // that was called "old" is the one that is called "new".
  const rename = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s+RENAME COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+TO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/g;
  for (const match of source.matchAll(rename)) {
    const columns = ensure(match[1]);
    columns.delete(match[2]);
    columns.add(match[3]);
  }

  // ALTER TABLE "x" DROP COLUMN "col";
  const drop = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s+DROP COLUMN\s+(?:IF EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/g;
  for (const match of source.matchAll(drop)) {
    ensure(match[1]).delete(match[2]);
  }

  return result;
}

describe("the schema and the migrations", () => {
  it("declare the same enum values", () => {
    const schema = schemaEnums();
    const migrations = migrationEnums();

    expect(schema.size).toBeGreaterThan(0);

    for (const [name, values] of schema) {
      const fromMigrations = migrations.get(name);
      expect(
        fromMigrations,
        `the migrations never create the enum "${name}"`,
      ).toBeDefined();
      expect(
        [...values].sort(),
        `the enum "${name}" has different values in the schema and in the migrations`,
      ).toEqual([...fromMigrations!].sort());
    }
  });

  it("declare the same columns", () => {
    const schema = schemaColumns();
    const migrations = migrationColumns();

    expect(schema.size).toBeGreaterThan(0);

    for (const [name, columns] of schema) {
      const fromMigrations = migrations.get(name);
      expect(
        fromMigrations,
        `the migrations never create the table "${name}"`,
      ).toBeDefined();
      const missing = [...columns].filter((c) => !fromMigrations!.has(c));
      expect(
        missing,
        `the table "${name}" has columns the migrations never add`,
      ).toEqual([]);
    }
  });
});
