/**
 * Drives the real Mirrai server over HTTP for the live end-to-end test.
 *
 * Everything here goes through the same public surface a browser uses:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/trpc/<procedure>
 */
const BASE = "http://localhost:3111";

let cookie = "";

function cookieHeader() {
  return cookie ? { cookie } : {};
}

/** tRPC v11 over HTTP with superjson. */
async function trpc(path, input, opts = {}) {
  const url = `${BASE}/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...cookieHeader(),
    },
    body: opts.method === "POST" ? JSON.stringify({ json: input ?? {} }) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function main() {
  const username = "liveuser" + Date.now().toString().slice(-6);

  console.log("=== 1. register ===");
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "live-test-pass-123" }),
  });
  console.log("status:", r.status, await r.text());
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  console.log("\n=== 2. login ===");
  r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "live-test-pass-123" }),
  });
  const loginCookie = r.headers.get("set-cookie");
  if (loginCookie) cookie = loginCookie.split(";")[0];
  console.log("status:", r.status, "cookie set:", Boolean(cookie));

  console.log("\n=== 3. me ===");
  r = await trpc("auth.me");
  console.log("status:", r.status, JSON.stringify(r.body).slice(0, 200));

  console.log("\n=== 4. create persona ===");
  r = await trpc("persona.create", { name: "小A", relationshipDesc: "前任" }, { method: "POST" });
  console.log("status:", r.status, JSON.stringify(r.body).slice(0, 200));
  const personaId = r.body?.result?.data?.json?.id;

  console.log("\n=== 5. seed persona so the LLM can answer ===");
  r = await trpc("persona.updatePersonaData", {
    id: personaId,
    personaData: {
      personality: "温柔、有点黏人，说话简短",
      speakingStyle: "短句，常用「嗯嗯」「好呀」，语气轻快",
      catchphrases: ["嗯嗯", "好呀", "在的"],
      nickname: "宝贝",
      memories: "我们一起看过海，那是夏天的傍晚",
      attachmentStyle: "焦虑型",
      loveLanguage: "精心时刻",
      conflictStyle: "会先沉默一会儿，然后主动道歉",
      touchingMoments: "记得我随口说过想去看海",
      summary: "一个温柔但有点缺乏安全感的女孩",
    },
  }, { method: "POST" });
  console.log("status:", r.status, JSON.stringify(r.body).slice(0, 160));

  console.log("\n=== 6. mark persona ready (skip distillation) ===");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    `UPDATE personas SET "analysisStatus" = 'ready' WHERE id = $1`,
    [personaId],
  );
  const p = await client.query(`SELECT id, name, "analysisStatus" FROM personas WHERE id = $1`, [personaId]);
  console.log("persona row:", JSON.stringify(p.rows[0]));

  console.log("\n=== 7. wechat.startLogin (real tRPC → real iLink) ===");
  r = await trpc("wechat.startLogin", undefined, { method: "POST" });
  console.log("status:", r.status);
  const statusBody = r.body?.result?.data?.json;
  console.log("bot status:", statusBody?.status, "| has QR:", Boolean(statusBody?.qrCodeUrl));

  const st = await client.query(`SELECT status, "qrCodeUrl" IS NOT NULL AS has_qr FROM wechat_bot_state`);
  console.log("wechat_bot_state row:", JSON.stringify(st.rows[0]));

  console.log("\n=== 8. chat.send through the persona bridge (real LLM) ===");
  r = await trpc("chat.send", { personaId, message: "在吗？好久没见了" }, { method: "POST" });
  console.log("status:", r.status);
  const chatBody = r.body?.result?.data?.json;
  console.log("reply :", JSON.stringify(chatBody?.reply));
  console.log("emotion:", chatBody?.emotionalState);

  const msgs = await client.query(
    `SELECT role, content, "emotionalState", channel FROM messages WHERE "personaId" = $1 ORDER BY id`,
    [personaId],
  );
  console.log("persisted messages:");
  for (const m of msgs.rows) {
    console.log(`  [${m.role}/${m.channel}/${m.emotionalState}] ${String(m.content).slice(0, 90)}`);
  }

  const per = await client.query(`SELECT "chatCount", "emotionalState" FROM personas WHERE id = $1`, [personaId]);
  console.log("persona state:", JSON.stringify(per.rows[0]));

  await client.end();
  console.log("\n=== LIVE E2E DONE ===");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
