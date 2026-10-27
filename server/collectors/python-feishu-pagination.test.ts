import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "path";

/**
 * The pagination of the Feishu collector.
 *
 * The loop went on while the answer said "there is more", and took the
 * next page token from that answer. Feishu sometimes says "there is
 * more" and gives no token — or gives the same one again — so the loop
 * asked the same question again, and again, and again: the collection
 * never ended, and every round added a hundred more chats to the list
 * in memory.
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

describe.skipIf(!PYTHON)("the pagination of the Feishu collector", () => {
  it("stops when the answer says there is more but gives no new page", () => {
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

calls = {"chats": 0}

def fake_get(path, params, config):
    if path == "/im/v1/chats":
        calls["chats"] += 1
        if calls["chats"] > 20:
            # The old code never stopped; the cap turns that into a
            # failure instead of a test that never ends.
            raise RuntimeError("the collector asked for the same page again and again")
        # "There is more" — and no page token to get it with.
        return {
            "code": 0,
            "data": {
                "items": [{"chat_id": f"c{calls['chats']}", "name": "群"}],
                "has_more": True,
            },
        }
    return {"code": 0, "data": {"items": [], "has_more": False}}

m.api_get = fake_get

out = io.StringIO()
err = io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    m.get_chats_with_user("open-id", {})
print("CALLS:", calls["chats"])
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    if (result.stderr) console.error(result.stderr);

    const calls = Number(result.stdout.match(/CALLS: (\d+)/)?.[1] ?? "-1");
    /**
     * Before the fix this never ended — the same question was asked
     * over and over.
     */
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it("stops when the answer gives the same page token again", () => {
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

calls = {"chats": 0}

def fake_get(path, params, config):
    if path == "/im/v1/chats":
        calls["chats"] += 1
        if calls["chats"] > 20:
            # The old code never stopped; the cap turns that into a
            # failure instead of a test that never ends.
            raise RuntimeError("the collector asked for the same page again and again")
        # "There is more" — and the same token as last time.
        return {
            "code": 0,
            "data": {
                "items": [{"chat_id": f"c{calls['chats']}", "name": "群"}],
                "has_more": True,
                "page_token": "the-same-one",
            },
        }
    return {"code": 0, "data": {"items": [], "has_more": False}}

m.api_get = fake_get

out = io.StringIO()
err = io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    m.get_chats_with_user("open-id", {})
print("CALLS:", calls["chats"])
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    if (result.stderr) console.error(result.stderr);

    const calls = Number(result.stdout.match(/CALLS: (\d+)/)?.[1] ?? "-1");
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it("goes on to the next page when the token really is new", () => {
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

calls = {"chats": 0}

def fake_get(path, params, config):
    if path == "/im/v1/chats":
        calls["chats"] += 1
        if calls["chats"] > 20:
            # The old code never stopped; the cap turns that into a
            # failure instead of a test that never ends.
            raise RuntimeError("the collector asked for the same page again and again")
        if calls["chats"] == 1:
            return {
                "code": 0,
                "data": {
                    "items": [{"chat_id": "c1", "name": "群1"}],
                    "has_more": True,
                    "page_token": "page-2",
                },
            }
        return {
            "code": 0,
            "data": {
                "items": [{"chat_id": "c2", "name": "群2"}],
                "has_more": False,
            },
        }
    return {"code": 0, "data": {"items": [], "has_more": False}}

m.api_get = fake_get

out = io.StringIO()
err = io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    m.get_chats_with_user("open-id", {})
print("CALLS:", calls["chats"])
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    if (result.stderr) console.error(result.stderr);

    // Both pages were read.
    expect(result.stdout).toContain("CALLS: 2");
  });
});
