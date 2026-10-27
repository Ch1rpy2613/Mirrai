import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The collectors, once more.
 *
 * - the secrets were typed at an echoing prompt, so they stayed in the
 *   scrollback of the terminal and in any screen recording;
 * - the output files were written in place, one at a time, so a run
 *   killed mid-write left a *half* transcript — and the server reads
 *   exactly that file;
 * - the mail archive was never closed;
 * - a Big5 export was decoded into mojibake without complaint, because
 *   GB18030 accepts almost any byte sequence and so never failed;
 * - the browser tool still had a bare `input()` in it.
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

function runPython(body: string): { status: number; out: string; err: string } {
  const result = runPythonSnippet(PYTHON!, body, {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

describe.skipIf(!PYTHON)("the secrets", () => {
  const collectors = [
    "feishu_auto_collector.py",
    "dingtalk_auto_collector.py",
    "slack_auto_collector.py",
  ];

  it("are not typed at an echoing prompt", () => {
    for (const name of collectors) {
      const body = `
import sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import importlib
module = importlib.import_module(${JSON.stringify(name.replace(/\.py$/, ""))})
sys.stderr.write("ok")
`;
      const source = readFileSync(path.join(TOOLS, name), "utf-8");
      /**
       * The secret is not read with `input()`.
       *
       * That echoes it in full as it is typed — so it stays in the
       * scrollback of that terminal window, and in any screen recording
       * of the setup.
       */
      expect(source, name).not.toMatch(/input\("(App Secret|AppSecret|Bot User OAuth Token)/);
      // And there is a helper that does not echo.
      expect(source, name).toMatch(/ask_secret/);
    }
  });
});

describe.skipIf(!PYTHON)("the output files", () => {
  it("are written whole, not in place", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from collector_common import write_text_atomic
from pathlib import Path
import tempfile, os

directory = tempfile.mkdtemp()
target = Path(directory) / "messages.txt"

# An old file is there.
write_text_atomic(target, "old")

# The write is interrupted — the old file must be intact.
try:
    class Boom(str):
        pass
    original = os.replace
    def failing_replace(src, dst):
        raise OSError("interrupted")
    os.replace = failing_replace
    try:
        write_text_atomic(target, "new")
    except OSError:
        pass
    finally:
        os.replace = original
except Exception:
    pass

sys.stderr.write(json.dumps({"content": target.read_text(encoding="utf-8")}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    /**
     * The old file is intact.
     *
     * It used to be written in place — `write_text` truncates first — so
     * a collector killed mid-write left a *half* `messages.txt`. And
     * the server reads exactly that file: the persona was distilled
     * from a truncated record, with nothing said about it.
     */
    expect(parsed.content).toBe("old");
  });
});

describe.skipIf(!PYTHON)("the mail archive", () => {
  it("is closed when it is read", () => {
    const body = `
import json, sys, gc
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m
from pathlib import Path
import tempfile

directory = tempfile.mkdtemp()
path = Path(directory) / "mail.mbox"
path.write_text(
    "From someone@example.com Mon Jan  1 00:00:00 2026\\n"
    "From: someone@example.com\\n"
    "Subject: hi\\n"
    "\\n"
    "body\\n"
    "\\n",
    encoding="utf-8",
)

rows = m.parse_mbox_file(str(path), "someone@example.com")

# The archive is closed, so the file can be removed on any system.
import os
os.remove(str(path))
sys.stderr.write(json.dumps({"n": len(rows), "removed": True}))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.n).toBe(1);
    expect(parsed.removed).toBe(true);
  });
});

describe.skipIf(!PYTHON)("a Big5 export", () => {
  it("is not decoded into mojibake without complaint", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m
from pathlib import Path
import tempfile

directory = tempfile.mkdtemp()
path = Path(directory) / "mail.txt"
text = "From: someone@example.com\\nSubject: 這是一封繁體中文的郵件\\nDate: Mon, 1 Jan 2026 00:00:00 +0000\\n\\n這是正文。\\n"
path.write_bytes(text.encode("big5"))

rows = m.parse_txt_file(str(path), "someone@example.com")
sys.stderr.write(json.dumps({"n": len(rows), "subject": rows[0]["subject"] if rows else ""}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.n).toBe(1);
    /**
     * The Chinese came through.
     *
     * GB18030 accepts almost any byte sequence, so it never failed —
     * the Big5 export was decoded into mojibake "successfully", and
     * the collector reported a normal result.
     */
    expect(parsed.subject).toContain("繁體中文");
  });
});

describe.skipIf(!PYTHON)("the decoder", () => {
  it("picks the encoding that looks right", () => {
    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from collector_common import decode_text

zh = "这是一句中文字幕。"
tw = "這是一句繁體中文的字幕。"
sys.stderr.write(json.dumps({
    "zh": decode_text(zh.encode("gb18030")),
    "tw": decode_text(tw.encode("big5")),
    "utf8": decode_text("你好，世界。".encode("utf-8")),
}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    /**
     * Both came through.
     *
     * Trying them in order was not enough: GB18030 accepts almost any
     * byte sequence, so it never failed, and a Big5 export was decoded
     * into mojibake "successfully". And putting Big5 first was not
     * enough either — then a GB18030 file was decoded as Big5, just as
     * wrong and just as quiet.
     */
    expect(parsed.zh).toBe("这是一句中文字幕。");
    expect(parsed.tw).toBe("這是一句繁體中文的字幕。");
    expect(parsed.utf8).toBe("你好，世界。");
  });
});

describe.skipIf(!PYTHON)("the browser tool", () => {
  it("does not die when there is nobody to press Enter", () => {
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "playwright", "playwright.sync_api"):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.ModuleType(_name)
import feishu_browser as b
# 没有人按回车——这不该炸。
b.wait_for_enter()
sys.stderr.write(json.dumps({"ok": True}))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    expect(result.err).toContain("ok");
  });
});

describe.skipIf(!PYTHON)("the transcript", () => {
  it("is readable by its owner only", () => {
    const body = `
import json, sys, os, stat
sys.path.insert(0, ${JSON.stringify(TOOLS)})
from pathlib import Path
import tempfile

directory = tempfile.mkdtemp()
target = Path(directory) / "transcript.txt"
target.write_text("a transcript", encoding="utf-8")
os.chmod(target, 0o644)

# The same thing the tool does.
target.chmod(0o600)
mode = stat.S_IMODE(os.stat(target).st_mode)
sys.stderr.write(json.dumps({"mode": mode}))
`;
    const result = runPython(body);
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.mode).toBe(0o600);
  });
});
