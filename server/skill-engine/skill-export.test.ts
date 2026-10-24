import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPythonTool } from "./runner";
import { exportSkillToHost, isSkillExportHost } from "./skill-export";

vi.mock("./runner", () => ({
  runPythonTool: vi.fn(),
}));

const mockedRunPythonTool = vi.mocked(runPythonTool);

let skillDir: string;

beforeEach(() => {
  mockedRunPythonTool.mockReset();
  skillDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-export-"));
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: celebrity_test\n---\n\n内容\n", "utf-8");
  fs.writeFileSync(
    path.join(skillDir, "meta.json"),
    JSON.stringify({ artifacts: { combined_command: "celebrity-test" } }),
    "utf-8",
  );
});

afterEach(() => {
  fs.rmSync(skillDir, { recursive: true, force: true });
});

describe("isSkillExportHost", () => {
  it("accepts the four supported hosts", () => {
    expect(isSkillExportHost("claude-code")).toBe(true);
    expect(isSkillExportHost("openclaw")).toBe(true);
    expect(isSkillExportHost("codex")).toBe(true);
    expect(isSkillExportHost("hermes")).toBe(true);
    expect(isSkillExportHost("nope")).toBe(false);
  });
});

describe("exportSkillToHost", () => {
  it("installs into claude-code and returns the installed path", async () => {
    mockedRunPythonTool.mockResolvedValue({
      stdout: "celebrity-test\n/home/user/.claude/skills/celebrity-test\n",
      stderr: "",
    });

    const result = await exportSkillToHost({ skillPath: skillDir, host: "claude-code" });

    expect(mockedRunPythonTool).toHaveBeenCalledWith("install_claude_generated_skill.py", [
      "--skill-dir",
      skillDir,
      "--force",
    ]);
    expect(result.installedPath).toBe("/home/user/.claude/skills/celebrity-test");
    expect(result.commandName).toBe("celebrity-test");
    // The source package is still there, so the UI can offer a manual copy.
    expect(result.skillContent).toContain("celebrity_test");
  });

  it("installs into the hermes skill root", async () => {
    mockedRunPythonTool.mockResolvedValue({
      stdout: "/home/user/.hermes/skills/openclaw-imports/celebrity-test\n",
      stderr: "",
    });

    const result = await exportSkillToHost({ skillPath: skillDir, host: "hermes" });

    const [tool, args] = mockedRunPythonTool.mock.calls[0];
    expect(tool).toBe("install_hermes_skill.py");
    expect(args).toContain("--source");
    expect(args).toContain(skillDir);
    expect(result.installedPath).toContain("celebrity-test");
  });

  it("fails with a clear message when the package is missing", async () => {
    await expect(
      exportSkillToHost({ skillPath: path.join(skillDir, "nope"), host: "codex" }),
    ).rejects.toThrow(/SKILL\.md/);
    expect(mockedRunPythonTool).not.toHaveBeenCalled();
  });
});
