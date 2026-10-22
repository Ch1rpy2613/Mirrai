/**
 * Isolates the difference between the working script and the failing server.
 *
 * The server builds its API options from ENV, the script builds them inline.
 * This compares the two and tries the server's exact option set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const state = JSON.parse(readFileSync(path.join(ROOT, ".live-wechat-state.json"), "utf-8"));

const { getUpdates, buildClientVersion, buildBaseInfo } = await import(
  path.join(ROOT, ".live-test/ilink/client.js")
);
const { ENV } = await import(path.join(ROOT, ".live-test/wechat/_core/env.js"));

console.log("=== ENV values the server would use ===");
console.log("ENV.wechatIlinkBaseUrl :", JSON.stringify(ENV.wechatIlinkBaseUrl));
console.log("ENV.wechatIlinkAppId   :", JSON.stringify(ENV.wechatIlinkAppId));
console.log("ENV.wechatRouteTag     :", JSON.stringify(ENV.wechatRouteTag));
console.log("ENV.appVersion         :", JSON.stringify(ENV.appVersion));
console.log("");

// The server builds options exactly like this.
const serverOptions = {
  baseUrl: state.baseUrl || ENV.wechatIlinkBaseUrl || "https://ilinkai.weixin.qq.com",
  token: state.botToken,
  appId: ENV.wechatIlinkAppId,
  clientVersion: buildClientVersion(ENV.appVersion),
  channelVersion: ENV.appVersion,
  botAgent: `Mirrai/${ENV.appVersion}`,
  routeTag: ENV.wechatRouteTag,
};

console.log("=== server-style options ===");
console.log(JSON.stringify({ ...serverOptions, token: serverOptions.token?.slice(0, 12) + "..." }, null, 2));
console.log("");

try {
  const resp = await getUpdates({
    ...serverOptions,
    get_updates_buf: state.syncBuf || "",
    timeoutMs: 15_000,
  });
  console.log("RESULT: OK, msgs =", resp.msgs?.length ?? 0);
} catch (err) {
  console.log("RESULT: FAILED");
  console.log("  err.name :", err.name);
  console.log("  err.msg  :", err.message);
  console.log("  cause    :", err.cause?.name, "|", err.cause?.message, "|", err.cause?.code);
}
