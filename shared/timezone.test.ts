import { describe, expect, it } from "vitest";
import {
  dayShiftHours,
  localDateKey,
  previousDateKey,
  zonedDateKey,
  zonedHour,
  zonedOffsetHours,
} from "./timezone";

describe("the day in the machine's own calendar", () => {
  it("is the day the clock says, not the day Greenwich says", () => {
    const moment = new Date("2026-01-01T16:00:00.000Z");
    const key = localDateKey(moment);
    expect(key).toBe(
      `${moment.getFullYear()}-${String(moment.getMonth() + 1).padStart(2, "0")}-${String(moment.getDate()).padStart(2, "0")}`,
    );
  });

  it("is not the UTC day when the clock is not on UTC", () => {
    const moment = new Date("2026-01-01T16:00:00.000Z");
    const offsetMinutes = new Date().getTimezoneOffset();
    if (offsetMinutes === 0) return; // The machine is on UTC; the two agree.
    expect(localDateKey(moment)).not.toBe(moment.toISOString().slice(0, 10));
  });

  it("pads the month and the day", () => {
    const key = localDateKey(new Date(2026, 0, 2, 12));
    expect(key).toBe("2026-01-02");
  });
});

describe("the day before a day", () => {
  it("steps back one day", () => {
    expect(previousDateKey("2026-01-02")).toBe("2026-01-01");
  });

  it("steps over a month boundary", () => {
    expect(previousDateKey("2026-03-01")).toBe("2026-02-28");
  });

  it("steps over a year boundary", () => {
    expect(previousDateKey("2026-01-01")).toBe("2025-12-31");
  });

  it("steps over a leap day", () => {
    expect(previousDateKey("2028-03-01")).toBe("2028-02-29");
  });

  it("leaves a key it does not understand alone", () => {
    expect(previousDateKey("not a date")).toBe("not a date");
  });
});

describe("how far the user's clock is from the server's", () => {
  it("is zero when there is no zone", () => {
    expect(dayShiftHours(null)).toBe(0);
    expect(dayShiftHours(undefined)).toBe(0);
  });

  it("is the difference between the two offsets", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    const zone = "Asia/Shanghai";
    expect(dayShiftHours(zone, now)).toBe(
      zonedOffsetHours(now, zone) - zonedOffsetHours(now, null),
    );
  });

  it("is the whole offset when the server is on UTC", () => {
    // A server in a container is on UTC; a user in Shanghai is eight hours
    // ahead, and a message written at 23:30 their time belongs to their
    // day, not to the server's.
    const now = new Date("2026-01-02T12:00:00Z");
    expect(zonedOffsetHours(now, "Asia/Shanghai")).toBe(8);
    expect(zonedHour(now, "Asia/Shanghai")).toBe(20);
  });
});

describe("the day in a given time zone", () => {
  it("is the day over there", () => {
    const moment = new Date("2026-01-01T16:00:00.000Z");
    expect(zonedDateKey(moment, "Asia/Shanghai")).toBe("2026-01-02");
    expect(zonedDateKey(moment, "America/New_York")).toBe("2026-01-01");
  });

  it("falls back rather than throwing on a zone it does not know", () => {
    const moment = new Date("2026-01-01T16:00:00.000Z");
    expect(zonedDateKey(moment, "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
