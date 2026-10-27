import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The lists that are capped say so.
 *
 * The server caps the diary list at thirty and the relationship list
 * at two hundred, and both now return the total alongside. The
 * interface used to show the cap's worth of entries with nothing
 * saying so — so a persona with two hundred diaries read as if there
 * were thirty, and a user with three hundred milestones saw two
 * hundred with no way of knowing that a hundred of the oldest were
 * behind them.
 *
 * The panel that shows the milestones had the notice; the graduation
 * page and the diary did not.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the diary list", () => {
  it("says how many are not shown", () => {
    const diary = read("client/src/pages/Diary.tsx");
    expect(diary).toMatch(/\(entries\.total \?\? 0\) > entries\.items\.length/);
    expect(diary).toMatch(/diary\.moreEntries/);
  });

  it("has the wording in both languages", () => {
    for (const file of ["client/src/i18n/zh.ts", "client/src/i18n/en.ts"]) {
      expect(read(file), file).toMatch(/moreEntries:/);
    }
  });
});

describe("the graduation timeline", () => {
  it("says how many are not shown", () => {
    const graduation = read("client/src/pages/Graduation.tsx");
    expect(graduation).toMatch(/\(eventsData\?\.total \?\? 0\) > events\.length/);
    expect(graduation).toMatch(/relationship\.moreEntries/);
  });
});

describe("the milestones panel", () => {
  it("said so already", () => {
    // The one that was fixed in commit f933c62.
    const timeline = read("client/src/components/RelationshipTimeline.tsx");
    expect(timeline).toMatch(/relationship\.moreEntries/);
  });
});

describe("the server", () => {
  it("sends the total with both lists", () => {
    const routers = read("server/routers.ts");
    expect(routers).toMatch(/return \{ items, total \}/);
    expect(routers).toMatch(/return \{ events, phase: resolveRelationshipPhase\(events\), total \}/);
  });
});
