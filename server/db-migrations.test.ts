import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle");

const MARKER = "mirrai: idempotent-migration";

/**
 * Extracts the `pgTable` declarations from the schema, counting braces so
 * the callback form (`pgTable("t", {...}, (table) => ({...}))`) parses too.
 */
function declaredTables(src: string): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const pattern = /export const (\w+) = pgTable\(\s*"([a-z_]+)",\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    while (i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = src.slice(match.index + match[0].length, i);
    out[match[2]] = new Set(Array.from(body.matchAll(/^\s{2}(\w+):\s/gm)).map((m) => m[1]));
  }
  return out;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function markedSql(): { name: string; sql: string }[] {
  return migrationFiles().map((name) => ({
    name,
    sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf-8"),
  }));
}

describe("the SQL migration set", () => {
  it("has files", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it("numbers every file so the order is deterministic", () => {
    for (const name of migrationFiles()) {
      const prefix = Number.parseInt(name, 10);
      expect(Number.isNaN(prefix)).toBe(false);
      expect(prefix).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks the hand-written migrations and leaves the snapshots unmarked", () => {
    for (const name of migrationFiles()) {
      const content = readFileSync(path.join(MIGRATIONS_DIR, name), "utf-8");
      const marked = content.includes(MARKER);

      if (Number.parseInt(name, 10) <= 1) {
        // 0000-0001 are Drizzle-generated full-schema snapshots. Replaying
        // them against an existing database would fail on existing tables,
        // so `scripts/migrate.mjs` must skip them.
        expect(marked, `${name} should not be marked`).toBe(false);
      } else {
        expect(marked, `${name} should be marked`).toBe(true);
      }
    }
  });

  it("applies the WeChat channel migration before the channel tables", () => {
    // 0005 copies `wechat_bindings"."wechatUserId"` into `channel_bindings`.
    // That column only exists after 0002 renamed it, so 0002 has to be
    // applied — skipping it breaks the upgrade path for an install that
    // predates the ClawBot channel.
    const wechat = readFileSync(
      path.join(MIGRATIONS_DIR, "0002_wechat_clawbot_channel.sql"),
      "utf-8",
    );
    expect(wechat).toContain(MARKER);

    const channels = readFileSync(
      path.join(MIGRATIONS_DIR, "0005_channels_and_reminders.sql"),
      "utf-8",
    );
    expect(channels).toContain('"wechatUserId"');
  });

  it("keeps the marked statements idempotent", () => {
    for (const { name, sql } of markedSql()) {
      if (!sql.includes(MARKER)) continue;

      // Every additive statement must be guarded, otherwise re-running the
      // file would fail.
      const unguarded = sql
        .split("\n")
        .filter((line) => /^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE .* ADD COLUMN)/.test(line))
        .filter((line) => !/IF NOT EXISTS/.test(line));

      expect(unguarded, `${name} has unguarded statements`).toEqual([]);
    }
  });

  it("does not remove enum values, which PostgreSQL cannot do", () => {
    for (const { name, sql } of markedSql()) {
      expect(sql, `${name} tries to drop an enum value`).not.toMatch(
        /ALTER TYPE[^;]*DROP VALUE/i,
      );
    }
  });
});

describe("schema.ts and the migrations agree", () => {
  const schema = readFileSync(path.join(MIGRATIONS_DIR, "schema.ts"), "utf-8");
  const declared = declaredTables(schema);

  it("declares every table the migrations create", () => {
    // A table that exists only in the SQL would be dropped by
    // `drizzle-kit push`, which is what the desktop builds run on every
    // start — taking the data with it.
    const created = new Set<string>();
    for (const { sql } of markedSql()) {
      for (const match of Array.from(sql.matchAll(/CREATE TABLE IF NOT EXISTS "([a-z_]+)"/g))) {
        created.add(match[1]);
      }
    }

    const missing = Array.from(created).filter((t) => !declared[t]).sort();
    expect(missing, "these tables are missing from drizzle/schema.ts").toEqual([]);
  });

  it("declares every column the migrations add", () => {
    const added: Array<[string, string]> = [];
    for (const { sql } of markedSql()) {
      for (const match of Array.from(sql.matchAll(
        /ALTER TABLE "([a-z_]+)" ADD COLUMN IF NOT EXISTS "([a-zA-Z]+)"/g,
      ))) {
        added.push([match[1], match[2]]);
      }
    }

    const missing = added
      .filter(([table, column]) => declared[table] && !declared[table].has(column))
      .map(([table, column]) => `${table}.${column}`)
      .sort();
    expect(missing, "these columns are missing from drizzle/schema.ts").toEqual([]);
  });

  it("declares every enum value the migrations add", () => {
    const schemaEnums: Record<string, Set<string>> = {};
    for (const match of Array.from(schema.matchAll(
      /export const \w+ = pgEnum\("([a-z_]+)",\s*\[([\s\S]*?)\]\);/g,
    ))) {
      schemaEnums[match[1]] = new Set(
        Array.from(match[2].matchAll(/"([a-z_]+)"/g)).map((m) => m[1]),
      );
    }

    const sqlEnums: Record<string, Set<string>> = {};
    for (const { sql } of markedSql()) {
      for (const match of Array.from(sql.matchAll(
        /ALTER TYPE "([a-z_]+)" ADD VALUE '([a-z_]+)'/g,
      ))) {
        if (!sqlEnums[match[1]]) sqlEnums[match[1]] = new Set();
        sqlEnums[match[1]].add(match[2]);
      }
    }

    const gaps: string[] = [];
    for (const [name, values] of Object.entries(sqlEnums)) {
      for (const value of Array.from(values)) {
        if (!schemaEnums[name]?.has(value)) {
          gaps.push(`${name}.${value}`);
        }
      }
    }
    expect(gaps, "these enum values are missing from drizzle/schema.ts").toEqual([]);
  });

  it("declares the research stage the pipeline writes", () => {
    // The pipeline writes these through a cast; the database still rejects a
    // value the enum does not carry.
    for (const stage of ["researching", "auditing", "synthesizing", "validating"]) {
      expect(declared["skill_jobs"], "skill_jobs must exist").toBeDefined();
      expect(schema).toContain(`"${stage}"`);
    }
  });

  it("declares the research_profiles table the celebrity flow writes", () => {
    expect(declared["research_profiles"], "research_profiles must exist").toBeDefined();
    expect(declared["research_profiles"].has("notes")).toBe(true);
    expect(declared["research_profiles"].has("qualityReport")).toBe(true);
  });
});
