/**
 * A stub model service, for the live verification.
 *
 * It speaks the OpenAI chat-completions protocol — both the plain answer
 * and the stream — so the app's own code path runs unchanged: the same
 * provider, the same request body, the same parsing. Only the model
 * behind it is a stub.
 *
 * Usage: node /tmp/stub-llm.mjs [port]
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] || 3122);
const REPLY = "在的呀，今天过得怎么样？我在呢。";

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

const server = createServer(async (req, res) => {
  const body = await readBody(req);
  let parsed = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    parsed = {};
  }
  const stream = parsed.stream === true;
  console.log(
    `[stub] ${req.method} ${req.url} stream=${stream} messages=${parsed.messages?.length ?? 0}`,
  );

  if (req.url?.includes("/chat/completions")) {
    if (!stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "stub",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model ?? "stub",
          choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (const piece of REPLY.split(/(?<=.)/)) {
      res.write(
        `data: ${JSON.stringify({
          id: "stub",
          object: "chat.completion.chunk",
          model: parsed.model ?? "stub",
          choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
        })}\n\n`,
      );
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stub] the stub model service is on http://127.0.0.1:${PORT}`);
});
