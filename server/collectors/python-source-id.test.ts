import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The source's own id, all the way through.
 *
 * A message with no time of its own could only be told apart by its
 * text and by how many times that text had been seen — and the
 * collectors return a *window*, not the whole history, so the window
 * moves and the new message is not imported.
 *
 * The id — Feishu's `message_id`, Slack's `ts`, the page's
 * `data-message-id` — does not move. So it is carried through the
 * payload, and the server stores it.
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
  const result = runPythonSnippet(PYTHON!, body, {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

/** The payload a collector's `to_json_messages` builds. */
function payloadOf(module: string, records: unknown): any {
  const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
# The collectors ask for their libraries at import time, and they are
# not installed here — so they are stubbed out.
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin", "pypinyin.core"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        _mod.errors = _mod
        _mod.lazy_pinyin = lambda *a, **k: []
        _mod.Style = object
        sys.modules[_name] = _mod
import ${module} as m
messages = m.to_json_messages(json.loads(${JSON.stringify(JSON.stringify(records))}))
sys.stderr.write(json.dumps(messages, ensure_ascii=False))
`;
  const result = runPython(body);
  expect(result.err).not.toContain("Traceback");
  const line = result.err.slice(result.err.lastIndexOf("[")).trim();
  return JSON.parse(line);
}

describe.skipIf(!PYTHON)("the Feishu collector", () => {
  it("carries the source's own id into the payload", () => {
    const messages = payloadOf("feishu_auto_collector", [
      { content: "在吗", time: "2026-03-14 10:00:00", id: "om_abc123", is_target: true },
    ]);
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe("om_abc123");
  });

  it("leaves the id out when there is none", () => {
    // An empty id is not an id — it is the absence of one, and the
    // server falls back to the old way of telling messages apart.
    const messages = payloadOf("feishu_auto_collector", [
      { content: "在吗", time: "2026-03-14 10:00:00", id: "", is_target: true },
    ]);
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBeUndefined();
  });
});

describe.skipIf(!PYTHON)("the Slack collector", () => {
  it("carries the source's own id into the payload", () => {
    const messages = payloadOf("slack_auto_collector", [
      { content: "在吗", time: "2026-03-14 10:00:00", id: "1710000000.000100" },
    ]);
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe("1710000000.000100");
  });
});

describe.skipIf(!PYTHON)("the DingTalk collector", () => {
  it("carries the page's own id into the payload", () => {
    const messages = payloadOf("dingtalk_auto_collector", [
      { content: "在吗", time: "2026-03-14 10:00:00", id: "dlg_42" },
    ]);
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe("dlg_42");
  });
});
