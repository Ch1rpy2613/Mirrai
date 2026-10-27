/**
 * Hypothesis: two concurrent getUpdates long-polls on the SAME bot token
 * cause connection failures ("fetch failed") for one of them.
 *
 * The upstream plugin notes it only supports one account per gateway and
 * warns about concurrent consumers; this checks what actually happens.
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

const { getUpdates } = await import(path.join(ILINK_BUILD_DIR, "client.js"));

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
const control = await attempt("single");

console.log("\n=== two concurrent polls on the same token ===");
const results = await Promise.all([attempt("poll-A"), attempt("poll-B")]);
console.log("\nsummary:", results.join(", "));
console.log(
  results.includes("fail")
    ? "=> concurrent polls on one token DO break the connection"
    : "=> concurrent polls survived this time",
);

/**
 * The test failed.
 *
 * It used to print what happened and carry on — so the script said
 * "FAILED" and then said goodbye with a success. A test that cannot
 * fail is not a test.
 *
 * The single poll is the control: it says whether the connection works
 * at all. If the control failed, then the concurrent polls failed for
 * the same reason and nothing was learned about concurrency — so the
 * run says that, rather than blaming the wrong thing.
 */
if (control === "fail") {
  console.log("=> the control poll failed too — the concurrent polls failed for the same reason, not because of concurrency");
  process.exitCode = 1;
} else if (results.includes("fail")) {
  process.exitCode = 1;
}
