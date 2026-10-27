import { describe, expect, it } from "vitest";
import { formatDayKey, formatMonthKey, formatInstantInZone } from "./dates";

/**
 * The dates, in the reader's own language.
 *
 * A few places printed the stored value instead: "2026-03-01", or
 * "2021-05", next to dates that were formatted. Two dates about the
 * same thing, in two formats, on the same screen.
 */
describe("the dates", () => {
  it("reads a day key as a day", () => {
    // The first of March, in a language that puts the day first.
    expect(formatDayKey("2026-03-01", "en-GB")).toBe("01/03/2026");
  });

  it("leaves a day key that is not one alone", () => {
    expect(formatDayKey("not a date", "en-GB")).toBe("not a date");
  });

  it("reads a month key as a month", () => {
    expect(formatMonthKey("2021-05", "en-GB")).toBe("May 2021");
  });

  it("reads a month key that carries a day too", () => {
    // The date picker in the lobby hands over "2021-05-01", and the
    // editor asks for "2021-05". Both are the same month.
    expect(formatMonthKey("2021-05-01", "en-GB")).toBe("May 2021");
  });

  it("leaves a month key that is not one alone", () => {
    expect(formatMonthKey("sometime in May", "en-GB")).toBe("sometime in May");
  });

  it("reads an instant in the reader's own calendar", () => {
    // Ten in the evening in Shanghai is two in the afternoon in New York
    // — and the day it belongs to is different.
    const instant = "2026-03-01T14:00:00.000Z";

    expect(formatInstantInZone(instant, "en", "America/New_York")).toBe("3/1/2026");
    expect(formatInstantInZone(instant, "en", "Asia/Shanghai")).toBe("3/1/2026");
    // And when the instant is near midnight, the zone decides the day.
    const late = "2026-03-01T02:00:00.000Z";
    expect(formatInstantInZone(late, "en", "America/New_York")).toBe("2/28/2026");
    expect(formatInstantInZone(late, "en", "Asia/Shanghai")).toBe("3/1/2026");
  });

  it("says nothing for an instant that is not one", () => {
    expect(formatInstantInZone(null, "en", "Asia/Shanghai")).toBe("");
    expect(formatInstantInZone("not a date", "en", "Asia/Shanghai")).toBe("");
  });
});
