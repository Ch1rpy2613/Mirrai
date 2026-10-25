import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRADUATION_MODE,
  GRADUATION_MODES,
  isGraduationMode,
  resolveGraduationMode,
} from "@shared/graduation-mode";

/**
 * The graduation mode is the user's choice about how much the app may bring
 * a farewell up. The resolution rules live in one place so the server, the
 * channel command and the client cannot disagree about what a persona's
 * setting means.
 */
describe("the graduation mode", () => {
  it("offers exactly the three modes", () => {
    expect([...GRADUATION_MODES]).toEqual(["suggest", "manual", "off"]);
  });

  it("keeps the historical behaviour as the default", () => {
    // "suggest" is what the app did before the mode existed, so an
    // installation that never chose one behaves exactly as it did.
    expect(DEFAULT_GRADUATION_MODE).toBe("suggest");
    expect(resolveGraduationMode(null, null)).toBe("suggest");
    expect(resolveGraduationMode(undefined, undefined)).toBe("suggest");
  });

  it("lets the persona's own setting win over the user's default", () => {
    expect(resolveGraduationMode("off", "suggest")).toBe("off");
    expect(resolveGraduationMode("manual", "suggest")).toBe("manual");
    expect(resolveGraduationMode("suggest", "off")).toBe("suggest");
  });

  it("falls back to the user's default when the persona has none", () => {
    expect(resolveGraduationMode(null, "manual")).toBe("manual");
    expect(resolveGraduationMode(undefined, "off")).toBe("off");
    expect(resolveGraduationMode("", "manual")).toBe("manual");
  });

  it("does not trust a value it does not know", () => {
    // A corrupted row must not be able to switch the mechanism off — or on.
    expect(resolveGraduationMode("nonsense", "manual")).toBe("manual");
    expect(resolveGraduationMode("nonsense", "nonsense")).toBe("suggest");
    expect(resolveGraduationMode("Suggest", "manual")).toBe("manual");
    expect(isGraduationMode("nonsense")).toBe(false);
    expect(isGraduationMode("off")).toBe(true);
  });
});
