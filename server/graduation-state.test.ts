import { describe, expect, it } from "vitest";
import {
  canOfferGraduation,
  getEffectivePresence,
  RESUGGEST_COOLDOWN_DAYS,
} from "./_core/graduation";
import {
  isPresence,
  mayReachOut,
  resolvePresence,
} from "@shared/graduation-mode";
import { zonedHour, zonedOffsetHours, formatZonedClock, isValidTimeZone } from "@shared/timezone";

describe("canOfferGraduation", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("offers a farewell to a persona that has never been offered one", () => {
    expect(canOfferGraduation({ status: null, now })).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("never offers a second farewell after the goodbye has happened", () => {
    expect(
      canOfferGraduation({
        status: "graduated",
        suggestedAt: new Date("2026-01-01T00:00:00Z"),
        now,
      }),
    ).toEqual({ allowed: false, reason: "never" });
  });

  it("does not offer again right after an offer", () => {
    // The offer is made once. It used to be made on every turn, which
    // turned a suggestion into a nag.
    expect(
      canOfferGraduation({
        status: "suggested",
        suggestedAt: new Date("2026-05-31T12:00:00Z"),
        now,
      }),
    ).toEqual({ allowed: false, reason: "recently" });
  });

  it("does not offer again right after a refusal", () => {
    expect(
      canOfferGraduation({
        status: "declined",
        declinedAt: new Date("2026-05-31T12:00:00Z"),
        now,
      }),
    ).toEqual({ allowed: false, reason: "recently" });
  });

  it("offers again once the cooldown has passed", () => {
    // A refusal has to be revisable, or it is a decision the user never
    // gets to make.
    const longAgo = new Date(
      now.getTime() - (RESUGGEST_COOLDOWN_DAYS + 1) * 86_400_000,
    );
    expect(
      canOfferGraduation({ status: "declined", declinedAt: longAgo, now }),
    ).toEqual({ allowed: true, reason: "ok" });
  });

  it("uses the refusal rather than the offer when both are recorded", () => {
    const declinedRecently = new Date(now.getTime() - 86_400_000);
    expect(
      canOfferGraduation({
        status: "declined",
        suggestedAt: new Date("2026-01-01T00:00:00Z"),
        declinedAt: declinedRecently,
        now,
      }),
    ).toEqual({ allowed: false, reason: "recently" });
  });
});

describe("resolvePresence", () => {
  it("keeps a persona that is simply present", () => {
    expect(resolvePresence("active", null)).toBe("active");
  });

  it("keeps a persona the user asked to be left alone", () => {
    expect(resolvePresence("quiet", null)).toBe("quiet");
  });

  it("puts a graduated persona to sleep whatever the column says", () => {
    expect(resolvePresence("active", "graduated")).toBe("asleep");
    expect(resolvePresence("quiet", "graduated")).toBe("asleep");
  });

  it("falls back to active for an unknown value", () => {
    expect(resolvePresence("nonsense", null)).toBe("active");
    expect(resolvePresence(null, null)).toBe("active");
  });

  it("recognises the known values", () => {
    expect(isPresence("active")).toBe(true);
    expect(isPresence("quiet")).toBe(true);
    expect(isPresence("asleep")).toBe(true);
    expect(isPresence("sleepy")).toBe(false);
    expect(isPresence(null)).toBe(false);
  });

  it("only reaches out to a persona that is present", () => {
    expect(mayReachOut("active")).toBe(true);
    expect(mayReachOut("quiet")).toBe(false);
    expect(mayReachOut("asleep")).toBe(false);
  });

  it("reads the presence off a persona row", () => {
    expect(getEffectivePresence({ personaPresence: "quiet", graduationStatus: null })).toBe("quiet");
    expect(getEffectivePresence({ personaPresence: "active", graduationStatus: "graduated" })).toBe("asleep");
  });
});

describe("time zones", () => {
  // 2026-06-01T20:00:00Z — late in the afternoon in Shanghai, early in
  // the morning in New York.
  const moment = new Date("2026-06-01T20:00:00Z");

  it("reads the hour in the given zone", () => {
    expect(zonedHour(moment, "Asia/Shanghai")).toBe(4);
    expect(zonedHour(moment, "America/New_York")).toBe(16);
    expect(zonedHour(moment, "UTC")).toBe(20);
  });

  it("falls back to the local time for an unknown zone", () => {
    expect(zonedHour(moment, "Not/AZone")).toBe(moment.getHours());
    expect(zonedHour(moment, null)).toBe(moment.getHours());
    expect(zonedHour(moment, undefined)).toBe(moment.getHours());
  });

  it("reads midnight as zero rather than twenty-four", () => {
    const midnight = new Date("2026-06-01T16:00:00Z");
    expect(zonedHour(midnight, "Asia/Shanghai")).toBe(0);
  });

  it("reads the offset in hours", () => {
    expect(zonedOffsetHours(moment, "Asia/Shanghai")).toBe(8);
    expect(zonedOffsetHours(moment, "UTC")).toBe(0);
  });

  it("formats a clock in the given zone", () => {
    expect(formatZonedClock(moment, "Asia/Shanghai", "en")).toContain("4:00");
    expect(formatZonedClock(moment, "UTC", "en")).toContain("8:00");
  });

  it("knows which zone names it can use", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});
