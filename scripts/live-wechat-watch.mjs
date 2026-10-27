/**
 * Persistent ClawBot login watcher.
 *
 * The iLink QR code has a short server-side lifetime (~90s observed), which is
 * shorter than a human scan round-trip. This process keeps a *fresh* QR
 * available at all times:
 *
 *   - issues a QR, renders it to live-wechat-qr.png, and starts polling
 *   - the moment the server reports "expired", a new QR is issued and the PNG
 *     is rewritten
 *   - polls until "confirmed", then stores the bot token
 *
 * The user can therefore open live-wechat-qr.png at any moment and scan
 * whatever code is current.
 *
 * Usage: node scripts/live-wechat-watch.mjs [durationSeconds]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { APP_VERSION, ILINK_BUILD_DIR, QR_PNG, QR_URL_FILE, STATE_FILE } from "./live-config.mjs";

/**
 * The paths come from the shared configuration.
 *
 * They were rebuilt here — so the `MIRRAI_LIVE_*` overrides did not
 * apply to this script: the QR image it wrote was not the one the other
 * scripts read, and the state file was not the one they used.
 */

const { startQrLogin, pollQrLogin } = await import(
  path.join(ILINK_BUILD_DIR, "login.js")
);
const { buildClientVersion } = await import(
  path.join(ILINK_BUILD_DIR, "client.js")
);

const API_BASE = process.env.WECHAT_ILINK_BASE_URL || "https://ilinkai.weixin.qq.com";
const APP_ID = process.env.WECHAT_ILINK_APP_ID || "bot";
const BOT_TYPE = process.env.WECHAT_BOT_TYPE || "3";


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

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function issueQr(state) {
  const result = await startQrLogin({
    baseUrl: API_BASE,
    botType: BOT_TYPE,
    localTokenList: state.botToken ? [state.botToken] : [],
    apiOptions: apiOptions(),
  });
  if (!result.ok || !result.qrcode) {
    console.log(`[${new Date().toISOString()}] issue failed: ${result.message}`);
    return false;
  }

  state.qrcode = result.qrcode;
  state.qrBaseUrl = result.baseUrl;
  state.qrIssuedAt = Date.now();
  state.qrImgContent = result.qrcodeImgContent;
  saveState(state);

  /**
   * The image is the one the backend sends.
   *
   * It used to be drawn here, with the `qrcode` package — a package that
   * is not a dependency of this project, so the watcher could not start
   * at all. And what it drew was whatever the backend had sent, which
   * is the image itself.
   */
  const image = await fetch(result.qrcodeImgContent);
  if (!image.ok) {
    console.log(`[${new Date().toISOString()}] could not fetch the QR image: ${image.status}`);
    return false;
  }
  writeFileSync(QR_PNG, Buffer.from(await image.arrayBuffer()));
  writeFileSync(QR_URL_FILE, result.qrcodeImgContent, "utf-8");

  console.log(`[${new Date().toISOString()}] new QR issued: ${result.qrcode}`);
  console.log(`  png: ${QR_PNG}`);
  console.log(`  url: ${result.qrcodeImgContent}`);
  return true;
}

const durationSec = Number(process.argv[2]) || 900;
const deadline = Date.now() + durationSec * 1000;
let lastStatus = null;

console.log("=== ClawBot login watcher started ===");
console.log(`QR PNG is refreshed automatically. Scan the CURRENT image: ${QR_PNG}`);
console.log(`Or open this URL in WeChat: ${QR_URL_FILE}`);

let state = loadState();
if (!state.qrcode) {
  await issueQr(state);
} else {
  console.log("reusing existing QR from state");
}

while (Date.now() < deadline) {
  state = loadState();
  if (!state.qrcode) {
    await issueQr(state);
    continue;
  }

  let result;
  try {
    result = await pollQrLogin({
      qrcode: state.qrcode,
      baseUrl: state.qrBaseUrl || API_BASE,
      verifyCode: state.verifyCode,
      apiOptions: apiOptions(state.botToken),
    });
  } catch (e) {
    console.log(`[${new Date().toISOString()}] poll error: ${String(e).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 1500));
    continue;
  }

  if (result.status !== lastStatus) {
    console.log(`[${new Date().toISOString()}] status=${result.status} — ${result.message}`);
    lastStatus = result.status;
  }

  if (result.redirectHost) {
    state.qrBaseUrl = `https://${result.redirectHost}`;
    saveState(state);
  }

  if (result.status === "confirmed") {
    if (result.botToken) {
      state.botToken = result.botToken;
      state.accountId = result.accountId;
      state.userId = result.userId;
      state.baseUrl = result.baseUrl;
      state.confirmedAt = Date.now();
      saveState(state);
      console.log("=== LOGIN CONFIRMED ===");
      console.log("accountId:", result.accountId);
      console.log("userId   :", result.userId);
      console.log("baseUrl  :", result.baseUrl);
      process.exit(0);
    }
    console.log("confirmed without token:", result.message);
  }

  if (result.status === "expired" || result.status === "verify_code_blocked") {
    console.log("  -> expired, issuing a fresh QR");
    delete state.qrcode;
    saveState(state);
    await issueQr(state);
    lastStatus = null;
    continue;
  }

  if (result.status === "binded_redirect") {
    console.log("=== ALREADY BOUND to this instance ===");
    process.exit(3);
  }

  await new Promise((r) => setTimeout(r, 400));
}

console.log("watcher timed out");
process.exit(4);
