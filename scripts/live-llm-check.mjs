/**
 * Verifies Mirrai's own ClaudeProvider against the configured endpoint,
 * so the end-to-end test exercises the shipped LLM path.
 */
import path from "node:path";

import { LLM_API_KEY, LLM_BASE_URL, LLM_BUILD_DIR, LLM_MODEL } from "./live-config.mjs";

/**
 * The key comes from the environment.
 *
 * It was read out of a file in the maintainer's own home directory, and
 * the path was written into the script — so the check could only run on
 * that one machine, and the file it read was nobody else's business to
 * have in a repository.
 */
const key = LLM_API_KEY;
if (!key) {
  console.error(
    "Set MIRRAI_LIVE_LLM_API_KEY (and MIRRAI_LIVE_LLM_BASE_URL, MIRRAI_LIVE_LLM_MODEL) first.",
  );
  process.exit(1);
}

// Mirrai's ClaudeProvider appends "/v1/messages" to baseUrl, so baseUrl must
// end at ".../llm" to reach ".../llm/v1/messages".
const { ClaudeProvider } = await import(
  path.join(LLM_BUILD_DIR, "providers/claude.js")
);

const provider = new ClaudeProvider(
  key,
  LLM_MODEL || "MiniMax-M3.1-Flash",
  LLM_BASE_URL || "https://agent.minimax.cn/mavis/api/v1/llm",
);

console.log("isConfigured:", provider.isConfigured());
try {
  const out = await provider.invoke(
    [
      { role: "system", content: "你是一个测试助手。" },
      { role: "user", content: "只回复：通道验证成功" },
    ],
    { maxTokens: 128 },
  );
  console.log("reply:", JSON.stringify(out));
} catch (e) {
  /**
   * The check failed.
   *
   * It used to print the error and carry on — so the script said
   * "ERROR" and then said goodbye with a success. A check that cannot
   * fail is not a check: it says the end-to-end path works when the
   * end-to-end path is broken.
   */
  console.log("ERROR:", String(e).slice(0, 300));
  process.exitCode = 1;
}
