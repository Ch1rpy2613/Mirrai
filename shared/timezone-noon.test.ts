import { afterAll, describe, expect, it } from "vitest";
import { zonedMidnightForDayKey, zonedNoonForDayKey } from "./timezone";

/**
 * The two halves of "a day the user typed".
 *
 * A day the user typed is a calendar day, not an instant — so it is
 * filed at the middle of that day, and the interface renders it in the
 * reader's own zone.
 *
 * The two functions disagreed about what "no zone" means: the midnight
 * returned the server's own *local* midnight, and the noon returned
 * *UTC* noon. So on a server eight hours ahead of UTC, a day the user
 * typed was filed at 20:00 in the evening — and the interface showed
 * 20:00 for it. On a server thirteen hours ahead, the very same entry
 * landed on the next calendar day.
 *
 * And the same user got their entry back at 12:00 the moment they set
 * a time zone.
 */

/**
 * The machine's own time zone is set, so the test means the same thing
 * everywhere.
 *
 * Without it the test only fails on a machine that is not on UTC — and
 * CI runs on UTC, so a test that passes there proves nothing.
 *
 * And it is set to a zone **west** of Greenwich as well as east: the
 * day the user typed has to be the day they meant on every machine in
 * the world, and the first version of this fix got it wrong for
 * everyone west of Greenwich — it landed on the day before.
 */
const ORIGINAL_TZ = process.env.TZ;

function inZone<T>(zone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("a day the user typed, with no time zone", () => {
  it("is filed at the middle of the server's own day", () => {
    inZone("Asia/Shanghai", () => {
      const noon = zonedNoonForDayKey("2026-03-14", null);
      // The server's own noon — not UTC's.
      expect(noon.getHours()).toBe(12);
      expect(noon.getDate()).toBe(14);
      expect(noon.getMonth()).toBe(2);
    });
  });

  it("is the day the user meant, west of Greenwich too", () => {
    inZone("America/New_York", () => {
      const noon = zonedNoonForDayKey("2026-03-14", null);
      /**
       * The day the user meant.
       *
       * The first version of this fix took the *UTC* midnight of that
       * day and then set the local hour to twelve — and on a server
       * west of Greenwich the UTC midnight is the *previous* local
       * evening, so the noon came out on the day before. That is the
       * very thing the caller asks not to happen: "not the day before
       * it for anybody west of Greenwich".
       */
      expect(noon.getDate()).toBe(14);
      expect(noon.getMonth()).toBe(2);
      expect(noon.getHours()).toBe(12);
    });
  });

  it("agrees with the midnight about what 'no zone' means", () => {
    inZone("Asia/Shanghai", () => {
      const midnight = zonedMidnightForDayKey("2026-03-14", null);
      const noon = zonedNoonForDayKey("2026-03-14", null);

      // Both are on the server's own clock, and both are on the same
      // calendar day.
      expect(midnight.getHours()).toBe(0);
      expect(midnight.getDate()).toBe(14);
      expect(noon.getDate()).toBe(14);
      // And the noon is the middle of that day, on that same clock.
      const hoursApart = (noon.getTime() - midnight.getTime()) / 3_600_000;
      expect(hoursApart).toBe(12);
    });
  });

  it("is still the middle of the day when the zone is given", () => {
    const noon = zonedNoonForDayKey("2026-03-14", "Asia/Shanghai");
    // 12:00 in Shanghai is 04:00 UTC.
    expect(noon.getUTCHours()).toBe(4);
    expect(noon.getUTCDate()).toBe(14);
  });
});
