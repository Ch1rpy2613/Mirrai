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
import { readFileSync } from "node:fs";

const PORT = Number(process.argv[2]) || 8899;
// Mirrai's ClaudeProvider appends "/v1/messages" to the base URL, so the
// upstream base must stop at ".../llm" for the forwarded path to line up.
const UPSTREAM = "https://agent.minimax.cn/mavis/api/v1/llm";

const auth = JSON.parse(
  readFileSync("/Users/ch1rpy/.minimax/auth/prod/cn/mcode-public/auth.json", "utf-8"),
);
const KEY = Object.values(auth.records)[0].accessToken;

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
