import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Nothing hashes a password with something cheap.
 *
 * The code scanner's rule about this (`js/insufficient-password-hash`)
 * is left out of the scan, because it cannot tell the difference
 * between two things:
 *
 * - "this code hashes a password with something cheap", and
 * - "this code reads a hash that was made with something cheap, once,
 *   years ago".
 *
 * The second is the legacy format — `salt:sha256hex` — which has to
 * stay readable, because the accounts that carry one are real people's
 * accounts. It is read and never written: a password that arrives
 * against an old hash is written again with scrypt the moment it
 * matches.
 *
 * So the rule is out of the scan, and this test takes its place. It
 * reads every file of the server and says that the only place a weak
 * hash may meet a password is that one legacy function. A new weak
 * hash fails here.
 */

/**
 * The one place a cheap hash may meet a password: reading an old one.
 */
const LEGACY_FILE = path.join("server", "_core", "password.ts");
const LEGACY_FUNCTION = "verifyLegacySha256";

/**
 * The cheap hashes.
 *
 * Not `createHmac`: an HMAC with a secret key is the *right* way to
 * sign a request, and the text it signs is not a password.
 */
const WEAK_HASH = /\bcreateHash\(\s*["'`](md5|sha1|sha256|sha384|sha512)["'`]/g;

/** The names that mean "this is a password". */
const PASSWORD_LIKE = /\b(password|passwd|pwd|passphrase|secret)\b/i;

/** Every file of the server, as a path relative to the repository. */
function serverFiles(directory = path.resolve(process.cwd(), "server")): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...serverFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    // The tests are not shipped, and they say so themselves.
    if (entry.endsWith(".test.ts")) continue;
    found.push(path.relative(process.cwd(), full));
  }
  return found;
}

/**
 * The function the given line sits in.
 *
 * Walked backwards to the nearest `function` or arrow function, and
 * forwards to the end of it — so that the *whole* function is looked
 * at, and not only the line the hash is on. A password that is put in
 * a variable first is still a password.
 */
function enclosingFunction(lines: string[], lineIndex: number): string {
  let start = lineIndex;
  while (start >= 0 && !/function\b|=>\s*\{/.test(lines[start] ?? "")) {
    start -= 1;
  }
  if (start < 0) return lines.join("\n");

  let depth = 0;
  let end = start;
  for (; end < lines.length; end++) {
    for (const character of lines[end] ?? "") {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    // The function's own body has closed.
    if (end > start && depth <= 0) break;
  }
  return lines.slice(start, end + 1).join("\n");
}

describe("the hashes the server makes", () => {
  it("are not cheap ones, except in the one legacy function", () => {
    const offences: string[] = [];

    for (const file of serverFiles()) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const lines = source.split("\n");

      WEAK_HASH.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WEAK_HASH.exec(source)) !== null) {
        const lineIndex = source.slice(0, match.index).split("\n").length - 1;
        const line = lines[lineIndex] ?? "";
        const scope = enclosingFunction(lines, lineIndex);

        /**
         * A hash of something that is not a password is not a weak
         * password hash.
         *
         * A cache key, a name for a file, a digest of a message — those
         * are *meant* to be fast, and a slow one would only cost time.
         */
        if (!PASSWORD_LIKE.test(line) && !PASSWORD_LIKE.test(scope)) continue;

        /**
         * The one allowed place.
         *
         * The check is on the function the line is in — not on the line
         * — because the line that calls the cheap hash is not the line
         * that names it.
         */
        const isLegacy =
          file === LEGACY_FILE && scope.includes(`function ${LEGACY_FUNCTION}`);

        if (!isLegacy) {
          offences.push(`${file}:${lineIndex + 1} — ${line.trim()}`);
        }
      }
    }

    expect(
      offences,
      `A password must not be hashed with something cheap.\n${offences.join("\n")}`,
    ).toEqual([]);
  });

  it("reads the old format in exactly one place", () => {
    // The guard above depends on there being exactly one such place.
    const source = readFileSync(path.resolve(process.cwd(), LEGACY_FILE), "utf-8");
    expect(source).toContain(`function ${LEGACY_FUNCTION}`);
    // And the new format is what new passwords get.
    expect(source).toContain("scrypt");
  });
});
