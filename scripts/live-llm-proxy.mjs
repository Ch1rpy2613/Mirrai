/**
 * Local proxy for the live end-to-end test.
 *
 * The configured endpoint is Anthropic-protocol but requires BOTH `x-api-key`
 * and `Authorization: Bearer` headers, whereas Mirrai's ClaudeProvider sends
 * only `x-api-key` (which is correct for the real Anthropic API). The proxy
 * adds the missing header so the shipped provider code can be exercised
 * unmodified.
 *
 * Usage: node scripts/live-llm-proxy.mjs [port]
 */
import { createServer } from "node:http";

import { LLM_API_KEY, LLM_BASE_URL } from "./live-config.mjs";

const PORT = Number(process.argv[2]) || 8899;
// Mirrai's ClaudeProvider appends "/v1/messages" to the base URL, so the
// upstream base must stop at ".../llm" for the forwarded path to line up.
const UPSTREAM = LLM_BASE_URL || "https://agent.minimax.cn/mavis/api/v1/llm";

/**
 * The key comes from the environment.
 *
 * It was read out of a file in the maintainer's own home directory, and
 * the path was written into the script — so the proxy could only run on
 * that one machine, and the file it read was nobody else's business to
 * have in a repository.
 */
const KEY = LLM_API_KEY;
if (!KEY) {
  console.error("Set MIRRAI_LIVE_LLM_API_KEY first.");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const target = `${UPSTREAM}${req.url}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        Authorization: `Bearer ${KEY}`,
        "anthropic-version": "2023-06-01",
      },
      body: body.length ? body : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`LLM proxy listening on http://127.0.0.1:${PORT}`);
});
