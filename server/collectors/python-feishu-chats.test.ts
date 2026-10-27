import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The chats the collector looks through.
 *
 * It looked through *every* chat: a Feishu account with five hundred
 * groups meant five hundred requests — so it was either so slow that
 * the user thought it had hung, or it hit the rate limit, and after a
 * 429 that group was skipped — so the group the person was actually in
 * might never have been found.
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

describe.skipIf(!PYTHON)("the chats the collector looks through", () => {
  it("does not go through every chat in the account", () => {
    const body = `
import os, sys, types, io, contextlib
os.environ["MIRRAI_CHAT_CHECK_DELAY"] = "0"
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        _mod.errors = _mod
        sys.modules[_name] = _mod
import feishu_auto_collector as m

# An account with many groups.
CHATS = [{"chat_id": f"c{i}", "name": f"群{i}"} for i in range(1000)]

calls = {"members": 0}

def fake_get(path, params, config):
    if path.startswith("/im/v1/chats/") and path.endswith("/members"):
        calls["members"] += 1
    return {
        "code": 0,
        "data": {
            "items": CHATS,
            "has_more": False,
        },
    }

m.api_get = fake_get

out = io.StringIO()
err = io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    rows = m.get_chats_with_user("open-id", {})
print("CHECKED:", calls["members"])
print("LIMIT:", m.MAX_CHATS_TO_CHECK)
print("SAID:", err.getvalue())
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    if (result.stderr) console.error(result.stderr);

    // It is not a thousand.
    const checked = Number(result.stdout.match(/CHECKED: (\d+)/)?.[1] ?? "-1");
    // It stops somewhere.
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBeLessThanOrEqual(200);
    expect(checked).toBeLessThan(1000);
    // And it says that it did not look at all of them.
    expect(result.stdout).toContain("SAID:");
    expect(result.stdout).toMatch(/SAID:.*没查/s);
  });
});
