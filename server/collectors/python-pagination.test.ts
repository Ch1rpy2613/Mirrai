import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The collectors that walk a list.
 *
 * Slack checks the first fifty channels the bot is in — so a colleague
 * in channel fifty-one is reported as "no shared channel", which is a
 * lie about the colleague, and the user cannot even find out where they
 * talk.
 *
 * DingTalk asked for one page of users and one page of records: a
 * department with more than a hundred people, or a table with more than
 * two hundred rows, silently lost the rest — and the export looked
 * complete, because the header was there and only the rows were not.
 *
 * And the Feishu department walk asked as fast as it could, until the
 * API's rate limit refused it — and the user saw "not found".
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

/** Whether python3 is there at all. */
function python(): string | null {
  for (const candidate of ["python3", "python"]) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) return candidate;
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

/** The answer the snippet left on stderr, past the collector's own output. */
function answer(err: string): any {
  const at = err.lastIndexOf("ANSWER:");
  expect(at, `no answer in the output: ${err}`).toBeGreaterThanOrEqual(0);
  return JSON.parse(err.slice(at + "ANSWER:".length).trim());
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

describe.skipIf(!PYTHON)("the Slack channels", () => {
  it("says how many it did not look at", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import slack_auto_collector as s

class FakeClient:
    def paginate(self, method, key, **kwargs):
        if method == "conversations_list":
            # The bot is in sixty channels.
            return [{"id": f"C{i}", "name": f"c{i}", "is_member": True} for i in range(60)]
        return []
    def conversations_members(self, **kwargs):
        return []

channels, unchecked = s.get_channels_with_user("U1", 50, FakeClient())
sys.stderr.write("ANSWER:" + json.dumps({"unchecked": unchecked}, ensure_ascii=False))
`;
    const result = runPython(body);
    // Ten channels were not looked at — so "no shared channel" is not
    // what the answer means, and it has to say so.
    expect(answer(result.err).unchecked).toBe(10);
  });

  it("looks at all of them when there are few enough", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import slack_auto_collector as s

class FakeClient:
    def paginate(self, method, key, **kwargs):
        if method == "conversations_list":
            return [{"id": f"C{i}", "name": f"c{i}", "is_member": True} for i in range(10)]
        return []
    def conversations_members(self, **kwargs):
        return []

channels, unchecked = s.get_channels_with_user("U1", 50, FakeClient())
sys.stderr.write("ANSWER:" + json.dumps({"unchecked": unchecked}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(answer(result.err).unchecked).toBe(0);
  });
});

describe.skipIf(!PYTHON)("the DingTalk directories", () => {
  it("reads every page of a department", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import dingtalk_auto_collector as d

calls = []

def fake_post(path, body_params, config):
    calls.append(body_params)
    cursor = body_params.get("cursor", 0)
    if cursor == 0:
        return {
            "list": [{"name": f"person-{i}", "userId": f"u{i}"} for i in range(100)],
            "nextCursor": 100,
        }
    if cursor == 100:
        return {"list": [{"name": "张三", "userId": "u-zhang"}], "nextCursor": 200}
    return {"list": []}

def fake_get(path, params, config):
    if "users/" in path:
        return {"result": {"name": "张三"}}
    return {"result": []}

d.api_post = fake_post
d.api_get = fake_get

users = d.search_users_by_dept("张三", {}, dept_id=1)
sys.stderr.write("ANSWER:" + json.dumps({"calls": len(calls), "found": len(users)}, ensure_ascii=False))
`;
    const result = runPython(body);
    const parsed = answer(result.err);
    // More than one page was read — the second page held the colleague.
    expect(parsed.calls).toBeGreaterThan(1);
    expect(parsed.found).toBe(1);
  });
});

describe.skipIf(!PYTHON)("the Feishu department walk", () => {
  it("waits between the calls", () => {
    const body = `
import json, sys, types, time
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import feishu_auto_collector as f

slept = {"n": 0, "total": 0.0}
real_sleep = time.sleep
def counting_sleep(seconds):
    slept["n"] += 1
    slept["total"] += seconds
    return real_sleep(0)
f.time.sleep = counting_sleep

def fake_get(path, params, config):
    if "departments" in path:
        return {"code": 0, "data": {"items": []}}
    return {"code": 0, "data": {"items": []}}

f.api_get = fake_get
f._find_user_by_department("张三", {})
sys.stderr.write("ANSWER:" + json.dumps({"slept": slept["n"]}, ensure_ascii=False))
`;
    const result = runPython(body);
    // The walk paused between the calls — it used to ask as fast as it
    // could, until the API refused.
    expect(answer(result.err).slept).toBeGreaterThan(0);
  });
});
