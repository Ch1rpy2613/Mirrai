import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The browser the collector drives.
 *
 * It used to open a browser on the *operator's own* Chrome profile —
 * the folder they use every day — and write to it: their cookies,
 * their history, their login for every site they visit.
 *
 * And the path it used was not even the right one: `…/Chrome/Default`
 * is a profile, not the user data directory Playwright wants, so it
 * never held a login either.
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

describe.skipIf(!PYTHON)("the browser the collector drives", () => {
  it("keeps a profile of its own instead of the operator's Chrome", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-profile-"));
    const body = `
import os, sys
os.environ["MIRRAI_DATA_ROOT"] = ${JSON.stringify(dir)}
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_browser as b
print("PROFILE:", b.get_default_chrome_profile())
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });

    // It is the tool's own folder, inside the app's own data root.
    expect(result.stdout).toContain(dir);
    // And not the operator's Chrome.
    expect(result.stdout).not.toContain("Google/Chrome");
    expect(result.stdout).not.toContain(".config/google-chrome");
  });

  it("does not open the operator's Chrome even without the data root", () => {
    const body = `
import os, sys
os.environ.pop("MIRRAI_DATA_ROOT", None)
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_browser as b
print("PROFILE:", b.get_default_chrome_profile())
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });

    expect(result.stdout).toContain(".mirrai");
    expect(result.stdout).not.toContain("Google/Chrome");
  });
});
