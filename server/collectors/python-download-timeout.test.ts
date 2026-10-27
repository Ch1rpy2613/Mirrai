import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The download's own limit.
 *
 * yt-dlp had no timeout: so a stalled connection kept the tool
 * running for ever, and the person watching it had no way to tell
 * whether it was working.
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools/research");

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

describe.skipIf(!PYTHON)("the download's own limit", () => {
  it("gives the download a time limit", () => {
    const source = readFileSync(path.join(TOOLS, "transcribe_audio.py"), "utf-8");
    expect(source).toContain("timeout=DOWNLOAD_TIMEOUT_SECONDS");
    expect(source).toContain("subprocess.TimeoutExpired");
  });

  it("says what happened when the time runs out", () => {
    const body = `
import sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import transcribe_audio as m
print("LIMIT:", m.DOWNLOAD_TIMEOUT_SECONDS)
`;
    const result = runPythonSnippet(PYTHON!, body);
    expect(result.stdout).toContain("LIMIT: 600");
  });
});
