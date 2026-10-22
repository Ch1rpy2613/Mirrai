/**
 * Verifies Mirrai's own ClaudeProvider against the configured endpoint,
 * so the end-to-end test exercises the shipped LLM path.
 */
import { readFileSync } from "node:fs";

const key = (() => {
  const j = JSON.parse(
    readFileSync("/Users/ch1rpy/.minimax/auth/prod/cn/mcode-public/auth.json", "utf-8"),
  );
  return Object.values(j.records)[0].accessToken;
})();

// Mirrai's ClaudeProvider appends "/v1/messages" to baseUrl, so baseUrl must
// end at ".../llm" to reach ".../llm/v1/messages".
const { ClaudeProvider } = await import(
  "/Users/ch1rpy/Desktop/Mirrai/.live-test/llm/providers/claude.js"
);

const provider = new ClaudeProvider(
  key,
  "MiniMax-M3.1-Flash",
  "https://agent.minimax.cn/mavis/api/v1/llm",
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
  console.log("ERROR:", String(e).slice(0, 300));
}
