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
import { mkdirSync } from "node:fs";
import path from "node:path";

import { ILINK_BUILD_DIR, LLM_BUILD_DIR, ROOT, WECHAT_BUILD_DIR } from "./live-config.mjs";

function esbuild(entryPoints, outdir) {
  mkdirSync(outdir, { recursive: true });
  const args = [
    ...entryPoints,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--packages=external",
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
    "server/_core/env.ts",
  ],
  LLM_BUILD_DIR,
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
    "drizzle/schema.ts",
  ],
  WECHAT_BUILD_DIR,
);

console.log("build complete");
