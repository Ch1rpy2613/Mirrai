import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

/**
 * The messages the collector keeps.
 *
 * It threw away anything shorter than two characters — so "好", "嗯",
 * "k" were dropped. A person wrote them, and the collector is building
 * the record of what they said.
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

describe.skipIf(!PYTHON)("the messages the Slack collector keeps", () => {
  it("keeps a message of one character", () => {
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
import slack_auto_collector as m
print("ONE:", m._is_noise("好"))
print("EMPTY:", m._is_noise("<https://example.com>"))
print("EMOJI:", m._is_noise(":wave:"))
print("TWO:", m._is_noise("好的"))
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });

    expect(result.stdout).toContain("ONE: False");
    expect(result.stdout).toContain("EMPTY: True");
    expect(result.stdout).toContain("EMOJI: True");
    expect(result.stdout).toContain("TWO: False");
  });
});
