import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The letters the box shows.
 *
 * Two defects the second-pass audit found, both in the same read.
 *
 * The notes for later — 「等 TA 回来再说」 — are a different thing, and
 * they are read by their own helper. They used to be in these rows,
 * and the interface filtered them out *after* the server had applied
 * the limit: so the notes took the page slots, the paging cursor
 * walked through rows that were never displayed, and because the total
 * counts only the letters while the list was truncated by the notes,
 * the panel could say "no letters yet" and "N older letters are not
 * shown" at the same time.
 *
 * And the cursor had no id tie-breaker. Two letters written in the
 * same millisecond share a `createdAt`, and the comparison was on the
 * time alone — so the row that sorts after the cursor within that
 * millisecond was on neither page, and could never be reached. The
 * letter was in the export and not in the product.
 *
 * The messages read was given the same tie-breaker in commit 2f7b178.
 * The letters read was not.
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

function getLettersSource(): string {
  const source = read("server/db.ts");
  const start = source.indexOf("export async function getLetters(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

describe("the letters the box shows", () => {
  it("are only the letters", () => {
    expect(getLettersSource()).toMatch(/eq\(letters\.kind, "letter"\)/);
  });

  it("are paged by the time *and* the id", () => {
    const source = getLettersSource();
    // The tie-breaker.
    expect(source).toMatch(/lt\(letters\.id, cursor\.id\)/);
    expect(source).toMatch(/eq\(letters\.createdAt, cursor\.createdAt\)/);
    // And the order that goes with it.
    expect(source).toMatch(/orderBy\(desc\(letters\.createdAt\), desc\(letters\.id\)\)/);
  });

  it("do not use the old time-only cursor", () => {
    expect(getLettersSource()).not.toMatch(/"createdAt" < \(SELECT/);
  });
});

describe("the count of the letters", () => {
  it("counts only the letters too", () => {
    const source = read("server/db.ts");
    const start = source.indexOf("export async function countLetters(");
    const count = source.slice(start, source.indexOf("\n}", start));
    expect(count).toMatch(/eq\(letters\.kind, "letter"\)/);
  });
});

describe("the notes for later", () => {
  it("are read by their own helper", () => {
    const source = read("server/db.ts");
    const start = source.indexOf("export async function getWaitingNotes(");
    const notes = source.slice(start, source.indexOf("\n}", start));
    expect(notes).toMatch(/eq\(letters\.kind, "todo"\)/);
  });
});
