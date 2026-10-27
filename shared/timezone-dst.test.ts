import { describe, expect, it } from "vitest";
import {
  zonedDayStart,
  zonedMidnightForDayKey,
  zonedNoonForDayKey,
  zonedDateKey,
} from "./timezone";

/**
 * The user's day, on the days the clocks change.
 *
 * The offset of a zone is not the same all year — the clocks go forward
 * one Sunday and back the next autumn, and the hour that changes is
 * inside the day. So "the user's midnight" is not "now, shifted by the
 * offset of the zone now": on the day of a change that shift is an hour
 * out, and an hour is enough to put a message on the neighbouring day.
 */

describe("the user's midnight", () => {
  it("is the local midnight on an ordinary day", () => {
    // Shanghai is eight hours ahead of UTC, all year.
    const start = zonedDayStart(new Date("2026-03-01T02:00:00.000Z"), "Asia/Shanghai");

    // 2026-03-01 00:00 in Shanghai.
    expect(start.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("is the local midnight on the day the clocks go forward", () => {
    // In London the clocks go forward at one in the morning on the last
    // Sunday of March 2026 — so the day is twenty-three hours long.
    const start = zonedDayStart(new Date("2026-03-29T12:00:00.000Z"), "Europe/London");

    // Midnight, in Greenwich — the offset before the change.
    expect(start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    // And it is the local midnight, not an hour off it.
    expect(zonedDateKey(start, "Europe/London")).toBe("2026-03-29");
    expect(start.getUTCHours()).toBe(0);
  });

  it("is the local midnight on the day the clocks go back", () => {
    // And back at two in the morning on the last Sunday of October
    // 2026 — so the day is twenty-five hours long.
    const start = zonedDayStart(new Date("2026-10-25T12:00:00.000Z"), "Europe/London");

    // Midnight, in British Summer Time — the offset before the change.
    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(zonedDateKey(start, "Europe/London")).toBe("2026-10-25");
  });

  it("is the server's own midnight when there is no zone", () => {
    const start = zonedDayStart(new Date("2026-03-01T02:00:00.000Z"), null);

    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
  });

  it("counts the days back on the user's own calendar", () => {
    // Two days before the day the clocks change.
    const start = zonedDayStart(new Date("2026-03-29T12:00:00.000Z"), "Europe/London", 2);

    expect(zonedDateKey(start, "Europe/London")).toBe("2026-03-27");
    // And the midnight of that day, not the one of the day it was asked from.
    expect(start.toISOString()).toBe("2026-03-27T00:00:00.000Z");
  });
});

describe("the middle of a day", () => {
  it("is noon in the user's own zone", () => {
    const noon = zonedNoonForDayKey("2026-03-01", "Asia/Shanghai");

    // Noon in Shanghai.
    expect(noon.toISOString()).toBe("2026-03-01T04:00:00.000Z");
  });

  it("is noon on the day the clocks change", () => {
    const noon = zonedNoonForDayKey("2026-03-29", "Europe/London");

    // Noon, in British Summer Time — the offset *after* the change.
    expect(noon.toISOString()).toBe("2026-03-29T11:00:00.000Z");
    expect(zonedDateKey(noon, "Europe/London")).toBe("2026-03-29");
  });
});

describe("the midnight of a day", () => {
  it("is the local midnight of that day", () => {
    const start = zonedMidnightForDayKey("2026-03-29", "Europe/London");

    expect(start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });
});
