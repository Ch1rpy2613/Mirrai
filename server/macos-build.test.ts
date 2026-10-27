import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The PostgreSQL half of the macOS bundle.
 *
 * Every failure in the copy used to be swallowed:
 *
 *   cp -R "$PG_PREFIX/share/"* "$PG_DEST/share/" 2>/dev/null || true
 *
 * So a build where the copy failed went on, the .dmg was made, and the
 * app failed on the user's own machine — at first launch, with a
 * message about a missing file and nothing to connect it to the build.
 *
 * The data files are the ones `initdb` reads: the time zone data, the
 * locale data, the bootstrap files. Without them the packaged app
 * cannot create its own database at all.
 *
 * The script is run here, against a prefix with nothing in it, so the
 * test is about what the builder sees and not about the shape of the
 * code.
 */

const ROOT = path.resolve(__dirname, "..");

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

/** A PostgreSQL installation with the binaries but nothing else. */
function prefixWithBinariesOnly(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mirrai-pg-"));
  mkdirSync(path.join(root, "bin"), { recursive: true });
  writeFileSync(path.join(root, "bin", "initdb"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(root, "bin", "initdb"), 0o755);
  return root;
}

/** A PostgreSQL installation with everything in it. */
function completePrefix(): string {
  const root = prefixWithBinariesOnly();
  mkdirSync(path.join(root, "lib", "postgresql"), { recursive: true });
  writeFileSync(path.join(root, "lib", "postgresql", "pgxs.mk"), "x\n");
  writeFileSync(path.join(root, "lib", "libpq.dylib"), "x\n");
  mkdirSync(path.join(root, "share", "postgresql@16"), { recursive: true });
  writeFileSync(path.join(root, "share", "postgresql@16", "postgresql.conf.sample"), "x\n");
  return root;
}

/**
 * The copy step, as the build script performs it.
 *
 * The step is taken out of the build script and run on its own, so the
 * test is about what the builder sees — and not about the shape of
 * the code.
 */
function runBuildCopyStep(prefix: string, dest: string) {
  const source = readFileSync(path.join(ROOT, "scripts/build-macos-app.sh"), "utf-8");
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes("Step 3: Copy PostgreSQL"));
  const end = lines.findIndex((line, index) => index > start && line.includes("─── Step 3b"));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const step = lines.slice(start, end).join("\n");

  return spawnSync(BASH!, ["-c", step], {
    encoding: "utf-8",
    env: {
      ...process.env,
      SCRIPT_DIR: path.join(ROOT, "scripts"),
      PG_PREFIX: prefix,
      PG_DEST: dest,
      RESOURCES: path.dirname(dest),
    },
  });
}

describe.skipIf(!BASH)("the macOS bundle's PostgreSQL copy", () => {
  it("stops the build when the data files cannot be copied", () => {
    const prefix = prefixWithBinariesOnly();
    const dest = path.join(mkdtempSync(path.join(tmpdir(), "mirrai-dest-")), "pgsql");

    const result = runBuildCopyStep(prefix, dest);

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    /**
     * Every failure here used to be swallowed:
     *
     *   cp -R "$PG_PREFIX/share/"* "$PG_DEST/share/" 2>/dev/null || true
     *
     * So the build went on, the .dmg was made, and the app failed on
     * the user's own machine — at first launch, with a message about a
     * missing file and nothing to connect it to the build.
     */
    expect(result.status).not.toBe(0);
    expect(output).toContain("ERROR");
  });

  it("copies the data files when they are there", () => {
    const prefix = completePrefix();
    const dest = path.join(mkdtempSync(path.join(tmpdir(), "mirrai-dest-")), "pgsql");

    const result = runBuildCopyStep(prefix, dest);

    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).not.toContain("ERROR");
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(dest, "share", "postgresql.conf.sample"), "utf-8")).toBe("x\n");
  });
});
