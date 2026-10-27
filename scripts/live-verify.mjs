/**
 * The live verification.
 *
 * Everything goes through the same public surface a browser uses:
 * the sign-in form, the tRPC procedures, the chat stream.
 *
 * The model service it talks to is a local stub that speaks the
 * OpenAI protocol (scripts/live-stub-model.mjs) — so the app's own code
 * path runs unchanged, and the test does not need a paid provider.
 */
const BASE = process.env.MIRRAI_BASE || "http://localhost:3111";
let cookie = "";

function cookieHeader() {
  return cookie ? { cookie } : {};
}

async function trpc(path, input, opts = {}) {
  const url = `${BASE}/api/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...cookieHeader() },
    body: opts.method === "POST" ? JSON.stringify({ json: input ?? {} }) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text };
}

function ok(label, condition, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  const username = "live" + Date.now().toString().slice(-6);
  const password = "live-test-pass-123";

  console.log("=== 1. register ===");
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  ok("register", r.status === 200 || r.status === 201, `status ${r.status}`);
  const setCookie = r.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  console.log("\n=== 2. login ===");
  r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const loginCookie = r.headers.get("set-cookie");
  if (loginCookie) cookie = loginCookie.split(";")[0];
  ok("login", r.status === 200 && Boolean(cookie), `status ${r.status}`);

  console.log("\n=== 2b. a provider of their own ===");
  r = await trpc("llmConfig.upsert", {
    providerName: "openai",
    apiKey: "sk-stub-key",
    baseUrl: "http://127.0.0.1:3122/v1",
    model: "gpt-4o-mini",
  }, { method: "POST" });
  ok("llmConfig.upsert", r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);
  r = await trpc("llmConfig.setDefault", { providerName: "openai" }, { method: "POST" });
  ok("llmConfig.setDefault", r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);

  console.log("\n=== 3. persona.list ===");
  r = await trpc("persona.list");
  const personas = r.body?.result?.data?.json ?? [];
  ok("persona.list", r.status === 200 && Array.isArray(personas), `${personas.length} personas`);

  console.log("\n=== 4. safety.events ===");
  r = await trpc("safety.events", { personaId: personas[0]?.id ?? 0, limit: 10 });
  ok("safety.events", r.status === 200, `status ${r.status}`);

  console.log("\n=== 5. a persona to talk to ===");
  let personaId = personas[0]?.id;
  if (!personaId) {
    r = await trpc("persona.create", { name: "小A", relationshipDesc: "前任" }, { method: "POST" });
    personaId = r.body?.result?.data?.json?.id;
    ok("persona.create", Boolean(personaId), `id ${personaId}`);
    await trpc("persona.updatePersonaData", {
      id: personaId,
      personaData: {
        personality: "温柔、有点黏人，说话简短",
        speakingStyle: "短句，常用「嗯嗯」「好呀」",
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
    // The analysis is skipped: the persona is seeded by hand.
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL ?? "postgresql://ch1rpy@localhost:5432/mirrai_live",
    });
    await client.connect();
    await client.query(`UPDATE personas SET "analysisStatus" = 'ready' WHERE id = $1`, [personaId]);
    await client.end();
  }

  console.log("\n=== 6. chat.stream ===");
  const streamRes = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookieHeader() },
    body: JSON.stringify({ personaId, message: "在吗？" }),
  });
  const streamText = await streamRes.text();
  const hasDone = streamText.includes("event: done");
  const hasDelta = streamText.includes("event: delta");
  ok("chat.stream", streamRes.status === 200 && hasDone, `status ${streamRes.status}, done=${hasDone}, delta=${hasDelta}`);

  console.log("\n=== 7. letter.write ===");
  r = await trpc("letter.write", {
    personaId,
    body: "这是我在 app 里写下的一段话。",
    deliver: false,
    kind: "letter",
    locale: "zh",
  }, { method: "POST" });
  ok("letter.write", r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);

  console.log("\n=== 8. chat.export ===");
  r = await trpc("chat.export", { personaId, format: "markdown", locale: "zh" }, { method: "POST" });
  const exported = r.body?.result?.data?.json;
  const exportText = typeof exported === "string" ? exported : JSON.stringify(exported ?? "");
  ok(
    "chat.export",
    r.status === 200 && exportText.length > 0,
    `status ${r.status}, ${exportText.length} characters`,
  );

  console.log("\n=== 9. the relationship milestones ===");
  r = await trpc("relationship.add", {
    personaId,
    kind: "meetup",
    title: "第一次一起看海",
    detail: "那是夏天的傍晚",
    happenedAt: "2024-05-20",
  }, { method: "POST" });
  ok("relationship.add", r.status === 200, `status ${r.status} ${r.text.slice(0, 160)}`);
  r = await trpc("relationship.list", { personaId });
  const events = r.body?.result?.data?.json?.events ?? [];
  ok("relationship.list", r.status === 200, `${events.length} events`);

  console.log("\n=== 10. the export carries the milestones ===");
  r = await trpc("chat.export", { personaId, format: "markdown", locale: "zh" }, { method: "POST" });
  const exported2 = r.body?.result?.data?.json;
  const exportText2 = typeof exported2 === "string" ? exported2 : JSON.stringify(exported2 ?? "");
  ok("the export has the milestone", exportText2.includes("第一次一起看海"), "looked for 第一次一起看海");
  ok("the export is in Chinese", /[一-鿿]/.test(exportText2), "found Chinese characters");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
