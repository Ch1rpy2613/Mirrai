import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The hand-written chat log.
 *
 * A message that wraps onto the next line was two messages: the first
 * line was cut short, and the continuation became a message of its own
 * — and because it did not carry the person's name, it was dropped.
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

describe.skipIf(!PYTHON)("the hand-written chat log", () => {
  it("keeps a wrapped message in one piece", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-txt-"));
    const file = path.join(dir, "messages.txt");
    writeFileSync(
      file,
      [
        "2024-01-01 10:00 张三：你今天",
        "有空吗",
        "2024-01-01 10:05 李四：我在",
        "",
      ].join("\n"),
      "utf-8",
    );

    const body = `
import sys, json
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_parser as m
rows = m.parse_feishu_txt(${JSON.stringify(file)}, "张三")
print("COUNT:", len(rows))
for row in rows:
    print("ROW:", json.dumps(row, ensure_ascii=False))
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });

    // One message, and it carries both lines.
    expect(result.stdout).toContain("COUNT: 1");
    expect(result.stdout).toContain("你今天\\n有空吗");
  });

  it("still reads a file that has no timestamps at all", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-txt-"));
    const file = path.join(dir, "plain.txt");
    writeFileSync(file, ["张三：在吗", "张三：真的在吗"].join("\n"), "utf-8");

    const body = `
import sys, json
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import feishu_parser as m
rows = m.parse_feishu_txt(${JSON.stringify(file)}, "张三")
print("COUNT:", len(rows))
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });

    // Every line is a message of its own.
    expect(result.stdout).toContain("COUNT: 2");
  });
});
