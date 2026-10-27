import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The reader's time zone.
 *
 * The collectors turn an epoch into a wall clock, and the wall clock
 * they wrote was the *machine's* — so on a server in another country
 * every message landed at the wrong hour, and the server then read it
 * back in the reader's zone, which shifted it again.
 *
 * The zone is passed as an IANA *name*, and Python's `zoneinfo` has no
 * database of its own: on Windows there is none, and on Alpine there
 * is none unless it is installed. So the zone was ignored **in
 * silence** — the `except` swallowed the error and the machine's
 * clock was used instead.
 *
 * The server now also passes the reader's offset in minutes, which
 * needs no database at all.
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

const COLLECTORS = [
  "feishu_auto_collector.py",
  "slack_auto_collector.py",
  "dingtalk_auto_collector.py",
];

describe.skipIf(!PYTHON)("the reader's time zone", () => {
  it("falls back to the offset the server gave, not to the machine's clock", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-tz-"));
    for (const collector of COLLECTORS) {
      const body = `
import sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        _mod = types.ModuleType(_name)
        _mod.WebClient = object
        _mod.SlackApiError = Exception
        sys.modules[_name] = _mod
import ${collector.replace(".py", "")} as m
# A zone that no database has.
m._TIMEZONE_OVERRIDE = "Mars/Olympus_Mons"
m._TIMEZONE_OFFSET_MINUTES = 480
tz = m._reader_tz()
print("offset", tz.utcoffset(None).total_seconds() if tz else None)
`;
      const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
      /**
       * The old code returned None here — the `except` swallowed the
       * error — and the caller fell back to the machine's clock.
       */
      expect(result.stdout.trim(), collector).toBe("offset 28800.0");
      /**
       * And the reason is said out loud, because a collection with the
       * wrong hours in it is worse than one that says why.
       */
      expect(result.stderr, collector).toContain("Mars/Olympus_Mons");
    }
  });

  it("uses the zone itself when the database has it", () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "mirrai-tz-"));
    const body = `
import sys, types
sys.path.insert(0, ${JSON.stringify(TOOLS)})
for _name in ("requests", "slack_sdk", "slack_sdk.errors", "playwright", "pypinyin"):
    try:
        __import__(_name)
    except ImportError:
        sys.modules[_name] = types.ModuleType(_name)
import feishu_auto_collector as m
m._TIMEZONE_OVERRIDE = "UTC"
m._TIMEZONE_OFFSET_MINUTES = 480
tz = m._reader_tz()
print("name", getattr(tz, "key", None))
`;
    const result = spawnSync(PYTHON!, ["-c", body], { encoding: "utf-8" });
    expect(result.stdout.trim()).toBe("name UTC");
  });

  it("is given the offset by the server", () => {
    /**
     * The server computes the reader's own offset — the difference
     * between their clock and UTC, in minutes — and passes it beside
     * the zone name, because the offset needs no database at all.
     */
    const source = require("node:fs").readFileSync(
      path.resolve(process.cwd(), "server/collectors/types.ts"),
      "utf-8",
    );
    expect(source).toContain('argv.push("--timezone-offset"');
    expect(source).toContain("zonedOffsetMinutes");
  });

  it("ships the database where it can be installed", () => {
    const requirements = require("node:fs").readFileSync(
      path.resolve(process.cwd(), "skill-engine/requirements.txt"),
      "utf-8",
    );
    expect(requirements).toContain("tzdata");

    const dockerfile = require("node:fs").readFileSync(
      path.resolve(process.cwd(), "Dockerfile"),
      "utf-8",
    );
    expect(dockerfile).toContain("tzdata");
  });
});
