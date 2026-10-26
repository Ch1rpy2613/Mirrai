import { describe, expect, it } from "vitest";
import { formatDayKey, formatMonthKey } from "./dates";

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
});
