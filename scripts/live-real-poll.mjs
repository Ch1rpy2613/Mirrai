/**
 * Live test against the REAL WeChat iLink backend.
 *
 * Uses the bot token obtained from the real QR scan, and Mirrai's own shipped
 * client. Nothing about the network peer is faked here.
 */
import path from "node:path";
import { APP_VERSION, ILINK_BUILD_DIR, STATE_FILE } from "./live-config.mjs";

/**
 * The paths come from the shared configuration.
 *
 * They were rebuilt here — so the `MIRRAI_LIVE_*` overrides did not
 * apply to this script, and it read a state file the other scripts
 * were not using.
 */
const state = JSON.parse(
  (await import("node:fs")).readFileSync(STATE_FILE, "utf-8"),
);

const { getUpdates, buildClientVersion } = await import(
  path.join(ILINK_BUILD_DIR, "client.js")
);
const { parseInboundMessage } = await import(
  path.join(ILINK_BUILD_DIR, "parse.js")
);

const apiOptions = {
  baseUrl: state.baseUrl || "https://ilinkai.weixin.qq.com",
  token: state.botToken,
  appId: process.env.WECHAT_ILINK_APP_ID || "bot",
  clientVersion: buildClientVersion(APP_VERSION),
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
};

console.log("=== REAL getUpdates long-poll against iLinkai.weixin.qq.com ===");
console.log("(send a message to 微信ClawBot in WeChat now — up to 90s)\n");

const resp = await getUpdates({
  ...apiOptions,
  get_updates_buf: state.syncBuf || "",
  timeoutMs: 90000,
});

console.log("ret       :", resp.ret);
console.log("errcode   :", resp.errcode ?? "(none)", resp.errmsg ?? "");
console.log("msgs      :", resp.msgs?.length ?? 0);
console.log("next buf  :", resp.get_updates_buf ? "(received)" : "(none)");

for (const m of resp.msgs ?? []) {
  console.log("\n--- raw message ---");
  console.log("from        :", m.from_user_id);
  console.log("message_id  :", m.message_id);
  console.log("contextToken:", m.context_token ? "(present)" : "(none)");
  console.log("items       :", JSON.stringify(m.item_list));

  const parsed = parseInboundMessage(m);
  console.log("\n--- parsed by Mirrai ---");
  console.log(JSON.stringify(parsed, null, 2));
}

// Persist the cursor so the next poll continues from here.
if (resp.get_updates_buf) {
  const fs = await import("node:fs");
  const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  s.syncBuf = resp.get_updates_buf;
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  console.log("\ncursor saved");
}
