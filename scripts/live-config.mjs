/**
 * Shared configuration for the live WeChat channel verification scripts.
 *
 * All paths are environment-driven so the scripts work on any machine and in
 * any checkout location. See scripts/README.md for usage.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repository root — defaults to the parent of this script's directory.
 *
 * The path came from `new URL(...).pathname`, which is not a path: it
 * keeps the percent-encoding (so a checkout in a folder with a space in
 * its name pointed at nothing), and on Windows it begins with a slash
 * in front of the drive letter (so every path built from it was wrong).
 * `fileURLToPath` gives the path the URL means.
 */
export const ROOT = path.resolve(
  process.env.MIRRAI_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

/** Scratch directory for compiled bundles and runtime state. */
export const WORK_DIR = path.resolve(process.env.MIRRAI_LIVE_WORK_DIR ?? path.join(ROOT, ".live-test"));

/** Where the compiled ilink/llm modules are written. */
export const ILINK_BUILD_DIR = path.join(WORK_DIR, "ilink");
export const LLM_BUILD_DIR = path.join(WORK_DIR, "llm");
export const WECHAT_BUILD_DIR = path.join(WORK_DIR, "wechat");

/** Persistent state (QR cursor, bot token) for the live scripts. */
export const STATE_FILE = path.resolve(
  process.env.MIRRAI_LIVE_STATE_FILE ?? path.join(ROOT, ".live-wechat-state.json"),
);

/** Rendered QR image, refreshed in place. */
export const QR_PNG = path.resolve(process.env.MIRRAI_LIVE_QR_PNG ?? path.join(ROOT, "live-wechat-qr.png"));

/** Current QR URL, refreshed in place. */
export const QR_URL_FILE = path.resolve(
  process.env.MIRRAI_LIVE_QR_URL_FILE ?? path.join(ROOT, "live-wechat-qr-url.txt"),
);

/** Optional bearer token for an OpenAI-compatible gateway used in the LLM check. */
export const LLM_API_KEY = process.env.MIRRAI_LIVE_LLM_API_KEY ?? "";

/** Optional base URL for that gateway (e.g. an Anthropic-protocol proxy). */
export const LLM_BASE_URL = process.env.MIRRAI_LIVE_LLM_BASE_URL ?? "";

/** Model name to request from that gateway. */
export const LLM_MODEL = process.env.MIRRAI_LIVE_LLM_MODEL ?? "";

/** iLink backend settings, shared with the server's own configuration. */
export const ILINK_BASE_URL = process.env.WECHAT_ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com";
export const ILINK_APP_ID = process.env.WECHAT_ILINK_APP_ID ?? "bot";
export const ILINK_BOT_TYPE = process.env.WECHAT_BOT_TYPE ?? "3";
export const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

/** Port for the local QR page. */
export const QR_PAGE_PORT = Number(process.env.MIRRAI_LIVE_QR_PORT ?? 8898);

/** Port for the optional LLM proxy. */
export const LLM_PROXY_PORT = Number(process.env.MIRRAI_LIVE_LLM_PROXY_PORT ?? 8899);

/** Port used by the stub iLink backend in the inbound-chain test. */
export const STUB_PORT = Number(process.env.MIRRAI_LIVE_STUB_PORT ?? 9911);

/** Database URL for the live test database. */
export const DATABASE_URL = process.env.DATABASE_URL ?? "";

/** Reads a JSON file, returning null when it is missing or unreadable. */
export function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** Loads the live state file. */
export function loadState() {
  return readJsonSafe(STATE_FILE) ?? {};
}

/** Persists the live state file. */
export function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}
