import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The collected history is not allowed to hold the same message twice.
 *
 * The guarantee used to rest entirely on a read: the importer read the
 * keys that were already there, worked out which of the new ones were
 * new, and wrote the rest. Nothing in the database stopped two of
 * those from running at once — so two instances of the app both read
 * the same table, both worked out the same new messages, and both
 * wrote them.
 *
 * And the read was not even in a defined order — and the order is what
 * tells the first "嗯" from the second, so a re-collection could
 * number them differently from the first one and store them again.
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the database", () => {
  it("refuses the second copy of a message", () => {
    const db = read("server/db.ts");
    /**
     * The importer already checks which messages are new — but that
     * check is a read, and two of them running at once both read the
     * same table and both found the same messages new. So the database
     * refuses the second copy.
     */
    // The insert of the collected messages specifically.
    expect(db).toMatch(/tx\.insert\(collectedMessages\)\.values\(chunk\)\.onConflictDoNothing\(\)/);
  });

  it("reads the existing messages in the order they were written", () => {
    const db = read("server/db.ts");
    /**
     * The order was not specified — so the database was free to return
     * the rows in any order. And the order is what tells the first
     * "嗯" from the second: a message without a timestamp is keyed by
     * how many times that same text has been seen. So a re-collection
     * could number the "嗯"s differently from the first collection, the
     * keys would not match, and the messages would be stored a second
     * time.
     *
     * A chat log is mostly repeated messages, so this was not a rare
     * case.
     */
    expect(db).toMatch(/orderBy\(collectedMessages\.id\)/);
  });
});

describe("the schema", () => {
  it("has the key and the index that enforces it", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toMatch(/idempotencyKey: text\("idempotencyKey"\)/);
    expect(schema).toMatch(/collected_messages_idempotency_unique_idx/);
  });

  it("and the migration that creates them", () => {
    const migration = read("drizzle/0039_collected_messages_idempotency.sql");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "idempotencyKey" text/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "collected_messages_idempotency_unique_idx"/);
    // The index is partial: the rows collected before the column
    // existed have no key, and giving them one would mean guessing at
    // which of two identical messages came first.
    expect(migration).toMatch(/WHERE "idempotencyKey" IS NOT NULL/);
  });
});

describe("the importer", () => {
  it("stores the key with the message", () => {
    const store = read("server/collectors/db-store.ts");
    // The key is written with the row, so the database can refuse the
    // second copy of it.
    expect(store).toMatch(/idempotencyKey: hashKey\(key\)/);
  });
});
