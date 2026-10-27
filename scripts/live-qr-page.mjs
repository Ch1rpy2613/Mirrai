/**
 * Live ClawBot QR page.
 *
 * The WeChat authorization code expires in roughly 90 seconds, which is shorter
 * than a chat round-trip. This serves a local page that mints a *fresh* code
 * on every view and refreshes it on a timer, so the code on screen is always
 * seconds old rather than minutes old.
 *
 * The page also drives the status poll: as soon as the QR is confirmed the
 * bot token is written to .live-wechat-state.json for the inbound tests.
 *
 * Usage: node scripts/live-qr-page.mjs [port]
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * The paths and the port come from the shared configuration.
 *
 * They were rebuilt here — so the `MIRRAI_LIVE_*` overrides did not
 * apply to this script: the page served on a port of its own and wrote
 * the token into a state file the other scripts were not reading.
 *
 * The port on the command line still wins, so the page can be started
 * twice.
 */
import {
  APP_VERSION,
  ILINK_BASE_URL,
  ILINK_APP_ID,
  ILINK_BOT_TYPE,
  ILINK_BUILD_DIR,
  QR_PAGE_PORT,
  STATE_FILE,
} from "./live-config.mjs";

const PORT = Number(process.argv[2]) || QR_PAGE_PORT;

const API_BASE = ILINK_BASE_URL;
const APP_ID = ILINK_APP_ID;
const BOT_TYPE = ILINK_BOT_TYPE;

/**
 * The QR image is the one the backend sends.
 *
 * The page used to draw its own, with the `qrcode` package — a package
 * that is not a dependency of this project, so the script could not
 * start at all. And the image it drew was of whatever the backend had
 * sent, which is the image itself.
 */
const { startQrLogin, pollQrLogin } = await import(
  path.join(ILINK_BUILD_DIR, "login.js")
);
const { buildClientVersion } = await import(
  path.join(ILINK_BUILD_DIR, "client.js")
);

const apiOptions = (token) => ({
  baseUrl: API_BASE,
  token,
  appId: APP_ID,
  clientVersion: buildClientVersion(APP_VERSION),
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
});

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return {}; }
}
function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf-8");
}

/** The single QR currently on display. */
let current = null;
/** Guards against two concurrent issues. */
let issuing = null;

async function issueFresh() {
  if (current && Date.now() - current.issuedAt < 60_000) return current;

  if (issuing) return issuing;
  issuing = (async () => {
    const state = loadState();
    const result = await startQrLogin({
      baseUrl: API_BASE,
      botType: BOT_TYPE,
      localTokenList: state.botToken ? [state.botToken] : [],
      apiOptions: apiOptions(),
    });
    if (!result.ok || !result.qrcode) {
      issuing = null;
      throw new Error(result.message);
    }
    current = {
      qrcode: result.qrcode,
      url: result.qrcodeImgContent,
      png: result.qrcodeImgContent,
      issuedAt: Date.now(),
    };
    state.qrcode = result.qrcode;
    state.qrBaseUrl = result.baseUrl;
    state.qrImgContent = result.qrcodeImgContent;
    state.qrIssuedAt = current.issuedAt;
    saveState(state);
    issuing = null;
    return current;
  })();
  return issuing;
}

// ── Status poll loop ───────────────────────────────────────────────────────
// Runs independently of the page: the code is confirmed server-side even if
// the browser tab is closed.
let polling = false;
async function pollLoop() {
  if (polling) return;
  polling = true;
  while (true) {
    const state = loadState();
    if (!state.qrcode) {
      try { await issueFresh(); } catch { /* retry shortly */ }
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    try {
      const result = await pollQrLogin({
        qrcode: state.qrcode,
        baseUrl: state.qrBaseUrl || API_BASE,
        verifyCode: state.verifyCode,
        apiOptions: apiOptions(state.botToken),
      });
      if (result.status === "confirmed" && result.botToken) {
        state.botToken = result.botToken;
        state.accountId = result.accountId;
        state.userId = result.userId;
        state.baseUrl = result.baseUrl;
        state.confirmedAt = Date.now();
        saveState(state);
        console.log("LOGIN CONFIRMED", result.accountId, result.userId);
        return;
      }
      if (result.status === "expired" || result.status === "verify_code_blocked") {
        current = null;
        state.qrcode = undefined;
        saveState(state);
        await issueFresh().catch(() => {});
      }
      if (result.status === "need_verifycode") {
        console.log("NEEDS VERIFY CODE");
      }
    } catch (e) {
      console.log("poll error:", String(e).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}
void pollLoop();

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信 ClawBot 扫码</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.6 -apple-system, "PingFang SC", system-ui, sans-serif;
         margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f6f4f1; color: #1c1917; }
  .card { background: #fff; padding: 32px 36px; border-radius: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,.08); text-align: center;
          max-width: 460px; }
  h1 { font-size: 19px; margin: 0 0 6px; }
  p { color: #78716c; margin: 0 0 18px; font-size: 13px; }
  img { width: 300px; height: 300px; border-radius: 10px; background: #fff;
        border: 1px solid #e7e5e4; }
  .st { margin-top: 14px; font-size: 13px; color: #78716c; }
  .ok { color: #15803d; font-weight: 600; }
  a { color: #2563eb; font-size: 12px; }
</style></head>
<body>
  <div class="card">
    <h1>微信 ClawBot 扫码授权</h1>
    <p>用微信「扫一扫」扫描下方二维码，并在手机上确认</p>
    <img id="q" alt="QR">
    <div class="st" id="s">正在获取二维码…</div>
    <div class="st"><a id="l" href="#">在新标签页打开二维码链接</a></div>
  </div>
<script>
  const q = document.getElementById('q'), s = document.getElementById('s'), l = document.getElementById('l');
  async function load() {
    try {
      const r = await fetch('/api/qr', { cache: 'no-store' });
      const d = await r.json();
      if (d.png) { q.src = d.png; l.href = d.url; s.textContent = '二维码已刷新 · ' + new Date(d.issuedAt).toLocaleTimeString(); }
      else if (d.confirmed) { s.innerHTML = '<span class="ok">✓ 已绑定：' + (d.userId||'') + '</span>'; q.style.opacity = .3; }
      else s.textContent = d.error || '获取失败，稍后重试';
    } catch (e) { s.textContent = '获取失败，稍后重试'; }
  }
  load();
  setInterval(load, 20000);
</script>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/api/qr") {
    const state = loadState();
    if (state.botToken && state.confirmedAt && Date.now() - state.confirmedAt < 600_000) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ confirmed: true, userId: state.userId, accountId: state.accountId }));
      return;
    }
    try {
      const cur = await issueFresh();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ png: cur.png, url: cur.url, issuedAt: cur.issuedAt }));
    } catch (e) {
      /**
       * The reason goes to the terminal, not to the browser.
       *
       * The error used to be sent as it was — and an error carries the
       * stack, and the stack says where the operator's files are. The
       * page is a local one, but the rule is the same as anywhere
       * else: what the server says about its own insides stays on the
       * server.
       */
      console.error("[live-qr-page] the QR code could not be issued:", e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "the QR code could not be issued — see the terminal" }));
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QR page: http://127.0.0.1:${PORT}`);
  console.log("Codes are minted fresh on every view and refreshed every 20s.");
});
