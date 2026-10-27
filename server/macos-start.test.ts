import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The macOS start script.
 *
 * `set -euo pipefail` ends the shell at the first failing command — so
 * the `if [ $? -ne 0 ]` that used to follow the database initialisation
 * was **dead code**. The Terminal window closed with no message at all:
 * the log was never shown, and the user had no idea that the first
 * launch had failed.
 *
 * The script is run here, with a PostgreSQL that fails, so the test is
 * about what the person sees and not about the shape of the code.
 */

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/macos/start.sh");

function bash(): string | null {
  for (const candidate of ["bash", "/bin/bash"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const BASH = bash();

/**
 * A bundle whose PostgreSQL fails to initialise.
 *
 * The layout is the one the build produces: the script finds
 * PostgreSQL and Node next to itself.
 */
function bundleWithFailingPostgres(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mirrai-macos-"));
  const res = path.join(root, "res");
  mkdirSync(path.join(res, "pgsql", "bin"), { recursive: true });
  mkdirSync(path.join(res, "node", "bin"), { recursive: true });
  mkdirSync(path.join(root, "home"), { recursive: true });

  const initdb = path.join(res, "pgsql", "bin", "initdb");
  writeFileSync(
    initdb,
    ["#!/bin/bash", 'echo "initdb: could not write to the data directory" >&2', "exit 1", ""].join("\n"),
  );
  chmodSync(initdb, 0o755);

  writeFileSync(path.join(res, "node", "bin", "node"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(res, "node", "bin", "node"), 0o755);

  writeFileSync(path.join(res, "start.sh"), readFileSync(SCRIPT, "utf-8"));
  chmodSync(path.join(res, "start.sh"), 0o755);
  return root;
}

describe.skipIf(!BASH)("the macOS start script", () => {
  it("says what went wrong when the database cannot be initialised", () => {
    const root = bundleWithFailingPostgres();
    const result = spawnSync(BASH!, [path.join(root, "res", "start.sh")], {
      // A fresh home, so the real data directory is not touched.
      env: { ...process.env, HOME: path.join(root, "home") },
      encoding: "utf-8",
      // The script waits for a keypress before it exits.
      input: "\n",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    /**
     * The handler is dead code under `set -e`: the shell ends at the
     * failing command, so the message was never printed and the log was
     * never shown. The person saw the Terminal window close and nothing
     * else.
     */
    expect(output).toContain("ERROR: Database init failed");
    // And the log itself — the only thing that says why.
    expect(output).toContain("initdb: could not write to the data directory");
  });

  it("has no failure check that `set -e` has already made dead", () => {
    const source = readFileSync(SCRIPT, "utf-8");
    /**
     * `cmd` followed by `if [ $? -ne 0 ]` is the pattern that cannot
     * work: the shell has already ended by the time the check is read.
     */
    expect(source).not.toMatch(/\n\s*if \[ \$\? -ne 0 \]/);
  });
});
