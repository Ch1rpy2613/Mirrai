import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The letter the user took back.
 *
 * "Actually, I do want to say it" is for a letter that was dropped. It
 * was not for one that was already said: the update had no status
 * filter, so a letter the user had marked as said could be flipped back
 * to "ready" — the badge changed from "already said" to "ready to
 * take", the "I said it" button came back, and the row said at the
 * same time that it had been sent and that it had not. The `sentAt`
 * was left behind too.
 *
 * The interface only shows the button for a dropped letter — so the
 * server has to enforce what the interface assumed.
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

function restoreSource(): string {
  const source = read("server/db.ts");
  const start = source.indexOf("export async function restoreOutboundLetter(");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n}", start));
}

describe("bringing a letter back", () => {
  it("only brings back one that was dropped", () => {
    expect(restoreSource()).toMatch(/eq\(outboundLetters\.status, "dropped"\)/);
  });

  it("does not leave the sent time behind", () => {
    // The row said at the same time that it had been sent and that it
    // had not.
    expect(restoreSource()).toMatch(/sentAt: null/);
  });

  it("is offered by the interface only for a dropped letter", () => {
    const letters = read("client/src/components/OutboundLetters.tsx");
    expect(letters).toMatch(/letter\.status === "dropped" \? \(/);
  });
});
