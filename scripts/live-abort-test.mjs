/**
 * Tests the server's exact call shape: 35s timeout + an external abort signal.
 * The working script used a shorter timeout and no signal.
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

const base = {
  baseUrl: state.baseUrl,
  token: state.botToken,
  appId: "bot",
  clientVersion: 65536,
  channelVersion: APP_VERSION,
  botAgent: `Mirrai/${APP_VERSION}`,
  routeTag: "",
};

async function attempt(label, opts) {
  const controller = new AbortController();
  const started = Date.now();
  try {
    const resp = await getUpdates({
      ...base,
      get_updates_buf: state.syncBuf || "",
      abortSignal: controller.signal,
      ...opts,
    });
    console.log(`${label}: OK in ${Date.now() - started}ms  msgs=${resp.msgs?.length ?? 0}`);
    return true;
  } catch (err) {
    console.log(`${label}: FAILED in ${Date.now() - started}ms`);
    console.log(`   err.name : ${err.name}`);
    console.log(`   err.msg  : ${err.message}`);
    console.log(`   cause    : ${err.cause?.name} | ${err.cause?.message} | ${err.cause?.code}`);
    console.log(`   instanceof Error: ${err instanceof Error}`);
    return false;
  }
}

// A: no signal, short timeout  (the shape that worked)
const a = await attempt("A no-signal, 15s ", { timeoutMs: 15_000 });

// B: with signal, short timeout
const b = await attempt("B signal, 15s    ", { timeoutMs: 15_000 });

// C: with signal, 35s (the server's shape)
const c = await attempt("C signal, 35s    ", { timeoutMs: 35_000 });

/**
 * The test failed.
 *
 * It used to print what happened and carry on — so the script said
 * "FAILED" and then said goodbye with a success. A test that cannot
 * fail is not a test: it says the shape works when it does not.
 *
 * A is the shape that is known to work, so if A fails the cause is not
 * the abort signal, and the run says so rather than blaming the wrong
 * thing.
 */
if (!a) {
  console.log("\n=> even the shape without a signal failed — the failure is not the abort signal");
}
process.exitCode = a && b && c ? 0 : 1;
