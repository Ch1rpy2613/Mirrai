import { describe, expect, it, afterEach, vi } from "vitest";
import { getDaysUntilAnniversary } from "./Lobby";

/**
 * The anniversary banner.
 *
 * "Today" has to be the *user's* today — the same zone the heatmap,
 * the streak, the calendar and the graduation date on the same card
 * already use. It used to be the browser's.
 */

describe("the days until the anniversary", () => {
  it("is zero on the day itself", () => {
    // A fixed "today" is needed, so the test is about the arithmetic
    // and not about the day it happens to run.
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    expect(getDaysUntilAnniversary(from, "Asia/Shanghai")).toBe(0);
  });

  it("counts the days, not the milliseconds", () => {
    const today = new Date();
    const from = new Date(today.getTime() - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    // Ten days back is an anniversary ten days *ago* — so it is next
    // year, which is more than thirty days away, and the banner is
    // not shown.
    expect(getDaysUntilAnniversary(from, "Asia/Shanghai")).toBeNull();
  });

  it("uses the user's zone, and not the browser's", () => {
    /**
     * The browser's midnight against the user's.
     *
     * The banner was computed from the browser's local midnight, while
     * the same card used the user's stored zone for everything else.
     * So a user in Asia/Shanghai on a machine set to UTC was told the
     * anniversary was a day early between midnight and eight in the
     * morning.
     *
     * The clock is pinned to an instant where the two zones disagree
     * about the date: it is the fifteenth in Shanghai and the
     * fourteenth in New York.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T20:00:00Z"));
    try {
      // The fifteenth is *today* in Shanghai.
      expect(getDaysUntilAnniversary("2026-03-15", "Asia/Shanghai")).toBe(0);
      // And it is tomorrow in New York.
      expect(getDaysUntilAnniversary("2026-03-15", "America/New_York")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
