import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The statuses the bot writes.
 *
 * The column is a Postgres enum, so a value that is not in it is
 * refused by the database — and the refusal happened inside the login
 * poll, whose catch turned it into "the login failed".
 *
 * It was written as "scanned" where the enum says "scaned": so the
 * moment the code was scanned, the login died with a Postgres error on
 * the screen.
 */
const ENUM_VALUES = [
  "stopped",
  "scanning",
  "scaned",
  "need_verifycode",
  "logged_in",
  "error",
];

describe("the status the bot writes", () => {
  it("is always one the column accepts", () => {
    const source = readFileSync(
      path.resolve(__dirname, "bot.ts"),
      "utf-8",
    );
    const written = [
      ...source.matchAll(/upsertWechatBotState\([^)]*?\{\s*status:\s*"([^"]+)"/gs),
    ].map((match) => match[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const status of written) {
      expect(ENUM_VALUES).toContain(status);
    }
  });

  it("never writes a status the enum does not have", () => {
    const source = readFileSync(
      path.resolve(__dirname, "bot.ts"),
      "utf-8",
    );
    // Every status that appears anywhere in the file.
    const all = [...source.matchAll(/status:\s*"([^"]+)"/g)].map((match) => match[1]);
    for (const status of all) {
      expect(ENUM_VALUES).toContain(status);
    }
  });
});
