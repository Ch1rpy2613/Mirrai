import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The Slack paging and the DingTalk document walk.
 *
 * Slack turned an API error in the middle of a page into "there are no
 * more" — so 600 members came back as 400, and the user was told
 * "张三 is not in this workspace" about a colleague who was in the 200
 * that were never fetched.
 *
 * And DingTalk read the first twenty files of the first five workspaces
 * and never looked at the cursor, so a colleague with twenty-five
 * documents had five of them — and the report said "共 12 篇".
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

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

function runPython(body: string): { status: number; out: string; err: string } {
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

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

describe.skipIf(!PYTHON)("the Slack paging", () => {
  it("says when it stopped short", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import slack_auto_collector as s

class FakeClient(s.RateLimitedClient):
    def __init__(self):
        self._client = None
        self.truncated_methods = set()
        self._last_call_failed = False
        self.pages = 0
    def call(self, method, **kwargs):
        self.pages += 1
        if self.pages <= 2:
            return {"members": [{"id": f"U{self.pages}"}], "response_metadata": {"next_cursor": f"c{self.pages}"}}
        # The third page fails.
        self._last_call_failed = True
        return {}

client = FakeClient()
members = client.paginate("users_list", "members", limit=200)
sys.stderr.write(json.dumps({
    "n": len(members),
    "truncated": sorted(client.truncated_methods),
}))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    // The two pages it got.
    expect(parsed.n).toBe(2);
    /**
     * It says it stopped short.
     *
     * The error was turned into an empty dictionary and the walk stopped
     * there — the same as "there are no more". So the caller was told
     * the list was complete.
     */
    expect(parsed.truncated).toContain("users_list");
  });

  it("does not say it stopped short when it reached the end", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import slack_auto_collector as s

class FakeClient(s.RateLimitedClient):
    def __init__(self):
        self._client = None
        self.truncated_methods = set()
        self._last_call_failed = False
        self.pages = 0
    def call(self, method, **kwargs):
        self.pages += 1
        if self.pages <= 2:
            return {"members": [{"id": f"U{self.pages}"}], "response_metadata": {"next_cursor": f"c{self.pages}"}}
        return {"members": []}

client = FakeClient()
members = client.paginate("users_list", "members", limit=200)
sys.stderr.write(json.dumps({
    "n": len(members),
    "truncated": sorted(client.truncated_methods),
}))
`;
    const result = runPython(body);
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.n).toBe(2);
    expect(parsed.truncated).toEqual([]);
  });

  it("stops when the same cursor comes back", () => {
    /**
     * The test is bounded.
     *
     * The old code had `while True` and no guard against the same
     * cursor coming back — so this snippet never ended. A test that
     * hangs is not a test that fails, so the snippet stops itself.
     */
    const body = `
import json, sys, types, signal
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import slack_auto_collector as s

# 停表：跑太久就是没停。
def _timeout(signum, frame):
    raise SystemExit("the walk did not stop")
signal.signal(signal.SIGALRM, _timeout)
signal.alarm(10)

class FakeClient(s.RateLimitedClient):
    def __init__(self):
        self._client = None
        self.truncated_methods = set()
        self._last_call_failed = False
        self.pages = 0
    def call(self, method, **kwargs):
        self.pages += 1
        # The same cursor, over and over.
        return {"members": [{"id": f"U{self.pages}"}], "response_metadata": {"next_cursor": "same"}}

client = FakeClient()
members = client.paginate("users_list", "members", limit=200)
sys.stderr.write(json.dumps({
    "n": len(members),
    "pages": client.pages,
    "truncated": sorted(client.truncated_methods),
}))
`;
    const result = runPython(body);
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    // It stopped rather than asking for the same page for ever.
    expect(parsed.pages).toBeLessThan(5);
    expect(parsed.truncated).toContain("users_list");
  });
});

describe.skipIf(!PYTHON)("the DingTalk documents", () => {
  it("reads past the first page of a workspace", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import dingtalk_auto_collector as d

calls = []

def fake_get(path, params, config):
    calls.append(params)
    if "workspaces" in path and path.endswith("/files"):
        token = params.get("pageToken")
        if not token:
            return {"files": [{"fileName": "一", "docId": "d1"}], "nextToken": "p2"}
        return {"files": [{"fileName": "二", "docId": "d2"}]}
    return {"result": []}

d.api_get = fake_get
# The global search finds nothing, so the workspace walk is used.
d.api_post = lambda path, body, config: {"result": {}}
d.list_workspaces = lambda config: [{"spaceId": "s1"}]

docs = d.search_docs_by_user("u1", "张三", 50, {})
sys.stderr.write(json.dumps({"calls": len(calls), "n": len(docs)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    // More than one page was read.
    expect(parsed.calls).toBeGreaterThan(1);
    expect(parsed.n).toBe(2);
  });

  it("says when a document could not be downloaded", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
${STUBS}
import dingtalk_auto_collector as d

def fake_get(path, params, config):
    if path.endswith("/content"):
        return {}
    if path.endswith("/download"):
        return {"downloadUrl": "https://example.invalid/doc"}
    return {}

d.api_get = fake_get

def boom(url, timeout=15):
    raise RuntimeError("network is down")

d.requests.get = boom

content = d.fetch_doc_content("doc1", "space1", {})
sys.stderr.write(json.dumps({"content": content}))
`;
    const result = runPython(body);
    /**
     * The reason is on the standard error.
     *
     * It used to be swallowed by `except Exception: pass`, so a network
     * error, a 403 and an expired download link all looked like "this
     * document has no text" — and the document was simply gone from the
     * colleague's profile, with nothing said anywhere.
     */
    expect(result.err).toContain("下载失败");
  });
});
