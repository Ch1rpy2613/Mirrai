import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

/**
 * Two promises that were kept by a read.
 *
 * A read is a read: two writes at once both see the same state and both
 * decide to go ahead. So these are checked against a real database —
 * a test that greps the schema cannot tell whether the index is there.
 *
 * It is skipped when there is no database to talk to. The CI has one
 * (the workflow's own service), and so does the live instance.
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

describe.skipIf(!DATABASE_URL)("the WeChat bot state", () => {
  it("has one row per user", async () => {
    const result = await client!.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'wechat_bot_state'
        AND indexname = 'wechat_bot_state_user_unique_idx'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toMatch(/UNIQUE/);
  });

  it("refuses a second row for the same user", async () => {
    const userId = 999100001;
    try {
      await client!.query(
        `INSERT INTO "wechat_bot_state" ("userId", "status") VALUES ($1, 'stopped')`,
        [userId],
      );
      await expect(
        client!.query(
          `INSERT INTO "wechat_bot_state" ("userId", "status") VALUES ($1, 'stopped')`,
          [userId],
        ),
      ).rejects.toThrow();
    } finally {
      await client!.query(`DELETE FROM "wechat_bot_state" WHERE "userId" = $1`, [userId]);
    }
  });
});

describe.skipIf(!DATABASE_URL)("the outbound letters", () => {
  it("will not offer the same sentence twice", async () => {
    const result = await client!.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'outbound_letters'
        AND indexname = 'outbound_letters_source_unique_idx'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexdef).toMatch(/UNIQUE/);
    // And it is partial: a letter the user wrote themselves has no
    // source message, and two of those are two different letters.
    expect(result.rows[0].indexdef).toMatch(/WHERE/);
  });

  it("refuses the second copy of a sentence", async () => {
    const userId = 999100002;
    const personaId = 999100003;
    const messageId = 999100004;
    try {
      await client!.query(
        `INSERT INTO "outbound_letters" ("userId", "personaId", "text", "sourceMessageId", "status")
         VALUES ($1, $2, '同一句话', $3, 'ready')`,
        [userId, personaId, messageId],
      );
      await expect(
        client!.query(
          `INSERT INTO "outbound_letters" ("userId", "personaId", "text", "sourceMessageId", "status")
           VALUES ($1, $2, '同一句话', $3, 'ready')`,
          [userId, personaId, messageId],
        ),
      ).rejects.toThrow();
    } finally {
      await client!.query(`DELETE FROM "outbound_letters" WHERE "userId" = $1`, [userId]);
    }
  });

  it("lets two letters the user wrote themselves through", async () => {
    const userId = 999100005;
    const personaId = 999100006;
    try {
      for (let index = 0; index < 2; index++) {
        await client!.query(
          `INSERT INTO "outbound_letters" ("userId", "personaId", "text", "status")
           VALUES ($1, $2, '自己写的信', 'draft')`,
          [userId, personaId],
        );
      }
    } finally {
      await client!.query(`DELETE FROM "outbound_letters" WHERE "userId" = $1`, [userId]);
    }
  });
});
