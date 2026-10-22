/**
 * Live test against the REAL WeChat iLink backend.
 *
 * Uses the bot token obtained from the real QR scan, and Mirrai's own shipped
 * client. Nothing about the network peer is faked here.
 */
import path from "node:path";

const ROOT = process.cwd();
const state = JSON.parse(
  (await import("node:fs")).readFileSync(
    path.join(ROOT, ".live-wechat-state.json"),
    "utf-8",
  ),
);

const { getUpdates, buildClientVersion } = await import(
  path.join(ROOT, ".live-test/ilink/client.js")
);
const { parseInboundMessage } = await import(
  path.join(ROOT, ".live-test/ilink/parse.js")
);

const apiOptions = {
  baseUrl: state.baseUrl || "https://ilinkai.weixin.qq.com",
  token: state.botToken,
  appId: process.env.WECHAT_ILINK_APP_ID || "bot",
  clientVersion: buildClientVersion(process.env.APP_VERSION || "1.0.0"),
  channelVersion: process.env.APP_VERSION || "1.0.0",
  botAgent: `Mirrai/${process.env.APP_VERSION || "1.0.0"}`,
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
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, ".live-wechat-state.json"), "utf-8"));
  s.syncBuf = resp.get_updates_buf;
  fs.writeFileSync(path.join(ROOT, ".live-wechat-state.json"), JSON.stringify(s, null, 2));
  console.log("\ncursor saved");
}
