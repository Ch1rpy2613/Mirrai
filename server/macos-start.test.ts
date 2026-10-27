import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The macOS start script, actually run.
 *
 * The previous version of this test was a set of regular expressions
 * over the script's text. So the script could be broken — could never
 * call the reader, could not find the file it sources — and the test
 * would still be green. And that is exactly what happened: the .env
 * reader was not copied into the bundle, so the installed app died on
 * every launch after the first, and the source-text test said nothing.
 *
 * So the bundle is built here by the same script the build uses, and
 * the start script is run in it.
 */

const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts/macos");
const COPY = path.join(SCRIPTS, "copy-start-scripts.sh");

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
 * A bundle laid out the way the build lays it out.
 *
 * The start scripts are copied by the same script the build uses — so
 * a file left out of that script is left out of the bundle here too,
 * and the test sees what the user would see.
 */
function bundle(options: {
  failingPostgres?: boolean;
  failingPush?: boolean;
} = {}): { root: string; res: string; home: string } {
  const root = mkdtempSync(path.join(tmpdir(), "mirrai-macos-"));
  // The layout of a .app bundle: Mirrai.app/Contents/{MacOS,Resources}.
  const contents = path.join(root, "Mirrai.app", "Contents");
  const res = path.join(contents, "Resources");
  mkdirSync(path.join(res, "pgsql", "bin"), { recursive: true });
  mkdirSync(path.join(res, "node", "bin"), { recursive: true });
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  const home = path.join(root, "home");
  mkdirSync(home, { recursive: true });

  /**
   * The app itself.
   *
   * The script does `cd "$APP_DIR"` before it synchronises the schema
   * and runs the data migrations — and the bundle used to have no such
   * directory. So the `cd` failed, `set -e` ended the script there, and
   * everything after it — the schema synchronisation, the data
   * migrations, the `.env` template, the server start, the credentials
   * — was never executed by this test. On either machine.
   *
   * The two commands the script runs there are stubs that leave a mark,
   * so the test can see that they ran.
   */
  const app = path.join(res, "app");
  mkdirSync(path.join(app, "node_modules", "drizzle-kit"), { recursive: true });
  mkdirSync(path.join(app, "scripts"), { recursive: true });
  mkdirSync(path.join(app, "dist"), { recursive: true });
  const marker = path.join(res, "ran");
  writeFileSync(
    path.join(app, "node_modules", "drizzle-kit", "bin.cjs"),
    [
      "#!/bin/bash",
      `echo "push" >> ${JSON.stringify(marker)}`,
      options.failingPush ? 'echo "push failed" >&2; exit 1' : "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(app, "scripts", "migrate.mjs"),
    ["#!/bin/bash", `echo "migrate" >> ${JSON.stringify(marker)}`, "exit 0", ""].join("\n"),
  );
  /**
   * The server itself.
   *
   * It does what the real one does on a fresh install: it writes the
   * administrator's credentials, so the script can show them.
   */
  writeFileSync(
    path.join(app, "dist", "index.js"),
    [
      "#!/bin/bash",
      'CRED="$HOME/Library/Application Support/Mirrai/first-run-credentials.txt"',
      'mkdir -p "$(dirname "$CRED")"',
      'printf "admin\npassword-from-the-server\n" > "$CRED"',
      "exit 0",
      "",
    ].join("\n"),
  );

  const bin = path.join(res, "pgsql", "bin");

  // The stubs find their data directory the way the real ones are
  // told: with a `-D`.
  const findDataDir = [
    "#!/bin/bash",
    'DATA=""',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "-D" ]; then DATA="$2"; break; fi',
    '  shift',
    'done',
    'mkdir -p "$DATA"',
  ].join("\n");

  // A PostgreSQL that fails to initialise, so the script stops early
  // and says so.
  if (options.failingPostgres) {
    writeFileSync(
      path.join(bin, "initdb"),
      ["#!/bin/bash", 'echo "initdb: could not write to the data directory" >&2', "exit 1", ""].join("\n"),
    );
    chmodSync(path.join(bin, "initdb"), 0o755);
  } else {
    // And one that works, so the script gets as far as the .env — which
    // is where the reading happens, and where the missing file used to
    // kill the launch.
    writeFileSync(
      path.join(bin, "initdb"),
      [findDataDir, 'touch "$DATA/PG_VERSION"', "exit 0", ""].join("\n"),
    );
    chmodSync(path.join(bin, "initdb"), 0o755);
  }

  // The rest of PostgreSQL: it has to look alive.
  writeFileSync(path.join(bin, "pg_isready"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(bin, "pg_isready"), 0o755);
  writeFileSync(
    path.join(bin, "pg_ctl"),
    [findDataDir, 'touch "$DATA/postmaster.pid"', "exit 0", ""].join("\n"),
  );
  chmodSync(path.join(bin, "pg_ctl"), 0o755);
  // The database does not exist, so it is created.
  writeFileSync(path.join(bin, "psql"), "#!/bin/bash\necho ''\nexit 0\n");
  chmodSync(path.join(bin, "psql"), 0o755);
  writeFileSync(path.join(bin, "createdb"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(bin, "createdb"), 0o755);

  /**
   * The node in the bundle.
   *
   * It runs the script it is given — the real one does, and a stub that
   * just exits would mean the script's `node ./node_modules/drizzle-kit/
   * bin.cjs push` did nothing at all, which is exactly what the test
   * is here to see.
   */
  writeFileSync(path.join(res, "node", "bin", "node"), "#!/bin/bash\nexec bash \"$@\"\n");
  chmodSync(path.join(res, "node", "bin", "node"), 0o755);
  /**
   * And the `curl` the script waits with.
   *
   * The script waits for the server to answer before it opens the
   * browser — twenty times, one second apart. A stub that answers at
   * once keeps the test quick, and it is the same answer the real
   * server gives once it is up.
   */
  writeFileSync(path.join(res, "node", "bin", "curl"), "#!/bin/bash\nexit 0\n");
  chmodSync(path.join(res, "node", "bin", "curl"), 0o755);

  // The copy the build does.
  const copy = spawnSync(BASH!, [COPY, SCRIPTS, res], { encoding: "utf-8" });
  expect(copy.status, copy.stderr).toBe(0);

  return { root, res, home };
}

/** Runs the start script in a bundle and returns what it printed. */
function runStart(res: string, home: string): { status: number | null; output: string } {
  const result = spawnSync(BASH!, [path.join(res, "start.sh")], {
    env: { ...process.env, HOME: home },
    encoding: "utf-8",
    input: "\n",
    timeout: 30_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe.skipIf(!BASH)("the macOS start script", () => {
  it("says what went wrong when the database cannot be initialised", () => {
    const { res, home } = bundle({ failingPostgres: true });
    const result = runStart(res, home);

    /**
     * The handler is dead code under `set -e`: the shell ends at the
     * failing command, so the message was never printed and the log was
     * never shown — the Terminal window closed and the user had no idea
     * that the first launch had failed.
     */
    expect(result.output).toContain("ERROR: Database init failed");
    expect(result.output).toContain("initdb: could not write to the data directory");
    expect(result.status).toBe(1);
  }, 30_000);

  it("has everything it needs in the bundle", () => {
    const { res } = bundle();
    /**
     * The .env reader goes with it.
     *
     * It was not copied — so the installed app could not read the .env
     * at all: `source "$SCRIPT_DIR/load-env.sh"` failed, and the
     * script runs with `set -e`, so it died there. The first launch
     * worked (there is no .env yet, so the block is skipped) and
     * **every launch after it died** with "No such file or directory".
     */
    expect(() => readFileSync(path.join(res, "load-env.sh"), "utf-8")).not.toThrow();
    expect(() => readFileSync(path.join(res, "start.sh"), "utf-8")).not.toThrow();
    expect(() => readFileSync(path.join(res, "..", "MacOS", "Mirrai"), "utf-8")).not.toThrow();
  }, 30_000);
});

describe.skipIf(!BASH)("the schema and the migrations", () => {
  it("are run when the app starts", () => {
    /**
     * The rest of the launch.
     *
     * The bundle had no `Resources/app`, so `cd "$APP_DIR"` failed,
     * `set -e` ended the script there, and everything after it was
     * never executed by this test — on either machine. So the schema
     * synchronisation, the data migrations, the `.env` template and
     * the credentials were all untested.
     */
    const { res, home } = bundle();
    runStart(res, home);

    const ran = existsSync(path.join(res, "ran"))
      ? readFileSync(path.join(res, "ran"), "utf-8")
      : "";
    expect(ran).toContain("push");
    expect(ran).toContain("migrate");
  }, 30_000);

  it("are not skipped when the schema cannot be synchronised", () => {
    // A failed `push` means the schema and the live database still
    // disagree — so the app must not start on a half-synced database.
    const { res, home } = bundle({ failingPush: true });
    const result = runStart(res, home);

    expect(result.output).toContain("schema was not synchronised");
    // And the data migrations did not run either — the app must not
    // carry on.
    const ran = existsSync(path.join(res, "ran"))
      ? readFileSync(path.join(res, "ran"), "utf-8")
      : "";
    expect(ran).not.toContain("migrate");
  }, 30_000);

  it("leave the user a .env to fill in", () => {
    const { res, home } = bundle();
    runStart(res, home);

    const envFile = path.join(home, "Library/Application Support/Mirrai/.env");
    expect(existsSync(envFile)).toBe(true);
    // And only its owner may read it: it is the file the user is told
    // to put their provider key in.
    const mode = statSync(envFile).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  }, 30_000);
});

describe.skipIf(!BASH)("the .env in the bundle", () => {
  it("is read on the second launch, when there is one", () => {
    const { res, home } = bundle();

    // The first launch gets as far as the database and stops there.
    const first = runStart(res, home);
    expect(first.output).toContain("Applying the WeChat channel migration");

    // The .env the first launch would have left behind.
    const dataRoot = path.join(home, "Library/Application Support/Mirrai");
    mkdirSync(dataRoot, { recursive: true });
    const envFile = path.join(dataRoot, ".env");
    writeFileSync(envFile, "DISPLAY_NAME=My App\n", "utf-8");

    // The second launch has one — and it is the one that used to die.
    const second = runStart(res, home);

    /**
     * The script got past the .env.
     *
     * It used to die there: the reader was not in the bundle, so
     * `source` failed, and `set -e` ended the script. The user saw
     * "…/Resources/load-env.sh: No such file or directory" and the app
     * never started — on every launch after the first.
     */
    expect(second.output).not.toContain("load-env.sh: No such file");
    // And it got past the .env — the migration step comes after it.
    expect(second.output).toContain("Applying the WeChat channel migration");
  }, 30_000);
});
