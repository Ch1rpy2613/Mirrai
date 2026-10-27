import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * The database refuses the second copy of a collected message.
 *
 * The previous version of this test was a set of regular expressions
 * over the schema and the migration — so it said nothing about whether
 * the index is *there*, or whether it does what it says. The desktop
 * and the Windows builds create the schema with `drizzle-kit push`
 * rather than with the migration script, so an index the push does not
 * create would leave the duplicates being written — while the test
 * stayed green.
 *
 * So this one talks to a real database.
 *
 * It is skipped when there is no database to talk to. The CI has one
 * (the workflow's own service), and the live instance has one.
 */

const DATABASE_URL = process.env.DATABASE_URL;

const client = DATABASE_URL ? new Client({ connectionString: DATABASE_URL }) : null;

beforeAll(async () => {
  if (!client) return;
  await client.connect();
});

afterAll(async () => {
  if (!client) return;
  await client.end().catch(() => undefined);
});

describe.skipIf(!DATABASE_URL)("the collected messages table", () => {
  it("has the unique index that refuses a second copy", async () => {
    const result = await client!.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'collected_messages'
        AND indexname = 'collected_messages_idempotency_unique_idx'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toMatch(/UNIQUE/);
    // And it is partial: the rows collected before the column existed
    // have no key, and giving them one would mean guessing at which of
    // two identical messages came first.
    expect(result.rows[0].indexdef).toMatch(/WHERE/);
  });

  it("refuses the second copy of a message", async () => {
    const key = `test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const personaId = 999000001;
    const userId = 999000002;

    const insert = async () =>
      client!.query(
        `INSERT INTO "collected_messages" ("userId", "personaId", "source", "role", "content", "idempotencyKey")
         VALUES ($1, $2, 'feishu', 'assistant', '同一条消息', $3)`,
        [userId, personaId, key],
      );

    try {
      // The first one goes in.
      await insert();
      // The second one does not.
      await expect(insert()).rejects.toThrow();
    } finally {
      await client!.query(
        `DELETE FROM "collected_messages" WHERE "personaId" = $1 AND "idempotencyKey" = $2`,
        [personaId, key],
      );
    }
  });

  it("lets a row with no key in — twice", async () => {
    const personaId = 999000003;
    const userId = 999000004;

    try {
      // The rows collected before the column existed have no key, and
      // the index does not cover them.
      for (let index = 0; index < 2; index++) {
        await client!.query(
          `INSERT INTO "collected_messages" ("userId", "personaId", "source", "role", "content")
           VALUES ($1, $2, 'feishu', 'assistant', '没有键的消息')`,
          [userId, personaId],
        );
      }
    } finally {
      await client!.query(
        `DELETE FROM "collected_messages" WHERE "personaId" = $1`,
        [personaId],
      );
    }
  });
});
