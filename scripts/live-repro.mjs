/**
 * Reproduces the server's exact getUpdates call: same env, same bundle, same
 * timeout and abort signal, but no other process involved.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_VERSION, ILINK_BUILD_DIR, STATE_FILE } from "./live-config.mjs";

/**
 * The paths come from the shared configuration.
 *
 * They were rebuilt here — so the `MIRRAI_LIVE_*` overrides did not
 * apply to this script, and it read a state file the other scripts were
 * not using.
 */
const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));

const { getUpdates, buildClientVersion } = await import(
  path.join(ILINK_BUILD_DIR, "client.js")
);

const apiOptions = {
  baseUrl: process.env.WECHAT_ILINK_BASE_URL || state.baseUrl,
  token: state.botToken,
  appId: process.env.WECHAT_ILINK_APP_ID || "bot",
  clientVersion: buildClientVersion(APP_VERSION),
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
  routeTag: process.env.WECHAT_ROUTE_TAG || "",
};

console.log("baseUrl   :", apiOptions.baseUrl);
console.log("token     :", apiOptions.token ? apiOptions.token.slice(0, 12) + "..." : "MISSING");
console.log("appId     :", apiOptions.appId);
console.log("clientVer :", apiOptions.clientVersion);
console.log("botAgent  :", apiOptions.botAgent);
console.log("routeTag  :", JSON.stringify(apiOptions.routeTag));
console.log("");

const controller = new AbortController();
const started = Date.now();
try {
  const resp = await getUpdates({
    ...apiOptions,
    get_updates_buf: state.syncBuf || "",
    timeoutMs: 35_000,
    abortSignal: controller.signal,
  });
  console.log("OK in", Date.now() - started, "ms");
  console.log("resp:", JSON.stringify(resp).slice(0, 300));
} catch (err) {
  console.log("FAILED in", Date.now() - started, "ms");
  console.log("err.name  :", err.name);
  console.log("err.msg   :", err.message);
  console.log("cause     :", err.cause?.name, "|", err.cause?.message, "|", err.cause?.code);
  console.log("cause.stack:");
  console.log(String(err.cause?.stack || err.stack).split("\n").slice(0, 6).join("\n"));
}
