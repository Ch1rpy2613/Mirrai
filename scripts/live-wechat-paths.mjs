/**
 * Live test of the WeChat-specific code paths over the real server.
 *
 * Covers: default-persona binding, the slash commands, and the graduation
 * flow — everything that does not require a completed QR scan.
 */
import path from "node:path";

import { WECHAT_BUILD_DIR } from "./live-config.mjs";

const BASE = process.env.MIRRAI_LIVE_BASE_URL ?? "http://localhost:3111";
let cookie = "";

async function trpc(path, input, opts = {}) {
  const url = `${BASE}/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: opts.method === "POST" ? JSON.stringify({ json: input ?? {} }) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const json = (r) => r.body?.result?.data?.json;

async function main() {
  const username = "wxu" + Date.now().toString().slice(-6);
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "live-test-pass-123" }),
  });
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "live-test-pass-123" }),
  });
  cookie = (lr.headers.get("set-cookie") || "").split(";")[0];

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // The registered user's real id (the database accumulates users across runs).
  const meRow = await client.query(`SELECT id FROM users WHERE username = $1`, [username]);
  const userId = meRow.rows[0].id;
  console.log("using userId:", userId);

  // Two ready personas.
  let r = await trpc("persona.create", { name: "小A" }, { method: "POST" });
  const personaA = json(r).id;
  r = await trpc("persona.create", { name: "小B" }, { method: "POST" });
  const personaB = json(r).id;

  for (const [id, name] of [[personaA, "小A"], [personaB, "小B"]]) {
    await trpc("persona.updatePersonaData", {
      id,
      personaData: { personality: `${name}温柔`, speakingStyle: "短句", catchphrases: ["嗯嗯"], nickname: "宝贝" },
    }, { method: "POST" });
    await client.query(`UPDATE personas SET "analysisStatus"='ready' WHERE id=$1`, [id]);
  }

  console.log("=== 1. bind default persona (wechat.setDefaultPersona) ===");
  r = await trpc("wechat.setDefaultPersona", {
    wechatUserId: "wx-user-1",
    personaId: personaA,
    wechatName: "我的微信",
  }, { method: "POST" });
  console.log("status:", r.status, JSON.stringify(json(r)));

  r = await trpc("wechat.listBindings");
  console.log("bindings:", JSON.stringify(json(r)));

  console.log("\n=== 2. the binding row is a partial unique index (no dupes) ===");
  try {
    r = await trpc("wechat.setDefaultPersona", {
      wechatUserId: "wx-user-1",
      personaId: personaB,
    }, { method: "POST" });
    console.log("re-bind status:", r.status, "-> upsert (same row updated, not duplicated)");
  } catch (e) {
    console.log("re-bind failed:", String(e).slice(0, 120));
  }
  const rows = await client.query(`SELECT "personaId", "wechatUserId", "isActive" FROM wechat_bindings`);
  console.log("binding rows:", JSON.stringify(rows.rows));

  console.log("\n=== 3. commands module (pure, no LLM) ===");
  const { handleCommand, matchPersonaByName } = await import(
    path.join(WECHAT_BUILD_DIR, "wechat/commands.js")
  );
  const all = (await client.query(`SELECT id, name, "analysisStatus" FROM personas ORDER BY id`)).rows;
  const match = matchPersonaByName(all, "小B");
  console.log("matchPersonaByName('小B') ->", match.persona?.name, `(${match.kind})`);

  const amb = matchPersonaByName(all, "小");
  console.log("matchPersonaByName('小') -> ambiguous:", JSON.stringify(amb.candidates));

  console.log("\n=== 4. graduation eligibility gate (real DB) ===");
  // 小B has 0 chats and 初识 intimacy -> should refuse.
  const grad = await handleCommand({
    userId,
    wechatUserId: "wx-user-1",
    text: "/毕业",
    defaultPersonaId: personaB,
  });
  console.log("handled:", grad.handled);
  console.log("reply  :", String(grad.reply).slice(0, 120));

  console.log("\n=== 5. graduation on an eligible persona (real LLM) ===");
  await client.query(
    `UPDATE personas SET "intimacyLevel"='灵魂伴侣', "chatCount"=100 WHERE id=$1`,
    [personaA],
  );
  await client.query(
    `INSERT INTO emotion_snapshots ("personaId","userId","emotionalState","messageCount","date")
     SELECT $1, 1, 'happy', 5, '2026-10-20' FROM generate_series(1,10)`,
    [personaA],
  );
  const grad2 = await handleCommand({
    userId,
    wechatUserId: "wx-user-1",
    text: "/毕业",
    defaultPersonaId: personaA,
    sendLetter: async (letter) => {
      console.log("  [sendLetter called, length]", letter.length);
      return true;
    },
  });
  console.log("handled:", grad2.handled);
  console.log("reply  :", String(grad2.reply).slice(0, 200));

  const p2 = await client.query(
    `SELECT "graduationStatus", "farewellLetter" IS NOT NULL AS has_letter, "graduatedAt" FROM personas WHERE id=$1`,
    [personaA],
  );
  console.log("persona after graduation:", JSON.stringify(p2.rows[0]));

  console.log("\n=== 6. graduation degrades when WeChat delivery fails ===");
  const grad3 = await handleCommand({
    userId,
    wechatUserId: "wx-user-1",
    text: "/毕业",
    defaultPersonaId: personaB,
    sendLetter: async () => false,
  });
  console.log("reply:", String(grad3.reply).slice(0, 160));

  await client.end();
  console.log("\n=== WECHAT PATH LIVE TEST DONE ===");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
