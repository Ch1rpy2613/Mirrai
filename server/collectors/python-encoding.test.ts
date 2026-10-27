import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The Python half of the collectors, and the encoding it writes in.
 *
 * `Path.write_text` without an encoding uses the *machine's* — which
 * on Windows is the ANSI code page, not UTF-8. A file holding Chinese
 * raised UnicodeEncodeError there, and the write did not happen.
 *
 * The worst case was the summary of a finished collection: it was
 * written *after* the messages had been collected and printed, so the
 * script exited non-zero and the server threw away a perfectly good
 * collection because a note about it could not be written.
 *
 * The test runs the collectors under `LC_ALL=C PYTHONUTF8=0`, which
 * makes the machine's encoding US-ASCII — the same situation, on any
 * platform.
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

/**
 * Runs a Python snippet with the machine's encoding turned down.
 *
 * The snippet is given the tools directory and the directory it may
 * write into; it returns its stdout.
 */
function runPython(body: string, workDir: string): { status: number; out: string; err: string } {
  /**
   * `LC_ALL=C` with the UTF-8 mode off makes the machine's encoding
   * US-ASCII — which is the situation on Windows, where the machine's
   * encoding is the ANSI code page.
   *
   * The *output* is still UTF-8, because that is the console, not the
   * files: the bug is about what `open()` writes.
   */
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: workDir,
    env: { ...process.env, LC_ALL: "C", LANG: "C", PYTHONUTF8: "0", PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe.skipIf(!PYTHON)("the collectors' own files", () => {
  const cases = [
    { module: "feishu_auto_collector", label: "feishu" },
    { module: "slack_auto_collector", label: "slack" },
    { module: "dingtalk_auto_collector", label: "dingtalk" },
  ];

  for (const { module, label } of cases) {
    it(`writes the ${label} credentials in UTF-8, whatever the machine's encoding is`, () => {
      const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-enc-"));
      const configPath = path.join(workDir, "config.json");
      const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
# The optional dependencies are stubbed: they are not what this test
# is about, and a machine without them must still be able to run it.
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import ${module} as m
from pathlib import Path
m._CONFIG_OVERRIDE = Path(${JSON.stringify(configPath)})
m.save_config({"name": "张三", "app_secret": "secret"})
print("ok")
`;
      const result = runPython(body, workDir);
      expect(result.err).toBe("");
      expect(result.out.trim()).toBe("ok");

      expect(existsSync(configPath)).toBe(true);
      const raw = readFileSync(configPath, "utf-8");
      // The Chinese name survived, and the file is valid UTF-8.
      expect(JSON.parse(raw).name).toBe("张三");
    });
  }

  it("keeps the Feishu app secret readable by its owner only", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-enc-"));
    const configPath = path.join(workDir, "config.json");
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m
from pathlib import Path
m.CONFIG_PATH = Path(${JSON.stringify(configPath)})
m.save_config({"app_id": "cli_x", "app_secret": "secret", "name": "张三"})
print("ok")
`;
    const result = runPython(body, workDir);
    expect(result.out).toContain("ok");

    expect(JSON.parse(readFileSync(configPath, "utf-8")).name).toBe("张三");
    /**
     * The file holds the app secret and the user token.
     *
     * The other three collectors chmod this same file to 0600; this
     * one did not, so running it *downgraded* the file they had
     * protected — every local user on the machine could read the
     * secret.
     */
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("reads a mail export that is not UTF-8", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-enc-"));
    const mailPath = path.join(workDir, "mail.txt");
    // A GB18030 export — what a Chinese Outlook or Foxmail writes.
    execFileSync(PYTHON!, ["-c", `
import sys
text = "From: zhangsan@example.com\\nSubject: 你好\\nDate: Mon, 1 Jan 2026 00:00:00 +0000\\n\\n这是一封中文邮件。\\n"
open(sys.argv[1], "wb").write(text.encode("gb18030"))
`, mailPath], { stdio: "ignore" });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m
rows = m.parse_txt_file(${JSON.stringify(mailPath)}, "zhangsan")
print(json.dumps(rows, ensure_ascii=False))
`;
    const result = runPython(body, workDir);
    /**
     * Reading it as UTF-8 raised UnicodeDecodeError, so the whole
     * export failed and the user got "the collector did not finish"
     * and no mails at all.
     */
    const rows = JSON.parse(result.out.trim());
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("the collectors' sources", () => {
  const sources = [
    "feishu_auto_collector.py",
    "slack_auto_collector.py",
    "dingtalk_auto_collector.py",
    "feishu_mcp_client.py",
    "email_parser.py",
  ];

  it("never writes a file without saying what encoding it is", () => {
    for (const name of sources) {
      const text = readFileSync(path.join(TOOLS, name), "utf-8");
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (!/\.write_text\(/.test(line)) return;
        // The call may span lines; look at the next few as well.
        const block = lines.slice(index, index + 4).join("\n");
        const isPathlibWrite = /\.write_text\(/.test(line);
        if (!isPathlibWrite) return;
        expect(
          block,
          `${name}:${index + 1} writes a file without an encoding`,
        ).toMatch(/encoding\s*=/);
      });
    }
  });
});
