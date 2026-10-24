#!/usr/bin/env node
/**
 * Applies the hand-written SQL migrations in `drizzle/`.
 *
 * The project does not use `drizzle-kit migrate`: `drizzle/meta/` is
 * gitignored, so there is no journal for it to read on a fresh clone. The
 * model that works is:
 *
 *   - a fresh install builds the whole schema in one go with
 *     `drizzle-kit push` (see `pnpm db:push`);
 *   - an existing install applies the incremental SQL files in this folder.
 *
 * Only files carrying the `mirrai: idempotent-migration` marker are applied.
 * The earlier `drizzle-kit generate` snapshots (0000, 0001) are full-schema
 * dumps and are skipped — replaying them against an existing database would
 * fail on already-existing tables. The script reports what it skipped.
 *
 * Each file runs in its own transaction and is recorded in
 * `schema_migrations`, so re-running the script is a no-op.
 *
 * Usage: node scripts/migrate.mjs [--dry-run]
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MIGRATIONS_DIR = join(ROOT, "drizzle");

const MARKER = "mirrai: idempotent-migration";

function log(...args) {
  console.log("[migrate]", ...args);
}

function loadMigrationFiles() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (e) {
    throw new Error(`Cannot read migrations directory ${MIGRATIONS_DIR}: ${e.message}`);
  }

  return entries
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => {
      const numA = Number.parseInt(a, 10);
      const numB = Number.parseInt(b, 10);
      if (Number.isNaN(numA) || Number.isNaN(numB)) return a.localeCompare(b);
      return numA - numB;
    })
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
      return { name, sql, version: name.replace(/\.sql$/, "") };
    });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Set it in .env or pass it in the environment.");
  }

  const files = loadMigrationFiles();
  const applicable = files.filter((f) => f.sql.includes(MARKER));
  const skipped = files.filter((f) => !f.sql.includes(MARKER));

  if (skipped.length > 0) {
    log(
      `skipping ${skipped.length} file(s) without the "${MARKER}" marker: ${skipped.map((f) => f.name).join(", ")}`,
    );
    log("  (those are full-schema snapshots; a fresh install uses `pnpm db:push` instead)");
  }

  if (applicable.length === 0) {
    log("no migrations to apply");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" varchar(64) PRIMARY KEY NOT NULL,
        "appliedAt" timestamp DEFAULT now() NOT NULL
      )
    `);

    const { rows } = await client.query('SELECT "version" FROM "schema_migrations"');
    const applied = new Set(rows.map((r) => r.version));

    for (const file of applicable) {
      if (applied.has(file.version)) {
        log(`skip ${file.name} (already applied)`);
        continue;
      }

      if (dryRun) {
        log(`would apply ${file.name}`);
        continue;
      }

      log(`applying ${file.name}`);
      try {
        await client.query("BEGIN");
        await client.query(file.sql);
        await client.query(
          'INSERT INTO "schema_migrations" ("version") VALUES ($1) ON CONFLICT DO NOTHING',
          [file.version],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${file.name} failed: ${e.message}`);
      }
    }

    if (dryRun) log("dry run complete — nothing was written");
    else log("all migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[migrate] failed:", e.message);
  process.exitCode = 1;
});
