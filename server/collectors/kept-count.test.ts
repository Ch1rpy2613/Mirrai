import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The kept count is actually kept.
 *
 * The column was created, read, and shown — and never written. The
 * row is INSERTed once, when the job is queued, at which point the
 * count is still zero; every later snapshot takes the `ON CONFLICT DO
 * UPDATE` branch, whose SET list is what is written — and the kept
 * count was not in it.
 *
 * And a job is read from the database as soon as it falls out of the
 * process's memory — which happens after two hundred jobs, and on every
 * restart of the app. So the user saw "found 400, kept 0": the exact
 * self-contradicting sentence the column was added to remove.
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the persisted job", () => {
  it("has the kept count written on every snapshot", () => {
    const db = read("server/db.ts");
    const upsert = db.slice(db.indexOf("export async function upsertCollectionJob"));
    const set = upsert.slice(0, upsert.indexOf("setWhere"));
    // The sibling column is in the list — so the omission was an
    // omission, not a decision.
    expect(set).toMatch(/foundCount: data\.foundCount/);
    expect(set).toMatch(/keptCount: data\.keptCount/);
  });

  it("has a column that can say 'I do not know'", () => {
    const schema = read("drizzle/schema.ts");
    /**
     * A row collected before the column existed has no kept count —
     * and that is not the same as having kept zero.
     *
     * `NOT NULL DEFAULT 0` turns "we do not know" into a number the
     * user reads: the reader fell back to the message count, but the
     * fallback could never fire, so the panel said "kept 0".
     */
    expect(schema).toMatch(/keptCount: integer\("keptCount"\)/);
    expect(schema).not.toMatch(/keptCount: integer\("keptCount"\)\.default\(0\)\.notNull\(\)/);
  });

  it("has a migration that fills in the rows that were already there", () => {
    const migration = read("drizzle/0040_collection_jobs_kept_count.sql");
    const at = migration.indexOf("-- mirrai: down");
    const up = at === -1 ? migration : migration.slice(0, at);
    // They were collected before the two counts were apart, so the
    // message count is what they kept.
    expect(up).toMatch(/UPDATE\s+"collection_jobs"\s+SET\s+"keptCount"\s*=\s*"messageCount"/);
    // And the column is added nullable, so the backfill can match.
    expect(up).not.toMatch(/ADD COLUMN IF NOT EXISTS "keptCount" integer DEFAULT 0 NOT NULL/);
  });
});

describe("the note about a cut-short collection", () => {
  it("says nothing when there is nothing to say", () => {
    const settings = read("client/src/pages/Settings.tsx");
    /**
     * A collector that found no messages at all and said it was
     * truncated would otherwise produce "only part of it was taken: up
     * to 0 — there may be more" — a sentence its own number
     * contradicts.
     */
    expect(settings).toMatch(/job\.truncated && \(job\.keptCount \?\? job\.messageCount\) > 0/);
  });
});
