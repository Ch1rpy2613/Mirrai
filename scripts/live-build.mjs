/**
 * Builds the TypeScript modules the live scripts import.
 *
 * The scripts exercise Mirrai's *shipped* code, so they import the compiled
 * output rather than a copy. This compiles the relevant server modules into
 * the scratch work directory.
 *
 * Usage: node scripts/live-build.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { ILINK_BUILD_DIR, LLM_BUILD_DIR, ROOT, WECHAT_BUILD_DIR } from "./live-config.mjs";

/**
 * Builds a set of modules into a directory.
 *
 * The base directory matters: esbuild lays the output out relative to
 * the common ancestor of the entry points, so without it the files land
 * somewhere the scripts do not look — the llm bundle ended up at
 * `.live-test/llm/llm/providers/claude.js` instead of
 * `.live-test/llm/providers/claude.js`, and every script that imported
 * it failed with "cannot find the module".
 */
function esbuild(entryPoints, outdir, outbase) {
  /**
   * The directory is emptied first.
   *
   * A bundle that is built into a directory that still holds the output
   * of an earlier layout leaves those files there — and then a script
   * that imports one of them gets the old one, and the build looks
   * like it worked.
   */
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const args = [
    ...entryPoints,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--packages=external",
    `--outbase=${outbase}`,
    `--outdir=${outdir}`,
  ];
  execFileSync("npx", ["esbuild", ...args], { cwd: ROOT, stdio: "inherit" });
}

console.log("building ilink modules ->", ILINK_BUILD_DIR);
esbuild(
  [
    "server/wechat/ilink/types.ts",
    "server/wechat/ilink/client.ts",
    "server/wechat/ilink/login.ts",
    "server/wechat/ilink/send.ts",
    "server/wechat/ilink/parse.ts",
  ],
  ILINK_BUILD_DIR,
  "server/wechat/ilink",
);

console.log("building llm modules ->", LLM_BUILD_DIR);
esbuild(
  [
    "server/llm/index.ts",
    "server/llm/provider-registry.ts",
    "server/llm/types.ts",
    "server/llm/providers/openai.ts",
    "server/llm/providers/claude.ts",
    "server/llm/providers/ollama.ts",
    "server/llm/providers/xunfei.ts",
    "server/llm/providers/dify.ts",
  ],
  LLM_BUILD_DIR,
  "server/llm",
);

console.log("building wechat modules ->", WECHAT_BUILD_DIR);
esbuild(
  [
    "server/wechat/bot.ts",
    "server/wechat/message-handler.ts",
    "server/wechat/persona-bridge.ts",
    "server/wechat/commands.ts",
    "server/_core/persona-utils.ts",
    "server/_core/emotion.ts",
    "server/_core/json.ts",
    "server/_core/crypto.ts",
    "server/_core/env.ts",
    "server/db.ts",
  ],
  WECHAT_BUILD_DIR,
  "server",
);

console.log("build complete");
