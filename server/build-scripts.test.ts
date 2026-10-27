import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * The scripts that build and package the app.
 *
 * They download things and put them inside the app the user installs.
 * So a download that is changed or substituted ends up on somebody's
 * machine, and the build stops nowhere.
 */

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the archives the app ships", () => {
  it("are checked before they are unpacked", () => {
    const mac = read("scripts/build-macos-app.sh");
    /**
     * The Node.js archive goes straight into the app. It was not
     * checked at all — so a changed or substituted download stopped the
     * build nowhere: it was built, packaged and handed out.
     */
    expect(mac).toMatch(/sha256/i);
    expect(mac).toMatch(/NODE_SHA256/);
    // The check is before the archive is unpacked.
    const check = mac.indexOf("NODE_ACTUAL_SHA256");
    const unpack = mac.indexOf("tar -xzf");
    expect(check).toBeGreaterThanOrEqual(0);
    expect(unpack).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(unpack);
  });

  it("are checked on Windows too", () => {
    const win = read("scripts/build-windows-app.ps1");
    expect(win).toMatch(/\$NodeSha256/);
    expect(win).toMatch(/\$PgSha256/);
    // Both are checked before they are unpacked.
    const nodeCheck = win.indexOf("$NodeHash = (Get-FileHash");
    const nodeUnpack = win.indexOf("Expand-Archive -Path $NodeZipPath");
    expect(nodeCheck).toBeGreaterThanOrEqual(0);
    expect(nodeCheck).toBeLessThan(nodeUnpack);

    const pgCheck = win.indexOf("$PgHash = (Get-FileHash");
    const pgUnpack = win.indexOf("Expand-Archive -Path $PgZipPath");
    expect(pgCheck).toBeGreaterThanOrEqual(0);
    expect(pgCheck).toBeLessThan(pgUnpack);
  });

  it("carry a checksum that is the right length", () => {
    const mac = read("scripts/build-macos-app.sh");
    const win = read("scripts/build-windows-app.ps1");
    for (const source of [mac, win]) {
      const hashes = [...source.matchAll(/["']([a-f0-9]{64})["']/g)].map((m) => m[1]);
      expect(hashes.length).toBeGreaterThan(0);
    }
  });
});

describe("the font subset", () => {
  it("collects the characters from everywhere the interface reads them", () => {
    const script = read("scripts/subset-misans.py");
    /**
     * The interface reads a good part of its words out of `shared/` —
     * the imperfection profiles, the relationship phases, the user's own
     * moods — and those words have Chinese in them too. So a character
     * that only appears there was not in the subset, and the interface
     * showed a box where the word should have been.
     */
    expect(script).toMatch(/shared/);
    expect(script).not.toMatch(/CLIENT_SRC\b/);
  });

  it("says so when the subsetting tool is not there", () => {
    const script = read("scripts/subset-misans.py");
    /**
     * It was written down — so the script failed with a file-not-found
     * from the middle of a subprocess, on a machine that had it
     * somewhere else.
     */
    expect(script).toMatch(/pyftsubset/);
    expect(script).toMatch(/not found|was not found/);
  });
});

describe("the Redis setup", () => {
  it("splits the PATH the way the machine does", () => {
    const script = read("scripts/setup-redis.ts");
    /**
     * It was split on `:` on every machine — so on Windows the whole
     * `PATH` was treated as one very long directory name, and the
     * binary was never found.
     */
    expect(script).toMatch(/win32/);
    expect(script).not.toMatch(/split\(":"\)/);
  });
});

describe("the day windows", () => {
  it("are the same length everywhere on the statistics page", () => {
    const db = read("server/db.ts");
    /**
     * `zonedDayKeySince` is the day `days` days back, which opens a
     * window of N+1 days. The emotion chart used it, so it covered one
     * day more than it said — and one day more than the chart of daily
     * messages beside it. The two halves of the same page were on two
     * different ranges.
     */
    const calls = [...db.matchAll(/zonedDayKey(Since|WindowStart)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((name) => name === "Since")).toEqual([]);
  });
});
