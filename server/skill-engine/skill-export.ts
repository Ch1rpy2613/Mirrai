/**
 * Skill package export (Phase 2.4).
 *
 * A finished pipeline leaves a generated skill directory behind: `SKILL.md`,
 * `work.md`, `persona.md`, `meta.json` and `manifest.json`. This module
 * installs that directory into one of the supported hosts and returns the
 * installed path together with the `SKILL.md` content, so the UI can offer a
 * manual copy when the host installation is not what the user wants.
 *
 * The host installers differ in what they copy:
 *   - `install_*_generated_skill.py` install the generated skill package and
 *     rewrite the frontmatter name to the host command name.
 *   - `install_hermes_skill.py` copies a skill repository, so it is pointed at
 *     the generated skill directory and given an explicit destination.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { runPythonTool } from "./runner";

/** The hosts a generated skill can be installed into. */
export const SKILL_EXPORT_HOSTS = ["claude-code", "openclaw", "codex", "hermes"] as const;

export type SkillExportHost = (typeof SKILL_EXPORT_HOSTS)[number];

export type SkillExportResult = {
  host: SkillExportHost;
  /** The directory the skill was installed into. */
  installedPath: string;
  /** The slash command the host exposes for the skill, when known. */
  commandName: string | null;
  /** The installed `SKILL.md` content (frontmatter rewritten for the host). */
  skillContent: string;
};

export type SkillExportInput = {
  /** The generated skill directory produced by the pipeline. */
  skillPath: string;
  host: SkillExportHost;
};

/** Narrows an arbitrary string to a supported host. */
export function isSkillExportHost(value: string): value is SkillExportHost {
  return (SKILL_EXPORT_HOSTS as readonly string[]).includes(value);
}

/** Reads the host command name from the generated metadata. */
function readCommandName(skillPath: string): string | null {
  const metaPath = path.join(skillPath, "meta.json");
  try {
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
      artifacts?: { combined_command?: string };
    };
    const command = meta.artifacts?.combined_command;
    return typeof command === "string" && command ? command : null;
  } catch (e) {
    console.warn("[SkillEngine] Could not read the generated skill metadata:", e);
    return null;
  }
}

/** Splits installer output into its non-empty lines. */
function outputLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Installs the generated skill into the requested host. */
export async function exportSkillToHost(input: SkillExportInput): Promise<SkillExportResult> {
  const skillPath = path.resolve(input.skillPath);
  const skillFile = path.join(skillPath, "SKILL.md");

  if (!fs.existsSync(skillPath) || !fs.existsSync(skillFile)) {
    throw new Error(`技能包不存在或缺少 SKILL.md：${skillPath}`);
  }

  const commandName = readCommandName(skillPath);
  let installedPath = "";
  // The generated installers print the command name first; the metadata is the
  // fallback for hosts that only report the install directory.
  let reportedCommand: string | null = null;

  switch (input.host) {
    case "claude-code": {
      const { stdout } = await runPythonTool("install_claude_generated_skill.py", [
        "--skill-dir",
        skillPath,
        "--force",
      ]);
      // Prints the command name, the install directory and — on Windows — the
      // slash-command shim path.
      const lines = outputLines(stdout);
      reportedCommand = lines[0] ?? null;
      installedPath = lines[1] ?? lines[0] ?? "";
      break;
    }
    case "openclaw": {
      const { stdout } = await runPythonTool("install_openclaw_generated_skill.py", [
        "--skill-dir",
        skillPath,
        "--force",
      ]);
      const lines = outputLines(stdout);
      reportedCommand = lines[0] ?? null;
      installedPath = lines[1] ?? lines[0] ?? "";
      break;
    }
    case "codex": {
      const { stdout } = await runPythonTool("install_codex_generated_skill.py", [
        "--skill-dir",
        skillPath,
        "--force",
      ]);
      const lines = outputLines(stdout);
      reportedCommand = lines[0] ?? null;
      installedPath = lines[1] ?? lines[0] ?? "";
      break;
    }
    case "hermes": {
      // Hermes has no generated-skill installer, so the repository installer
      // copies the generated directory into the Hermes skill root.
      const destination = path.join(
        os.homedir(),
        ".hermes",
        "skills",
        "openclaw-imports",
        commandName ?? path.basename(skillPath),
      );
      const { stdout } = await runPythonTool("install_hermes_skill.py", [
        "--source",
        skillPath,
        "--dest",
        destination,
        "--force",
      ]);
      installedPath = outputLines(stdout)[0] ?? destination;
      break;
    }
  }

  if (!installedPath) {
    throw new Error(`安装器没有返回安装路径：${input.host}`);
  }

  const installedSkillFile = path.join(installedPath, "SKILL.md");
  const skillContent = fs.existsSync(installedSkillFile)
    ? fs.readFileSync(installedSkillFile, "utf-8")
    : fs.readFileSync(skillFile, "utf-8");

  return {
    host: input.host,
    installedPath,
    commandName: commandName ?? reportedCommand,
    skillContent,
  };
}
