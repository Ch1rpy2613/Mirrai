import { describe, expect, it } from "vitest";
import { runPythonSnippet, runPythonSnippetSync } from "./python-runner";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The encodings the collectors read.
 *
 * A Chinese subtitle file is very often GB18030 — it is what Windows
 * writes by default. Reading it as UTF-8 raised UnicodeDecodeError and
 * the whole conversion died: the user got "the conversion failed" and
 * no transcript.
 *
 * And a document downloaded from DingTalk comes back with no charset
 * in its header, so `resp.text` guessed ISO-8859-1 and the Chinese
 * came back as mojibake — and nothing said so.
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
  const result = runPythonSnippet(PYTHON!, body, {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

describe.skipIf(!PYTHON)("the subtitle files", () => {
  it("reads one that is not UTF-8", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-srt-"));
    const srtPath = path.join(workDir, "movie.srt");
    // A GB18030 subtitle — what Windows writes by default.
    runPythonSnippetSync(PYTHON!, `
import sys
text = "1\\n00:00:01,000 --> 00:00:03,000\\n这是一句中文字幕。\\n\\n2\\n00:00:04,000 --> 00:00:06,000\\n第二句。\\n"
open(sys.argv[1], "wb").write(text.encode("gb18030"))
`, { args: [srtPath] });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
sys.path.insert(0, ${JSON.stringify(path.join(TOOLS, "research"))})
import srt_to_transcript as s
from pathlib import Path
out = Path(${JSON.stringify(path.join(workDir, "out.txt"))})
s.convert_file(Path(${JSON.stringify(srtPath)}), out)
print(json.dumps({"text": out.read_text(encoding="utf-8")}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    // The Chinese came through.
    expect(JSON.parse(result.out.trim()).text).toContain("这是一句中文字幕。");
  });

  it("still reads one that is UTF-8", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-srt-"));
    const srtPath = path.join(workDir, "movie.srt");
    runPythonSnippetSync(PYTHON!, `
import sys
text = "1\\n00:00:01,000 --> 00:00:03,000\\n这是 UTF-8 的字幕。\\n"
open(sys.argv[1], "wb").write(text.encode("utf-8"))
`, { args: [srtPath] });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
sys.path.insert(0, ${JSON.stringify(path.join(TOOLS, "research"))})
import srt_to_transcript as s
from pathlib import Path
out = Path(${JSON.stringify(path.join(workDir, "out.txt"))})
s.convert_file(Path(${JSON.stringify(srtPath)}), out)
print(json.dumps({"text": out.read_text(encoding="utf-8")}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out.trim()).text).toContain("这是 UTF-8 的字幕。");
  });
});

describe.skipIf(!PYTHON)("the DingTalk documents", () => {
  it("reads one whose header says nothing about the encoding", () => {
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
import dingtalk_auto_collector as d

class FakeResponse:
    def __init__(self, raw, headers):
        self.content = raw
        self.headers = headers
        # What requests would have guessed: no charset, so ISO-8859-1.
        self.text = raw.decode("ISO-8859-1")

raw = "这是一份钉钉文档。".encode("utf-8")
print(json.dumps({
    "text": d.decode_response_text(FakeResponse(raw, {"Content-Type": "text/plain"})),
}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    // The Chinese came through — it used to be mojibake, and nothing
    // said so.
    expect(JSON.parse(result.out.trim()).text).toBe("这是一份钉钉文档。");
  });

  it("believes the charset the server says", () => {
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
import dingtalk_auto_collector as d

class FakeResponse:
    def __init__(self, raw, headers):
        self.content = raw
        self.headers = headers
        self.text = raw.decode("ISO-8859-1")

raw = "这是一份钉钉文档。".encode("gb18030")
print(json.dumps({
    "text": d.decode_response_text(FakeResponse(raw, {"Content-Type": "text/plain; charset=gb18030"})),
}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out.trim()).text).toBe("这是一份钉钉文档。");
  });
});

describe.skipIf(!PYTHON)("the mail export", () => {
  it("is read once, not once to guess and once to parse", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-mail-"));
    const mailPath = path.join(workDir, "mail.txt");
    runPythonSnippetSync(PYTHON!, `
import sys
open(sys.argv[1], "wb").write(b"From: a@b.c\\n\\n" + b"x" * 200000)
`, { args: [mailPath] });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import email_parser as m
from pathlib import Path

# Every read of the file is counted.
read_bytes = {"n": 0}
import builtins
real_open = builtins.open

class Counting:
    def __init__(self, handle):
        self._handle = handle
    def read(self, *args):
        data = self._handle.read(*args)
        read_bytes["n"] += len(data)
        return data
    def __getattr__(self, name):
        return getattr(self._handle, name)
    def __enter__(self):
        self._handle.__enter__()
        return self
    def __exit__(self, *args):
        return self._handle.__exit__(*args)

def counting_open(path, mode="r", *args, **kwargs):
    handle = real_open(path, mode, *args, **kwargs)
    if "b" in mode:
        return Counting(handle)
    return handle

builtins.open = counting_open
try:
    m.read_text_any(${JSON.stringify(mailPath)})
finally:
    builtins.open = real_open

print(json.dumps({"read": read_bytes["n"]}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).toBe("");
    const read = JSON.parse(result.out.trim()).read as number;
    /**
     * The file is read once.
     *
     * It used to be read twice — once to sniff the encoding and once
     * to parse it — so a large export was in memory twice over.
     */
    expect(read).toBeLessThan(300_000);
  });
});
