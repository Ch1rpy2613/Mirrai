import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The skill package, and the version manager.
 *
 * A skill is a package: the documents, the skill files, the manifest and
 * the metadata. They were written one at a time, straight to their final
 * names — so a run that stopped halfway left a package with half of it
 * new and half of it old, and nothing said so.
 *
 * And a rollback that failed said goodbye with a success: the caller
 * believed the skill was back to the old version when it was not.
 */

const TOOLS = path.resolve(process.cwd(), "skill-engine/tools");

/** Whether python3 is there at all. */
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

/** Runs a Python snippet with the tools directory on its path. */
function runPython(body: string): { status: number; out: string; err: string } {
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe.skipIf(!PYTHON)("the skill package", () => {
  it("writes each file whole or not at all", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-atomic-"));
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import skill_writer as w
import skill_schema
from pathlib import Path

skill_dir = Path(${JSON.stringify(workDir)})

# The write is interrupted half way through the package.
calls = {"n": 0}
original = w.write_text_atomic

def exploding(path, content):
    calls["n"] += 1
    if calls["n"] == 3:
        raise RuntimeError("the disk filled up")
    return original(path, content)

w.write_text_atomic = exploding

meta = {
    "id": "skill.colleague.xiao-a",
    "kind": "skill",
    "character": "colleague",
    "preset": "colleague",
    "display_name": "小A",
    "name": "小A",
    "slug": "xiao-a",
    "version": "v1",
    "lifecycle": {"created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z", "version": "v1"},
    "engine": {"preset": "colleague", "character": "colleague"},
    "generation": {"character": "colleague", "preset": "colleague"},
    "artifacts": skill_schema.build_artifact_names({
        "character": "colleague",
        "slug": "xiao-a",
    }),
}

try:
    w.write_artifacts(skill_dir, meta, "work", "persona")
except RuntimeError:
    pass

# What is on the disk now?
print(json.dumps(sorted(p.name for p in skill_dir.iterdir()), ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const names = JSON.parse(result.out.trim()) as string[];
    // No half-written file was left behind: a temporary file is not a
    // file anybody reads.
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves the old file alone when the write fails", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-atomic-"));
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import version_manager as v
from pathlib import Path

skill_dir = Path(${JSON.stringify(workDir)})
target = skill_dir / "meta.json"
target.write_text('{"the": "old content"}', encoding="utf-8")

# The write fails half way through.
import json as _json
real_dumps = _json.dumps
def exploding_dumps(data, **kwargs):
    raise RuntimeError("the disk filled up")
_json.dumps = exploding_dumps
has_helper = hasattr(v, "write_json_atomic")
if has_helper:
    try:
        v.write_json_atomic(target, {"the": "new content"})
    except Exception:
        pass
_json.dumps = real_dumps

sys.stderr.write(json.dumps({"hasHelper": has_helper}, ensure_ascii=False))
print(target.read_text(encoding="utf-8"))
`;
    const result = runPython(body);
    // The write is atomic: it exists, and the old content is still
    // there — it was never half-overwritten.
    expect(JSON.parse(result.err.trim()).hasHelper).toBe(true);
    expect(result.out.trim()).toContain("old content");
  });
});

describe.skipIf(!PYTHON)("the version manager", () => {
  it("says so when a rollback fails", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-vm-"));
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import version_manager as v
from pathlib import Path

base_dir = Path(${JSON.stringify(workDir)})
skill_dir = base_dir / "xiao-a"
skill_dir.mkdir(parents=True, exist_ok=True)

# A version that is not there.
sys.argv = [
    "version_manager.py",
    "--action", "rollback",
    "--slug", "xiao-a",
    "--base-dir", str(base_dir),
    "--version", "v9",
]
try:
    v.main()
except SystemExit as e:
    print("EXIT:", e.code)
`;
    const result = runPython(body);
    // The rollback failed — so the script says so. It used to say
    // goodbye with a success, and the caller believed the skill was
    // back to the old version when it was not.
    expect(result.out).toContain("EXIT: 1");
  });

  it("says so when a backup fails", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-vm-"));
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import version_manager as v
from pathlib import Path

base_dir = Path(${JSON.stringify(workDir)})
skill_dir = base_dir / "xiao-a"
skill_dir.mkdir(parents=True, exist_ok=True)

# There is no meta.json, so the version is not known.
sys.argv = [
    "version_manager.py",
    "--action", "backup",
    "--slug", "xiao-a",
    "--base-dir", str(base_dir),
]
try:
    v.main()
except SystemExit as e:
    print("EXIT:", e.code)
`;
    const result = runPython(body);
    expect(result.out).toContain("EXIT: 1");
  });
});
