import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The WeChat export, and the Feishu MCP setup.
 *
 * The export parser read the file as UTF-8 only — so a GBK export (what
 * a Chinese Windows machine writes) raised UnicodeDecodeError, the
 * script died, and the user saw "the collector feishu_parser.py did
 * not finish (exit code 1)" with nothing saying the encoding was the
 * problem.
 *
 * And the MCP client's `--setup` overwrote the *shared* credential file
 * with a fresh dict: the app secret, the user token and the private
 * chat id all went, and it printed "✅ 配置完成！" while it did it.
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
  const result = spawnSync(PYTHON!, ["-c", body], {
    cwd: path.resolve(process.cwd(), "skill-engine/tools"),
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    encoding: "utf-8",
  });
  return { status: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe.skipIf(!PYTHON)("the WeChat export parser", () => {
  it("reads a JSON export that is not UTF-8", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-fx-"));
    const file = path.join(dir, "export.json");
    // A GBK export — what a Chinese Windows machine writes.
    execFileSync(PYTHON!, ["-c", `
import sys
text = '[{"sender": "zhangsan", "content": "\\u4f60\\u597d\\uff0c\\u4e16\\u754c", "timestamp": "2026-03-14T10:00:00"}]'
open(sys.argv[1], "wb").write(text.encode("gb18030"))
`, file], { stdio: "ignore" });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_parser as p
messages = p.parse_feishu_json(${JSON.stringify(file)}, "zhangsan")
sys.stderr.write(json.dumps({"n": len(messages), "content": messages[0]["content"] if messages else ""}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.n).toBe(1);
    expect(parsed.content).toContain("你好");
  });

  it("reads a TXT export that is not UTF-8", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-fx-"));
    const file = path.join(dir, "export.txt");
    execFileSync(PYTHON!, ["-c", `
import sys
text = "2026-03-14 10:00 \\u5f20\\u4e09\\uff1a\\u4f60\\u597d\\uff0c\\u4e16\\u754c\\n"
open(sys.argv[1], "wb").write(text.encode("gb18030"))
`, file], { stdio: "ignore" });

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_parser as p
messages = p.parse_feishu_txt(${JSON.stringify(file)}, "\\u5f20\\u4e09")
sys.stderr.write(json.dumps({"n": len(messages)}, ensure_ascii=False))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");
    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    expect(parsed.n).toBe(1);
  });
});

describe.skipIf(!PYTHON)("the Feishu MCP setup", () => {
  it("does not wipe the credentials it shares with the other collector", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-mcp-"));
    const configPath = path.join(dir, "feishu_config.json");
    // What the file held: the app secret, the user token and the
    // private chat id.
    writeFileSync(
      configPath,
      JSON.stringify({
        app_id: "cli_x",
        app_secret: "s3cr3t",
        user_access_token: "u-abc",
        p2p_chat_id: "oc_xyz",
        mode: "app",
      }),
      "utf-8",
    );

    const body = `
import json, sys
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_mcp_client as m
from pathlib import Path
m.CONFIG_PATH = Path(${JSON.stringify(configPath)})
# 没有人回答——服务器跑采集器的时候就是这样的。
m.setup_config()
sys.stderr.write(json.dumps(json.loads(m.CONFIG_PATH.read_text(encoding="utf-8"))))
`;
    const result = runPython(body);
    expect(result.err).not.toContain("Traceback");

    const parsed = JSON.parse(result.err.slice(result.err.lastIndexOf("{")).trim());
    /**
     * The credentials are still there.
     *
     * The setup overwrote the *shared* file with a fresh dict: the app
     * secret, the user token and the private chat id all went — and it
     * printed "✅ 配置完成！" while it did it. After that the auto
     * collector could not get a token and the private-chat collection
     * was permanently off.
     */
    expect(parsed.app_secret).toBe("s3cr3t");
    expect(parsed.user_access_token).toBe("u-abc");
    expect(parsed.p2p_chat_id).toBe("oc_xyz");
    // And it did not claim to have finished.
    expect(result.out).not.toContain("配置完成");
  });
});
