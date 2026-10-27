import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Whether the collection was cut short.
 *
 * Every collector has a limit of its own — a thousand messages for
 * Feishu, five hundred for DingTalk, a thousand for Slack — and the
 * limit is the *collector's*, not the server's. The server only passes
 * `--msg-limit` when the user typed one, so usually the collector
 * stopped at its own limit.
 *
 * And it said nothing. No collector set `meta.truncated`, so the server
 * reported `truncated: false`, the interface showed no warning, and
 * the persona was distilled from a tenth of the history — with the
 * interface saying the collection was complete.
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

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

function runPython(body: string): { status: number; out: string; err: string } {
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** The stub the collectors need, when the real ones are not installed. */
const STUBS = `
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
`;

describe.skipIf(!PYTHON)("the payload the collectors write", () => {
  const collectors = [
    "feishu_auto_collector.py",
    "dingtalk_auto_collector.py",
    "slack_auto_collector.py",
  ];

  it("says when the collection was cut short", () => {
    for (const name of collectors) {
      const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import importlib
module = importlib.import_module(${JSON.stringify(name.replace(/\.py$/, ""))})
payload = module.build_json_payload([{"role": "assistant", "content": "x"}], truncated=True)
sys.stderr.write(json.dumps({"truncated": payload["meta"]["truncated"]}))
`;
      const result = runPython(body);
      expect(result.err, name).not.toBe("");
      expect(JSON.parse(result.err.trim()).truncated, name).toBe(true);
    }
  });

  it("does not say it was cut short when it was not", () => {
    for (const name of collectors) {
      const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import importlib
module = importlib.import_module(${JSON.stringify(name.replace(/\.py$/, ""))})
payload = module.build_json_payload([{"role": "assistant", "content": "x"}])
sys.stderr.write(json.dumps({"truncated": payload["meta"]["truncated"]}))
`;
      const result = runPython(body);
      expect(JSON.parse(result.err.trim()).truncated, name).toBe(false);
    }
  });
});

describe.skipIf(!PYTHON)("the collectors that walk a list", () => {
  it("the Feishu one says when a chat gave it everything it asked for", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import feishu_auto_collector as f

def fake_get_chats(user_open_id, config):
    return [{"chat_id": "oc_1", "name": "群一"}]

def fake_fetch(chat_id, user_open_id, limit, config):
    # The chat gave exactly as many as were asked for — so there may be
    # more behind them.
    return [{"content": f"消息{i}", "sender": "x", "time": "10:00"} for i in range(limit)]

f.get_chats_with_user = fake_get_chats
f.fetch_messages_from_chat = fake_fetch

records, sources, truncated = f.collect_message_records(
    {"open_id": "ou_1", "name": "张三"}, 10, {}
)
sys.stderr.write(json.dumps({"truncated": truncated, "n": len(records)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toContain("truncated");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.truncated).toBe(true);
  });

  it("the Feishu one says so when a chat gave it less than it asked for", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import feishu_auto_collector as f

def fake_get_chats(user_open_id, config):
    return [{"chat_id": "oc_1", "name": "群一"}]

def fake_fetch(chat_id, user_open_id, limit, config):
    # The chat was exhausted — there is nothing behind these.
    return [{"content": "只有一条", "sender": "x", "time": "10:00"}]

f.get_chats_with_user = fake_get_chats
f.fetch_messages_from_chat = fake_fetch

records, sources, truncated = f.collect_message_records(
    {"open_id": "ou_1", "name": "张三"}, 10, {}
)
sys.stderr.write(json.dumps({"truncated": truncated}, ensure_ascii=False))
`;
    const result = runPython(body);
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.truncated).toBe(false);
  });
});

describe("the parsers", () => {
  it("the Feishu export one says the key is there", () => {
    const source = readFileSync(path.join(TOOLS, "feishu_parser.py"), "utf-8");
    // The server reads the key to know whether the list was cut short.
    expect(source).toMatch(/"truncated"/);
  });
});
