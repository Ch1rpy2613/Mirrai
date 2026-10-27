import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "path";

/**
 * The installation of a generated skill.
 *
 * It deleted the skill that was already there and *then* wrote the new
 * one. So when the write failed — the disk was full, the permission was
 * wrong, the process was killed — the user's working skill was gone and
 * the new one had never been written. There was nothing to fall back
 * to.
 *
 * The new one is written beside the old one and swapped in.
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

describe.skipIf(!PYTHON)("the installation of a generated skill", () => {
  it("keeps the old skill when the new one cannot be written", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-install-"));
    const skillsDir = path.join(dir, "skills");
    const skillDir = path.join(dir, "generated");

    const body = `
import json, os, sys, stat
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import install_generated_skill_common as m

skill_dir = Path(${JSON.stringify(skillDir)})
skills_dir = Path(${JSON.stringify(skillsDir)})
skill_dir.mkdir(parents=True, exist_ok=True)

# The generated skill.
(skill_dir / "meta.json").write_text(json.dumps({
    "character": "colleague",
    "display_name": "同事",
    "slug": "colleague-x",
    "version": "v1",
    "artifacts": {
        "combined_command": "colleague-x",
        "combined_skill": "work_skill.md",
    },
}), encoding="utf-8")
(skill_dir / "work_skill.md").write_text("---\\nname: x\\n---\\n\\n新内容\\n", encoding="utf-8")

# An install that is already there.
install_dir = skills_dir / "colleague-x"
install_dir.mkdir(parents=True, exist_ok=True)
(install_dir / "SKILL.md").write_text("旧内容", encoding="utf-8")

# The write of the new file fails.
def boom(*args, **kwargs):
    raise OSError("磁盘满了")
m.Path.write_text = boom

try:
    m.install_generated_skill(skill_dir, skills_dir, force=True, host="hermes")
    print("RESULT: no-error")
except Exception as e:
    print("RESULT: error", type(e).__name__)

print("EXISTS:", (install_dir / "SKILL.md").exists())
if (install_dir / "SKILL.md").exists():
    print("CONTENT:", (install_dir / "SKILL.md").read_text(encoding="utf-8"))
`;
    const result = runPythonSnippet(PYTHON!, body);
    if (result.stderr) console.error(result.stderr);

    /**
     * The old install is still there — with its own content. Before the
     * fix the directory had been removed and the new one was never
     * written, so the user was left with nothing.
     */
    expect(result.stdout).toContain("EXISTS: True");
    expect(result.stdout).toContain("旧内容");
  });

  it("installs the new skill when the write works", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-install-"));
    const skillsDir = path.join(dir, "skills");
    const skillDir = path.join(dir, "generated");

    const body = `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import install_generated_skill_common as m

skill_dir = Path(${JSON.stringify(skillDir)})
skills_dir = Path(${JSON.stringify(skillsDir)})
skill_dir.mkdir(parents=True, exist_ok=True)

(skill_dir / "meta.json").write_text(json.dumps({
    "character": "colleague",
    "display_name": "同事",
    "slug": "colleague-x",
    "version": "v1",
    "artifacts": {
        "combined_command": "colleague-x",
        "combined_skill": "work_skill.md",
    },
}), encoding="utf-8")
(skill_dir / "work_skill.md").write_text("---\\nname: x\\n---\\n\\n新内容\\n", encoding="utf-8")

install_dir = skills_dir / "colleague-x"
install_dir.mkdir(parents=True, exist_ok=True)
(install_dir / "SKILL.md").write_text("旧内容", encoding="utf-8")

m.install_generated_skill(skill_dir, skills_dir, force=True, host="hermes")

print("CONTENT:", (install_dir / "SKILL.md").read_text(encoding="utf-8"))
print("METADATA:", (install_dir / ".dot-skill-install.json").exists())
`;
    const result = runPythonSnippet(PYTHON!, body);
    if (result.stderr) console.error(result.stderr);

    expect(result.stdout).toContain("新内容");
    expect(result.stdout).toContain("METADATA: True");
  });
});
