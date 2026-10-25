import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Windows scripts, and the way they are run.
 *
 * The smoke test runs its heavy part — the database, the server, the
 * checks — in a script of its own, written out by the test and then run
 * by **Windows PowerShell**, which is not the same program as the
 * PowerShell 7 that runs the test.
 *
 * Windows PowerShell reads a file that has no byte order mark as ANSI.
 * A file written as UTF-8 without a mark therefore comes out as garbage:
 * one em dash in a message turns into a quotation mark, the script stops
 * parsing, and the test fails with no log and no reason.
 *
 * That is not a theory. It is what happened — the smoke test failed on
 * Windows with "no log written" and an exit code of 1, and the reason was
 * a single character in a message.
 *
 * So: the worker has to be plain ASCII, and the file has to be written
 * with a byte order mark. Both are checked here, because neither of them
 * fails loudly on the machine that writes the file.
 */
const ROOT = join(__dirname, "..");

/** The text between `$worker = @'` and the closing `'@`. */
function workerScript(): string {
  const source = readFileSync(join(ROOT, "scripts/windows/smoke-test.ps1"), "utf8");
  const start = source.indexOf("$worker = @'");
  const end = source.indexOf("\n'@", start);
  expect(start, "the smoke test has no worker script").toBeGreaterThan(-1);
  expect(end, "the worker script is never closed").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the Windows smoke test's worker script", () => {
  it("is plain ASCII", () => {
    // Every character above U+007F is a character Windows PowerShell may
    // read as something else entirely.
    const offenders: string[] = [];
    workerScript()
      .split("\n")
      .forEach((line, index) => {
        if ([...line].some((character) => character.codePointAt(0)! > 127)) {
          offenders.push(`line ${index + 1}: ${line}`);
        }
      });
    expect(offenders, `the worker script has characters Windows PowerShell cannot read:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("is written with a byte order mark", () => {
    // The mark is what makes Windows PowerShell read the file as UTF-8
    // rather than as ANSI. Without it, the next non-ASCII character
    // breaks the script in a way that says nothing about why.
    const source = readFileSync(join(ROOT, "scripts/windows/smoke-test.ps1"), "utf8");
    expect(source).toContain("UTF8Encoding");
    expect(source).not.toContain("Set-Content -Path $WorkerScript");
  });

  it("checks the Redis that came with the package", () => {
    // The whole point of the package carrying a Redis is that a person
    // does not have to install one. A smoke test that did not look at
    // the Redis would not be able to tell whether that is still true.
    const source = readFileSync(join(ROOT, "scripts/windows/smoke-test.ps1"), "utf8");
    expect(source).toContain("redis-server.exe");
    expect(source).toContain("redis-cli.exe");
    // And the app has to be the one using it, not something else that
    // happens to be listening on the default port.
    expect(source).toContain("MIRRAI_REDIS");
    expect(source).toContain("which Redis the app used");
  });
});

describe("the Windows build script", () => {
  it("puts a Redis in the package", () => {
    const source = readFileSync(join(ROOT, "scripts/build-windows-app.ps1"), "utf8");
    expect(source).toContain("redis-server.exe");
    expect(source).toContain("redis-cli.exe");
  });

  it("checks the Redis it downloaded", () => {
    // The archive is not from Redis, so it is checked against a pinned
    // checksum. A changed or substituted download stops the build rather
    // than shipping.
    const source = readFileSync(join(ROOT, "scripts/build-windows-app.ps1"), "utf8");
    expect(source).toContain("Get-FileHash");
    expect(source).toMatch(/\$RedisSha256\s*=\s*"[0-9a-f]{64}"/);
  });
});
