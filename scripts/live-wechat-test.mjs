/**
 * Live end-to-end test of the WeChat ClawBot channel.
 *
 * Uses Mirrai's own iLink modules (not a re-implementation) so the test
 * exercises exactly the code that ships:
 *   - server/wechat/ilink/login.ts  → QR issue + status polling
 *   - server/wechat/ilink/client.ts → HTTP transport
 *   - server/wechat/ilink/send.ts   → outbound message
 *
 * Usage:
 *   node scripts/live-wechat-test.mjs qr      → issue a QR, print the URL
 *   node scripts/live-wechat-test.mjs poll    → poll a QR status
 *   node scripts/live-wechat-test.mjs updates → long-poll for messages
 *   node scripts/live-wechat-test.mjs send    → send a text message
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { APP_VERSION } from "./live-config.mjs";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, ".live-wechat-state.json");

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// Mirrai's ilink modules are bundled to .live-test/ilink by the prep step, so
// the test exercises the exact code that ships (same sources, compiled).
async function loadIlink() {
  const { startQrLogin, pollQrLogin } = await import(
    path.join(ROOT, ".live-test/ilink/login.js")
  );
  const client = await import(path.join(ROOT, ".live-test/ilink/client.js"));
  const send = await import(path.join(ROOT, ".live-test/ilink/send.js"));
  return { startQrLogin, pollQrLogin, client, send };
}

const API_BASE = process.env.WECHAT_ILINK_BASE_URL || "https://ilinkai.weixin.qq.com";
const APP_ID = process.env.WECHAT_ILINK_APP_ID || "bot";
const BOT_TYPE = process.env.WECHAT_BOT_TYPE || "3";


const { buildClientVersion } = await import(
  path.join(ROOT, ".live-test/ilink/client.js")
);

function apiOptions(token) {
  return {
    baseUrl: API_BASE,
    token,
    appId: APP_ID,
    clientVersion: buildClientVersion(APP_VERSION),
    channelVersion: APP_VERSION,
    botAgent: `Mirrai/${APP_VERSION}`,
  };
}

const command = process.argv[2];

if (command === "qr") {
  const { startQrLogin } = await loadIlink();
  const state = loadState();
  const result = await startQrLogin({
    baseUrl: API_BASE,
    botType: BOT_TYPE,
    localTokenList: state.botToken ? [state.botToken] : [],
    apiOptions: apiOptions(),
  });
  if (!result.ok || !result.qrcode) {
    console.error("FAILED:", result.message);
    process.exit(1);
  }
  state.qrcode = result.qrcode;
  state.qrBaseUrl = result.baseUrl;
  state.startedAt = Date.now();
  saveState(state);

  console.log("QR URL :", result.qrcodeImgContent);
  console.log("QRCODE :", result.qrcode);

  // Save the image so the user can scan it directly.
  //
  // It used to be drawn here, with the `qrcode` package — a package that
  // is not a dependency of this project, so the render always failed and
  // no image was ever written. And what it drew was whatever the
  // backend had sent, which is the image itself.
  try {
    const image = await fetch(result.qrcodeImgContent);
    if (!image.ok) throw new Error(`the image could not be fetched (${image.status})`);
    const out = path.join(ROOT, "live-wechat-qr.png");
    writeFileSync(out, Buffer.from(await image.arrayBuffer()));
    console.log("PNG    :", out);
  } catch (e) {
    console.log("PNG    : (not saved)", String(e.message).slice(0, 100));
  }
}

if (command === "poll") {
  const { pollQrLogin } = await loadIlink();
  const state = loadState();
  if (!state.qrcode) {
    console.error("no QR in state — run 'qr' first");
    process.exit(1);
  }
  const result = await pollQrLogin({
    qrcode: state.qrcode,
    baseUrl: state.qrBaseUrl || API_BASE,
    verifyCode: state.verifyCode,
    apiOptions: apiOptions(),
  });
  console.log("status      :", result.status);
  console.log("message     :", result.message);
  if (result.redirectHost) console.log("redirectHost:", result.redirectHost);
  if (result.botToken) {
    state.botToken = result.botToken;
    state.accountId = result.accountId;
    state.userId = result.userId;
    state.baseUrl = result.baseUrl;
    saveState(state);
    console.log("botToken    : <received, saved>");
    console.log("accountId   :", result.accountId);
    console.log("userId      :", result.userId);
  }
}

if (command === "watch") {
  const { pollQrLogin } = await loadIlink();
  const deadline = Date.now() + (Number(process.argv[3]) || 300) * 1000;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const state = loadState();
    if (!state.qrcode) {
      console.error("no QR in state — run 'qr' first");
      process.exit(1);
    }

    const result = await pollQrLogin({
      qrcode: state.qrcode,
      baseUrl: state.qrBaseUrl || API_BASE,
      verifyCode: state.verifyCode,
      apiOptions: apiOptions(state.botToken),
    });

    if (result.status !== lastStatus) {
      console.log(`[${new Date().toISOString()}] status=${result.status} — ${result.message}`);
      lastStatus = result.status;
    }

    if (result.redirectHost) {
      state.qrBaseUrl = `https://${result.redirectHost}`;
      saveState(state);
    }

    if (result.status === "need_verifycode") {
      console.log(">>> WAITING FOR VERIFY CODE — write it to .live-wechat-state.json as verifyCode");
      // Keep polling; the next poll carries the code once supplied.
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    if (result.status === "confirmed") {
      if (result.botToken) {
        state.botToken = result.botToken;
        state.accountId = result.accountId;
        state.userId = result.userId;
        state.baseUrl = result.baseUrl;
        saveState(state);
        console.log(">>> LOGIN CONFIRMED, bot_token received");
        console.log("accountId:", result.accountId);
        console.log("userId   :", result.userId);
        console.log("baseUrl  :", result.baseUrl);
      } else {
        console.log(">>> confirmed but no bot_token:", result.message);
      }
      process.exit(0);
    }

    if (result.status === "expired") {
      console.log(">>> QR EXPIRED — run 'qr' again");
      process.exit(2);
    }

    if (result.status === "binded_redirect") {
      console.log(">>> ALREADY BOUND to this instance");
      process.exit(3);
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(">>> watch timed out, last status:", lastStatus);
  process.exit(4);
}

if (command === "updates") {
  const { client } = await loadIlink();
  const state = loadState();
  if (!state.botToken) {
    console.error("no botToken in state — complete login first");
    process.exit(1);
  }
  console.log("long-polling for messages (30s window)...");
  const resp = await client.getUpdates({
    ...apiOptions(state.botToken),
    get_updates_buf: state.syncBuf || "",
    timeoutMs: 30000,
  });
  console.log("ret        :", resp.ret);
  console.log("errcode    :", resp.errcode, resp.errmsg ?? "");
  console.log("msgs       :", resp.msgs?.length ?? 0);
  if (resp.get_updates_buf) {
    state.syncBuf = resp.get_updates_buf;
    saveState(state);
  }
  for (const m of resp.msgs ?? []) {
    console.log("---");
    console.log("from        :", m.from_user_id);
    console.log("contextToken:", m.context_token ? "<present>" : "<none>");
    console.log("items       :", JSON.stringify(m.item_list));
  }
}

if (command === "send") {
  const { send } = await loadIlink();
  const state = loadState();
  if (!state.botToken) {
    console.error("no botToken in state");
    process.exit(1);
  }
  const text = process.argv[3] || "测试消息";
  const to = process.argv[4] || state.userId;
  const result = await send.sendTextMessage({
    to,
    text,
    contextToken: state.contextToken,
    opts: apiOptions(state.botToken),
  });
  console.log("sent:", JSON.stringify(result));
}
