import { describe, expect, it } from "vitest";
import {
  OUTBOUND_STALE_DAYS,
  daysWaiting,
  isOutboundStatus,
  isStale,
} from "./outbound";

/**
 * The letters the user takes back.
 *
 * The fifth status is the one this file is really about. A letter
 * written to someone who is not there any more has to have somewhere to
 * go, or it becomes exactly the pile of unsent words this feature exists
 * to prevent.
 */
describe("the statuses", () => {
  it("knows the five endings", () => {
    expect(isOutboundStatus("draft")).toBe(true);
    expect(isOutboundStatus("ready")).toBe(true);
    expect(isOutboundStatus("sent")).toBe(true);
    expect(isOutboundStatus("dropped")).toBe(true);
    expect(isOutboundStatus("self")).toBe(true);
    expect(isOutboundStatus("whatever")).toBe(false);
  });
});

describe("how long a letter has waited", () => {
  const now = new Date("2026-03-01T00:00:00Z");

  it("counts the days", () => {
    const letter = {
      status: "ready",
      createdAt: new Date("2026-02-20T00:00:00Z"),
    };
    expect(daysWaiting(letter, now)).toBe(9);
  });

  it("does not count a letter that is already finished", () => {
    expect(
      daysWaiting(
        { status: "sent", createdAt: new Date("2025-01-01T00:00:00Z") },
        now,
      ),
    ).toBe(0);
    expect(
      daysWaiting(
        { status: "self", createdAt: new Date("2025-01-01T00:00:00Z") },
        now,
      ),
    ).toBe(0);
    expect(
      daysWaiting(
        { status: "dropped", createdAt: new Date("2025-01-01T00:00:00Z") },
        now,
      ),
    ).toBe(0);
  });

  it("is zero when there is no date", () => {
    expect(daysWaiting({ status: "ready", createdAt: null }, now)).toBe(0);
  });

  it("counts a letter that is still being written", () => {
    const letter = {
      status: "draft",
      createdAt: new Date("2026-02-20T00:00:00Z"),
    };
    expect(daysWaiting(letter, now)).toBe(9);
  });

  it("is zero when the date is not a date", () => {
    expect(
      daysWaiting({ status: "ready", createdAt: "not a date" }, now),
    ).toBe(0);
  });

  it("is zero for a letter that is waiting for a day that has not come", () => {
    const letter = {
      status: "ready",
      createdAt: new Date("2026-03-02T00:00:00Z"),
    };
    expect(daysWaiting(letter, now)).toBe(0);
  });

  it("mentions a letter once it has waited long enough", () => {
    const old = {
      status: "ready",
      createdAt: new Date(
        new Date(now).getTime() - (OUTBOUND_STALE_DAYS + 1) * 86_400_000,
      ),
    };
    expect(isStale(old, now)).toBe(true);
  });

  it("mentions a letter on the day it crosses the line", () => {
    const exactly = {
      status: "ready",
      createdAt: new Date(
        new Date(now).getTime() - OUTBOUND_STALE_DAYS * 86_400_000,
      ),
    };
    expect(isStale(exactly, now)).toBe(true);
  });

  it("does not mention a letter that has only just been written", () => {
    expect(
      isStale(
        { status: "ready", createdAt: new Date("2026-02-28T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("keeps mentioning a letter that has waited too long", () => {
    // Whether it is said again is the interface's business; the letter
    // itself is still waiting.
    const old = {
      status: "ready",
      createdAt: new Date(
        new Date(now).getTime() - (OUTBOUND_STALE_DAYS + 30) * 86_400_000,
      ),
    };
    expect(isStale(old, now)).toBe(true);
  });

  it("does not mention a letter that is already finished", () => {
    expect(
      isStale(
        { status: "sent", createdAt: new Date("2025-01-01T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });
});
