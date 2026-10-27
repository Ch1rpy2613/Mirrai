import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The Feishu MCP client.
 *
 * The MCP stdio protocol answers with an envelope:
 *
 *   {"result": {"content": [{"type": "text", "text": ...}], "isError": false}}
 *
 * The content is a list of blocks, and the text is inside them. It was
 * read as though the envelope were `{"result": [...]}` — so the
 * document branch handed back the whole envelope as the document, and
 * the message branch counted zero messages, every time.
 *
 * The client is also given the credentials on the command line in one
 * of its forms, and the MCP's own output was decoded with the
 * machine's encoding — which on Windows is not UTF-8.
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

/** Whether python3 is there at all. */
function python(): string | null {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const PYTHON = python();

/** Runs a Python snippet with the tools directory on its path. */
function runPython(body: string): { status: number; out: string; err: string } {
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe.skipIf(!PYTHON)("the Feishu MCP client", () => {
  it("reads the answer out of the envelope", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

# What the MCP stdio protocol actually answers with.
envelope = {
    "result": {
        "content": [{"type": "text", "text": "这是文档的正文。"}],
        "isError": False,
    }
}

print(json.dumps({"text": m.mcp_text(envelope)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out.trim());
    // The text, not the envelope.
    expect(parsed.text).toBe("这是文档的正文。");
  });

  it("finds the answer even when a log line came first", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

stdout = 'feishu-mcp: starting\\n{"result": {"content": [{"type": "text", "text": "正文"}], "isError": false}}\\n'

print(json.dumps({"text": m.mcp_text(m.parse_mcp_envelope(stdout))}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out.trim()).text).toBe("正文");
  });

  it("says so when the MCP reports an error", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

envelope = {"result": {"content": [{"type": "text", "text": "没有权限"}], "isError": True}}

try:
    m.mcp_text(envelope)
    print(json.dumps({"raised": False}, ensure_ascii=False))
except RuntimeError as e:
    print(json.dumps({"raised": True, "message": str(e)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out.trim());
    expect(parsed.raised).toBe(true);
    expect(parsed.message).toContain("没有权限");
  });

  it("reads the messages out of the envelope", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

envelope = {
    "result": {
        "content": [{"type": "text", "text": json.dumps({
            "items": [{"sender": {"name": "张三"}, "content": "在吗"}],
            "page_token": "next-page",
        }, ensure_ascii=False)}],
        "isError": False,
    }
}

messages, cursor = m._mcp_message_page(envelope)
print(json.dumps({"count": len(messages), "cursor": cursor, "name": messages[0]["sender"]["name"]}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out.trim());
    // One message — it used to be zero, every time.
    expect(parsed.count).toBe(1);
    expect(parsed.name).toBe("张三");
    expect(parsed.cursor).toBe("next-page");
  });

  it("reads more than one page when the chat has more", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

pages = {
    None: {"items": [{"i": n} for n in range(50)], "page_token": "p2"},
    "p2": {"items": [{"i": n} for n in range(50, 120)], "has_more": False},
}
calls = []

def fake_call(tool, params, config):
    calls.append(params)
    token = params.get("page_token")
    items = pages[token]["items"]
    return {"result": {"content": [{"type": "text", "text": json.dumps({"items": items, "page_token": pages[token].get("page_token")}, ensure_ascii=False)}], "isError": False}}

m.call_mcp = fake_call
out = m.fetch_messages_via_mcp("oc_1", "", 120, {})
print(json.dumps({"calls": len(calls), "lines": out.count("\\n")}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out.trim());
    // More than one page was read — it used to read one page and stop,
    // so `--limit 500` gave fifty messages.
    expect(parsed.calls).toBeGreaterThan(1);
  });

  it("puts the token in the environment, not on the command line", () => {
    const body = `
import json, sys, inspect
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

source = inspect.getsource(m)
# The token goes in the environment, not on the command line: a command
# line is visible to every process on the machine.
print(json.dumps({
    "onCommandLine": "--user-token" in source,
    "inEnvironment": "FEISHU_USER_ACCESS_TOKEN" in source,
}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out.trim());
    expect(parsed.onCommandLine).toBe(false);
    expect(parsed.inEnvironment).toBe(true);
  });

  it("takes the credentials from the environment, not the command line", () => {
    const body = `
import json, sys, os, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import feishu_auto_collector as m

# A command line is visible to every process on the machine, so the
# credential goes in the environment.
os.environ["FEISHU_USER_ACCESS_TOKEN"] = "token-from-the-environment"
os.environ["FEISHU_EXCHANGE_CODE"] = "code-from-the-environment"

seen = {}
m.exchange_code_for_token = lambda code, config: {"access_token": "t", "refresh_token": "r", "scope": "im"}
m.load_config = lambda: {"app_id": "a", "app_secret": "s"}
saved = {}
m.save_config = lambda config: saved.update(config)

sys.argv = ["feishu_auto_collector.py", "--name", "张三"]
try:
    m.main()
except SystemExit:
    pass

# The exchange code from the environment was used.
sys.stderr.write(json.dumps({"saved": bool(saved)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(JSON.parse(result.err.trim()).saved).toBe(true);
  });

  it("asks nothing when there is nobody there to answer", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m

# The server runs the collector with no standard input at all.
sys.stdin = None
print(json.dumps({"answer": m.ask("App ID: ")}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    // It used to raise EOFError, and the script died with a traceback
    // at the exact moment it needed the person in front of the browser.
    expect(JSON.parse(result.out.trim()).answer).toBe("");
  });
});
