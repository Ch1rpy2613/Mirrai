/**
 * Seeds the running Mirrai server with the real bot token from the QR scan,
 * so the server's own monitor loop takes over from here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const state = JSON.parse(
  readFileSync(path.join(ROOT, ".live-wechat-state.json"), "utf-8"),
);

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Encrypt with the same helper the server uses.
const { encryptSecret } = await import(
  path.join(ROOT, ".live-test/wechat/_core/crypto.js")
);
const tokenEnc = await encryptSecret(state.botToken);

// Use the most recent user created by the live E2E script.
const users = await client.query(`SELECT id FROM users ORDER BY id DESC LIMIT 1`);
const userId = users.rows[0].id;

const existing = await client.query(
  `SELECT id FROM wechat_bot_state WHERE "userId"=$1`,
  [userId],
);

if (existing.rows[0]) {
  await client.query(
    `UPDATE wechat_bot_state SET status='logged_in', "botTokenEnc"=$1, "accountId"=$2,
       "baseUrl"=$3, "wechatUserId"=$4, "loggedInUser"=$4, "updatedAt"=now()
     WHERE id=$5`,
    [tokenEnc, state.accountId, state.baseUrl, state.userId, existing.rows[0].id],
  );
} else {
  await client.query(
    `INSERT INTO wechat_bot_state ("userId", status, "botTokenEnc", "accountId", "baseUrl", "wechatUserId", "loggedInUser", "updatedAt")
     VALUES ($1, 'logged_in', $2, $3, $4, $5, $5, now())`,
    [userId, tokenEnc, state.accountId, state.baseUrl, state.userId],
  );
}

console.log("seeded userId:", userId);
console.log("  accountId:", state.accountId);
console.log("  wechatUserId:", state.userId);
console.log("  token encrypted with the server's key ✓");

// Bind the default persona for that WeChat account so replies route.
const personas = await client.query(
  `SELECT id, name FROM personas WHERE "userId"=$1 AND "analysisStatus"='ready' ORDER BY id LIMIT 1`,
  [userId],
);
if (personas.rows[0]) {
  const bound = await client.query(
    `SELECT id FROM wechat_bindings WHERE "userId"=$1 AND "wechatUserId"=$2`,
    [userId, state.userId],
  );
  if (bound.rows[0]) {
    await client.query(
      `UPDATE wechat_bindings SET "personaId"=$1, "isActive"=true WHERE id=$2`,
      [personas.rows[0].id, bound.rows[0].id],
    );
  } else {
    await client.query(
      `INSERT INTO wechat_bindings ("personaId","userId","wechatUserId","wechatName","isActive")
       VALUES ($1,$2,$3,$4,true)`,
      [personas.rows[0].id, userId, state.userId, "我的微信"],
    );
  }
  console.log(`  default persona: ${personas.rows[0].name} (id=${personas.rows[0].id})`);
}

await client.end();
