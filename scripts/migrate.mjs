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
 * A migration can carry the way back: a `-- mirrai: down` section after
 * its up statements. `node scripts/migrate.mjs --rollback [n]` runs the
 * down sections of the last n applied migrations, newest first, and
 * forgets them in the journal.
 *
 * A migration without a down section cannot be rolled back, and the
 * script says so rather than half undoing a chain — a rollback that
 * stops halfway is worse than one that refuses to start.
 *
 * `--replay` re-runs the up half of every migration, whether the
 * journal says it has been applied or not. It is how the claim that the
 * migrations are idempotent is checked: running the script twice is
 * not a test of that at all, because the second run reads the journal,
 * sees the work is done, and does nothing. The claim is about the SQL,
 * so the SQL is what runs again.
 *
 * Usage: node scripts/migrate.mjs [--dry-run] [--rollback [n]] [--replay]
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
const DOWN_MARKER = "-- mirrai: down";

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

  const files = entries
    // Only the files. The `generated` folder — where drizzle-kit writes
    // what it generates — is a folder, and its contents are proposals,
    // not migrations.
    .filter((name) => name.endsWith(".sql"))
    // The order the migrations are applied in.
    //
    // The old comparator fell back to a string comparison for one
    // direction and a numeric difference for the other, which is not a
    // consistent ordering — the sort result was not guaranteed, and a
    // later schema change could be applied before an earlier one. Every
    // file is named with its number, so the number is the order.
    .sort((a, b) => {
      const numA = Number.parseInt(a, 10);
      const numB = Number.parseInt(b, 10);
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });

  // A file without a number is refused, not guessed at.
  //
  // The comparator used to fall back to a string comparison for one of
  // them, so a file called `zzz_non_numeric.sql` was applied — after
  // the numbered ones, in an order nobody chose. The comment beside
  // the comparator promised the opposite, and the promise was the
  // point: a migration whose order cannot be read is a migration whose
  // order cannot be trusted.
  for (const name of files) {
    if (Number.isNaN(Number.parseInt(name, 10))) {
      throw new Error(
        `The migration file "${name}" does not start with a number. ` +
          "Every migration is applied in the order of its number.",
      );
    }
  }

  return files
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
      const down = sql.includes(DOWN_MARKER)
        ? sql.slice(sql.indexOf(DOWN_MARKER) + DOWN_MARKER.length)
        : null;
      // The up half is everything before the down section. Running the
      // whole file would undo the migration the moment it was applied.
      const up = down === null ? sql : sql.slice(0, sql.indexOf(DOWN_MARKER));
      return { name, sql: up, down, version: name.replace(/\.sql$/, "") };
    });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const replay = process.argv.includes("--replay");
  const rollbackIndex = process.argv.indexOf("--rollback");
  const rollbackCount =
    rollbackIndex === -1
      ? 0
      : Number(process.argv[rollbackIndex + 1] ?? 1);

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

    if (rollbackIndex !== -1) {
      if (!Number.isInteger(rollbackCount) || rollbackCount < 1) {
        throw new Error("--rollback takes how many migrations to undo (a whole number).");
      }
      // The order the files are listed in is the order they were applied
      // in, so the last ones are the newest.
      const undoable = applicable.filter((f) => applied.has(f.version));
      const targets = undoable.slice(-rollbackCount);
      if (targets.length < rollbackCount) {
        throw new Error(
          `only ${targets.length} migration(s) have been applied; cannot undo ${rollbackCount}.`,
        );
      }
      const missing = targets.filter((f) => !f.down);
      if (missing.length) {
        throw new Error(
          `these migrations carry no way back: ${missing.map((f) => f.name).join(", ")}. ` +
            "A rollback that stops halfway is worse than one that refuses to start.",
        );
      }
      for (const file of targets.reverse()) {
        if (dryRun) {
          log(`would roll back ${file.name}`);
          continue;
        }
        log(`rolling back ${file.name}`);
        try {
          await client.query("BEGIN");
          await client.query(file.down);
          await client.query('DELETE FROM "schema_migrations" WHERE "version" = $1', [
            file.version,
          ]);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw new Error(`Rollback of ${file.name} failed: ${e.message}`);
        }
      }
      if (dryRun) log("dry run complete — nothing was written");
      else log(`rolled back ${targets.length} migration(s)`);
      return;
    }

    for (const file of applicable) {
      if (!replay && applied.has(file.version)) {
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
    else if (replay) log(`replayed ${applicable.length} migration(s) — all of them ran again`);
    else log("all migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[migrate] failed:", e.message);
  process.exitCode = 1;
});
