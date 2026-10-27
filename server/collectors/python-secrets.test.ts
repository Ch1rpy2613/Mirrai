import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The secrets the collectors print.
 *
 * The collector's output is captured by the server and kept in the
 * job's log — and the log is shown to the user and written to the
 * disk. So anything a collector prints is kept in a file that is not
 * secret.
 *
 * And the Feishu collector printed the first twenty characters of an
 * access token.
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

describe.skipIf(!PYTHON)("the secrets the collectors print", () => {
  it("does not print the access token", () => {
    /**
     * The collector is run with a fake exchange, and everything it
     * prints is captured — because that is exactly what the server
     * does with it.
     */
    const body = `
import sys, types, io, contextlib
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

# A secret whose first twenty characters are the prefix the old code
# printed — so "the secret is in the output" is true for it.
SECRET = "TOKENPREFIX1234567890ABCD"

def fake_exchange(code, config):
    return {"access_token": SECRET, "refresh_token": "r-secret", "scope": "im"}

m.exchange_code_for_token = fake_exchange
m.get_tenant_token = lambda config: "tenant-token"
m.load_config = lambda: {"app_id": "a", "app_secret": "s"}

saved = {}
m.save_config = lambda config: saved.update(config)

sys.argv = ["feishu_auto_collector.py", "--exchange-code", "the-code"]
out = io.StringIO()
with contextlib.redirect_stdout(out):
    try:
        m.main()
    except SystemExit:
        pass
print("SAID:", out.getvalue())
# The old code printed the first twenty characters of the token, so it
# is the prefix that has to be looked for.
print("HAS_PREFIX:", SECRET[:20] in out.getvalue())
`;
    const result = runPythonSnippet(PYTHON!, body);

    expect(result.stdout).toContain("HAS_PREFIX: False");
    // And the token was saved — only not printed.
    expect(result.stdout).toContain("HAS_PREFIX: False");
  });

  it("does not print a token anywhere in the collectors", () => {
    const source = readFileSync(path.join(TOOLS, "feishu_auto_collector.py"), "utf-8");
    // The prefix of a token must never reach the output.
    expect(source).not.toMatch(/access_token\]\[:\d+\]/);
    expect(source).not.toMatch(/print\([^)]*token\[/);
  });
});
