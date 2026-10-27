/**
 * Live test of the WeChat inbound→reply→send chain.
 *
 * Uses a stub iLink server so the whole shipped path runs unmodified:
 *   getUpdates (long-poll) → parse → commands/persona-bridge → LLM → sendMessage
 * Only the network peer is faked; every line of Mirrai's own code is real.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_VERSION } from "./live-config.mjs";

const ROOT = process.cwd();
const received = [];

/** Stub iLink backend. */
const stub = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf-8");
  const url = req.url || "";

  if (url.includes("getupdates")) {
    // First poll returns the inbound message; later polls return nothing.
    if (!stub.sent) {
      stub.sent = true;
      const msg = {
        seq: 1,
        message_id: "18446744073709551615", // uint64 — must survive parsing
        from_user_id: "wx-user-1",
        to_user_id: "bot-1",
        context_token: "ctx-abc",
        create_time_ms: Date.now(),
        message_type: 1,
        item_list: [{ type: 1, text_item: { text: "在吗？好久没见了" } }],
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ret: 0,
          msgs: [msg],
          get_updates_buf: "buf-1",
          longpolling_timeout_ms: 1000,
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "buf-1" }));
    return;
  }

  if (url.includes("sendmessage")) {
    const parsed = JSON.parse(body || "{}");
    received.push(parsed);
    console.log("  [stub] sendMessage ->", parsed?.msg?.to_user_id, JSON.stringify(parsed?.msg?.item_list));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ret: 0, message_id: "srv-1" }));
    return;
  }

  if (url.includes("notifystart") || url.includes("notifystop")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ret: 0 }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ret: 0 }));
});

await new Promise((r) => stub.listen(9911, "127.0.0.1", r));
console.log("stub iLink backend on http://127.0.0.1:9911\n");

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Set up a user, a ready persona, and a default binding for wx-user-1.
const username = "chatu" + Date.now().toString().slice(-6);
await fetch("http://localhost:3111/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password: "live-test-pass-123" }),
});
const lr = await fetch("http://localhost:3111/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password: "live-test-pass-123" }),
});
const cookie = (lr.headers.get("set-cookie") || "").split(";")[0];

const me = await client.query(`SELECT id FROM users WHERE username=$1`, [username]);
const userId = me.rows[0].id;

const pc = await client.query(
  `INSERT INTO personas ("userId", name, "analysisStatus", "personaData", "emotionalState")
   VALUES ($1, '小A', 'ready', $2, 'warm') RETURNING id`,
  [
    userId,
    JSON.stringify({
      personality: "温柔、有点黏人",
      speakingStyle: "短句，常用「嗯嗯」「在的」",
      catchphrases: ["嗯嗯", "在的"],
      nickname: "宝贝",
      memories: "我们一起看过海",
      attachmentStyle: "焦虑型",
      loveLanguage: "精心时刻",
      conflictStyle: "先沉默再道歉",
      touchingMoments: "记得我随口说过想看海",
      summary: "温柔但缺乏安全感的女孩",
    }),
  ],
);
const personaId = pc.rows[0].id;

await client.query(
  `INSERT INTO wechat_bindings ("personaId","userId","wechatUserId","wechatName","isActive")
   VALUES ($1,$2,'wx-user-1','我的微信',true)`,
  [personaId, userId],
);
console.log(`userId=${userId} personaId=${personaId}\n`);

// Point the server at the stub and hand it a token.
const { encryptSecret } = await import(
  path.join(ROOT, ".live-test/wechat/_core/crypto.js")
);
const tokenEnc = await encryptSecret("stub-token");

await client.query(
  `UPDATE wechat_bot_state SET status='logged_in', "botTokenEnc"=$1, "accountId"='bot-1',
     "wechatUserId"='wx-user-1', "baseUrl"='http://127.0.0.1:9911', "loggedInUser"='wx-user-1'
   WHERE "userId"=$2`,
  [tokenEnc, userId],
);
console.log("bot state seeded with stub token\n");

// Now drive the real inbound path: build the monitor against the stub.
const { getUpdates } = await import(
  path.join(ROOT, ".live-test/ilink/client.js")
);
const { parseInboundMessage } = await import(
  path.join(ROOT, ".live-test/ilink/parse.js")
);
const { handleWeixinMessage } = await import(
  path.join(ROOT, ".live-test/wechat/wechat/message-handler.js")
);

console.log("=== inbound: getUpdates (real client → stub server) ===");
const resp = await getUpdates({
  baseUrl: "http://127.0.0.1:9911",
  token: "stub-token",
  appId: "bot",
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
  get_updates_buf: "",
  timeoutMs: 5000,
});
console.log("ret:", resp.ret, "msgs:", resp.msgs?.length);
const raw = resp.msgs?.[0];
console.log("message_id (uint64 preserved):", raw?.message_id);

console.log("\n=== parse ===");
const parsed = parseInboundMessage(raw);
console.log("parsed:", JSON.stringify(parsed));

console.log("\n=== handle (real handler → real persona bridge → real LLM → sendMessage) ===");
await handleWeixinMessage(userId, parsed);

console.log("\n=== stub received sendMessage calls ===");
console.log("count:", received.length);
for (const r of received) {
  console.log("  to:", r?.msg?.to_user_id);
  console.log("  context_token:", r?.msg?.context_token);
  console.log("  text:", r?.msg?.item_list?.[0]?.text_item?.text);
}

console.log("\n=== DB state ===");
const msgs = await client.query(
  `SELECT role, content, "emotionalState", channel FROM messages WHERE "personaId"=$1 ORDER BY id`,
  [personaId],
);
for (const m of msgs.rows) {
  console.log(`  [${m.role}/${m.channel}/${m.emotionalState}] ${String(m.content).slice(0, 80)}`);
}
const p = await client.query(`SELECT "chatCount","emotionalState" FROM personas WHERE id=$1`, [personaId]);
console.log("persona:", JSON.stringify(p.rows[0]));

await client.end();
stub.close();
console.log("\n=== INBOUND CHAIN LIVE TEST DONE ===");
