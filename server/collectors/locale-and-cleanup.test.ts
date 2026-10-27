import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildUserContextBlock } from "@shared/user-side";

/**
 * The collector's own words, and the persona's knowledge of the user.
 *
 * The connectors' labels are localised — which made the hard-coded
 * Chinese in the *auth state* look like an oversight rather than a
 * decision. And that state is stored verbatim and shown back to the
 * user, so an English-reading user was told "飞书需要 app_id 和
 * app_secret" in Chinese, with no way to get the English wording.
 *
 * And the block about the user had a field for their time zone and
 * never read it — so the persona was told the time of day but not
 * where the user was.
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the collector's auth state", () => {
  it("is in the reader's language", () => {
    const types = read("server/collectors/types.ts");
    // Every message a connector hands back is written for a person.
    const hardCoded = [...types.matchAll(/message: copy\("zh"/g)];
    expect(hardCoded).toEqual([]);
  });
});

describe("the run directory", () => {
  it("is not able to take the run's own outcome with it", () => {
    const types = read("server/collectors/types.ts");
    /**
     * The removal used to be able to throw, and it threw *from inside
     * the finally*, which replaced whatever the run had already thrown.
     * So the user saw "EBUSY: operation failed, rmdir" instead of
     * "已取消" — and the directory, which holds the plaintext
     * credential file this run wrote, was left on disk.
     */
    expect(types).toMatch(/try \{\s*rmSync\(/);
    // And it retries, because the child may still be holding the files.
    expect(types).toMatch(/maxRetries/);
  });
});

describe("the block about the user", () => {
  it("says where the user is", () => {
    const block = buildUserContextBlock(
      { name: "小王", timezone: "Asia/Shanghai" },
      { locale: "en" },
    );
    /**
     * The field was there and never read.
     *
     * So the persona was told the time of day but not where the user
     * was — it could not tell "it is late" from "it is late for you".
     */
    expect(block).toContain("Asia/Shanghai");
  });

  it("leaves it out when the user has not chosen one", () => {
    const block = buildUserContextBlock({ name: "小王" }, { locale: "en" });
    expect(block).not.toContain("time zone");
  });
});
