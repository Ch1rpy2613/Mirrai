import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The two counts of a collection.
 *
 * The count is how many rows were *new* — the import is idempotent,
 * so collecting a history the user already imported writes nothing.
 * The collection still held every message it found.
 *
 * So when the two differ, the user is told both. Otherwise "0" reads
 * as "the collection found nothing", which is a different thing from
 * "nothing was added" — and the audit that found this called it "a
 * sentence that contradicts itself in a new way, right next to a
 * message count of zero".
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the job list", () => {
  it("shows both numbers when they differ", () => {
    const settings = read("client/src/pages/Settings.tsx");
    // The list.
    expect(settings).toMatch(/messageCountHeld/);
    // And the detail panel.
    expect(settings).toMatch(/messagesHeldLabel/);
  });
});

describe("the dictionaries", () => {
  it("have both numbers, in both languages", () => {
    for (const file of ["client/src/i18n/zh.ts", "client/src/i18n/en.ts"]) {
      const source = read(file);
      expect(source, file).toMatch(/messageCountHeld:/);
      expect(source, file).toMatch(/messagesHeldLabel:/);
    }
  });
});

describe("the numbers the server sends", () => {
  it("carry both of them", () => {
    const routers = read("server/routers.ts");
    /**
     * The job list, the job detail, and the persisted row.
     *
     * A job read from the database after a restart has to carry the
     * kept count too — otherwise the panel says the collection held
     * nothing, when it held everything.
     */
    const kept = [...routers.matchAll(/keptCount:/g)];
    expect(kept.length).toBeGreaterThanOrEqual(2);
  });

  it("and the persisted row keeps it", () => {
    const store = read("server/collectors/db-store.ts");
    expect(store).toMatch(/keptCount: job\.keptCount \?\? job\.messageCount/);
  });

  it("and the schema has a column for it", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toMatch(/keptCount: integer\("keptCount"\)/);
    const migration = read("drizzle/0040_collection_jobs_kept_count.sql");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "keptCount"/);
  });
});
