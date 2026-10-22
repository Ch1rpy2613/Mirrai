/**
 * Tests the server's exact call shape: 35s timeout + an external abort signal.
 * The working script used a shorter timeout and no signal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const state = JSON.parse(readFileSync(path.join(ROOT, ".live-wechat-state.json"), "utf-8"));

const { getUpdates } = await import(path.join(ROOT, ".live-test/ilink/client.js"));

const base = {
  baseUrl: state.baseUrl,
  token: state.botToken,
  appId: "bot",
  clientVersion: 65536,
  channelVersion: "1.0.0",
  botAgent: "Mirrai/1.0.0",
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
await attempt("A no-signal, 15s ", { timeoutMs: 15_000 });

// B: with signal, short timeout
await attempt("B signal, 15s    ", { timeoutMs: 15_000 });

// C: with signal, 35s (the server's shape)
await attempt("C signal, 35s    ", { timeoutMs: 35_000 });
