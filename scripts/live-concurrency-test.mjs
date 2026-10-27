/**
 * Hypothesis: two concurrent getUpdates long-polls on the SAME bot token
 * cause connection failures ("fetch failed") for one of them.
 *
 * The upstream plugin notes it only supports one account per gateway and
 * warns about concurrent consumers; this checks what actually happens.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_VERSION } from "./live-config.mjs";

const ROOT = process.cwd();
const state = JSON.parse(readFileSync(path.join(ROOT, ".live-wechat-state.json"), "utf-8"));

const { getUpdates } = await import(path.join(ROOT, ".live-test/ilink/client.js"));

const opts = {
  baseUrl: state.baseUrl,
  token: state.botToken,
  appId: "bot",
  clientVersion: 65536,
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
  get_updates_buf: state.syncBuf || "",
  timeoutMs: 20_000,
};

async function attempt(label) {
  const started = Date.now();
  try {
    const resp = await getUpdates(opts);
    console.log(`${label}: OK in ${Date.now() - started}ms msgs=${resp.msgs?.length ?? 0}`);
    return "ok";
  } catch (err) {
    console.log(`${label}: FAILED in ${Date.now() - started}ms — ${err.message}`);
    console.log(`    cause: ${err.cause?.name} | ${err.cause?.message} | ${err.cause?.code}`);
    return "fail";
  }
}

console.log("=== single poll (control) ===");
await attempt("single");

console.log("\n=== two concurrent polls on the same token ===");
const results = await Promise.all([attempt("poll-A"), attempt("poll-B")]);
console.log("\nsummary:", results.join(", "));
console.log(
  results.includes("fail")
    ? "=> concurrent polls on one token DO break the connection"
    : "=> concurrent polls survived this time",
);
