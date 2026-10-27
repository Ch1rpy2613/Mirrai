import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The macOS start script.
 *
 * It keeps the session-signing key and the file the user is told to put
 * their AI provider key in. Both used to be written world-readable into
 * a world-readable directory — so on a machine with more than one local
 * account, every one of them could read the signing key, and with it
 * mint a valid session cookie for the administrator.
 *
 * And the `.env` was `source`d, which runs it as shell code: a value
 * with a space in it killed the launch, and an API key with a `$` in it
 * was silently truncated — a secret that is quietly half a secret.
 */

const ROOT = path.resolve(__dirname, "..");
const START = path.join(ROOT, "scripts/macos/start.sh");
const LOAD_ENV = path.join(ROOT, "scripts/macos/load-env.sh");

/** Runs a snippet of shell and returns what it printed. */
function shell(body: string): { status: number; out: string; err: string } {
  const result = spawnSync("/bin/bash", ["-c", body], { encoding: "utf-8" });
  return {
    status: result.status ?? -1,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

describe("the .env file", () => {
  it("is read, not run as shell code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-env-"));
    const envPath = path.join(dir, ".env");
    // A value with a space in it, and a key with a `$` in it — both are
    // ordinary things for a person to type into a settings file.
    writeFileSync(
      envPath,
      [
        "# a comment",
        "DISPLAY_NAME=My App",
        "OPENAI_API_KEY=sk-proj-abc$xyz123",
        "export QUOTED=\"a quoted value\"",
        "SINGLE='single quoted'",
        "NOT_AN_ASSIGNMENT",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = shell(`
      set -euo pipefail
      source ${JSON.stringify(LOAD_ENV)}
      load_env_file ${JSON.stringify(envPath)}
      printf 'NAME=[%s]\\n' "$DISPLAY_NAME"
      printf 'KEY=[%s]\\n' "$OPENAI_API_KEY"
      printf 'QUOTED=[%s]\\n' "$QUOTED"
      printf 'SINGLE=[%s]\\n' "$SINGLE"
    `);

    // The reading did not fail.
    expect(result.status).toBe(0);
    // The space survived.
    expect(result.out).toContain("NAME=[My App]");
    /**
     * The key survived whole.
     *
     * `source`d, it was either truncated to the part before the `$` or
     * the whole launch died with "unbound variable". Both are silent
     * corruption of a credential.
     */
    expect(result.out).toContain("KEY=[sk-proj-abc$xyz123]");
    // The quotes are quotes, not part of the value.
    expect(result.out).toContain("QUOTED=[a quoted value]");
    expect(result.out).toContain("SINGLE=[single quoted]");
  });

  it("would have broken the launch, if it were run as shell code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-env-"));
    const envPath = path.join(dir, ".env");
    writeFileSync(envPath, "DISPLAY_NAME=My App\n", "utf-8");

    /**
     * The reason the file is read and not run.
     *
     * This is what the start script used to do with it, and it is the
     * reason the reading lives in its own file: the launch died with
     * "App: command not found" and exit 127, and the Terminal window
     * showed only that one line — so the user had no idea that the app
     * had failed to start, and no idea why.
     */
    const sourced = shell(`
      set -euo pipefail
      set -a
      source ${JSON.stringify(envPath)}
      set +a
    `);
    expect(sourced.status).not.toBe(0);
    expect(sourced.out + sourced.err).toContain("App: command not found");

    // And the way it is read now, the same file is fine.
    const read = shell(`
      set -euo pipefail
      source ${JSON.stringify(LOAD_ENV)}
      load_env_file ${JSON.stringify(envPath)}
      printf 'NAME=[%s]\n' "$DISPLAY_NAME"
    `);
    expect(read.status).toBe(0);
    expect(read.out).toContain("NAME=[My App]");
  });

  it("does not run what is in it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mirrai-env-"));
    const envPath = path.join(dir, ".env");
    const marker = path.join(dir, "ran");
    writeFileSync(envPath, `EVIL=$(touch ${marker})\n`, "utf-8");

    shell(`
      set -euo pipefail
      source ${JSON.stringify(LOAD_ENV)}
      load_env_file ${JSON.stringify(envPath)}
    `);

    // The file was read; what was in it was not run.
    expect(() => statSync(marker)).toThrow();
  });
});

describe("the files the start script writes", () => {
  const start = readFileSync(START, "utf-8");

  it("keeps the signing key for its owner only", () => {
    // The key is written through a temporary file and moved into place.
    expect(start).toMatch(/umask 077/);
    // And the file that holds it is readable by its owner only.
    expect(start).toMatch(/chmod 600 "\$JWT_SECRET_FILE"/);
  });

  it("keeps the .env for its owner only", () => {
    expect(start).toMatch(/chmod 600 "\$ENV_FILE"/);
  });

  it("does not leave the signing key half-written", () => {
    /**
     * It used to be written with `>`, which truncates first: a run
     * killed between the truncation and the write left an *empty* file,
     * and the next launch read that as the signing key — so every
     * session token was forgeable.
     */
    expect(start).not.toMatch(/openssl rand -hex 32 > "\$DATA_ROOT\/\.jwt_secret"/);
    // It is moved into place instead.
    expect(start).toMatch(/mv -f "\$_jwt_tmp" "\$JWT_SECRET_FILE"/);
    // And an empty file is treated as no file at all.
    expect(start).toMatch(/if \[ ! -s "\$JWT_SECRET_FILE" \]/);
  });

  it("does not read the .env by running it", () => {
    expect(start).not.toMatch(/^\s*source "\$ENV_FILE"/m);
    expect(start).toMatch(/load_env_file "\$ENV_FILE"/);
  });
});
