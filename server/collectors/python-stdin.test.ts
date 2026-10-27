import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";

/**
 * Waiting for the person.
 *
 * The server runs the collector with no standard input at all, so
 * `input()` raised EOFError: the collection died with a traceback at
 * the exact moment it needed the person in front of the browser.
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

describe.skipIf(!PYTHON)("waiting for the person", () => {
  it("does not die when there is nobody to press Enter", () => {
    const body = `
import sys, types
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
import dingtalk_auto_collector as m
# The standard input is closed, the way the server runs it.
sys.stdin = open("/dev/null")
print("WAITED:", m.wait_for_enter())
`;
    const result = spawnSync(PYTHON!, ["-c", body], {
      encoding: "utf-8",
      // The server's own setting: no standard input.
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.stderr).not.toContain("EOFError");
    expect(result.stdout).toContain("WAITED: False");
  });

  it("does not wait for Enter on its own anywhere", () => {
    /**
     * A bare `input()` is the thing that died: the standard input is
     * closed, so it raised EOFError and the collection stopped.
     */
    const source = readFileSync(path.join(TOOLS, "dingtalk_auto_collector.py"), "utf-8");
    // The one `input()` that is left is the one inside the guard.
    const helperStart = source.indexOf("def wait_for_enter");
    const helperEnd = source.indexOf("\ndef ", helperStart + 1);
    const helper = source.slice(helperStart, helperEnd);
    const rest = source.slice(0, helperStart) + source.slice(helperEnd);
    const bare = rest.split("\n").filter((line) => /^\s*input\(\)\s*$/.test(line));
    expect(bare).toEqual([]);
    // And the guard waits only when there is somebody there.
    expect(helper).toContain("input()");
    expect(source).toContain("isatty()");
  });
});
