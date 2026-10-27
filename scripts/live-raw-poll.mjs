import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_VERSION, ILINK_BUILD_DIR, STATE_FILE } from "./live-config.mjs";

/**
 * The paths come from the shared configuration.
 *
 * They were rebuilt here — so the `MIRRAI_LIVE_*` overrides did not
 * apply to this script, and it wrote the state back to a file the
 * other scripts were not reading.
 */
const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));

const { buildClientVersion } = await import(path.join(ILINK_BUILD_DIR, "client.js"));

const apiOptions = {
  baseUrl: state.baseUrl || "https://ilinkai.weixin.qq.com",
  token: state.botToken,
  appId: process.env.WECHAT_ILINK_APP_ID || "bot",
  clientVersion: buildClientVersion(APP_VERSION),
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
};

// Raw POST so the exact wire response is visible.
const url = `${apiOptions.baseUrl.replace(/\/+$/, "")}/ilink/bot/getupdates`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${state.botToken}`,
    "X-WECHAT-UIN": Buffer.from(String(Math.floor(Math.random() * 4294967295))).toString("base64"),
    "iLink-App-Id": apiOptions.appId,
    "iLink-App-ClientVersion": String(apiOptions.clientVersion),
  },
  body: JSON.stringify({
    get_updates_buf: state.syncBuf || "",
    base_info: { channel_version: apiOptions.channelVersion, bot_agent: apiOptions.botAgent },
  }),
});

const text = await res.text();
console.log("HTTP:", res.status);
console.log("RAW BODY:");
console.log(text.slice(0, 2000));

let parsed;
try { parsed = JSON.parse(text); } catch { parsed = null; }
if (parsed?.get_updates_buf) {
  state.syncBuf = parsed.get_updates_buf;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log("\ncursor saved");
}
if (parsed?.msgs?.length) {
  console.log("\n=== MESSAGES RECEIVED ===");
  console.log(JSON.stringify(parsed.msgs, null, 2));
}
