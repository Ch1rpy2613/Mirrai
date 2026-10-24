import { describe, expect, it } from "vitest";
import { detectCrisis, buildCrisisResponse, buildGentleCheckIn } from "./crisis";
import { DEFAULT_CRISIS_RESOURCES, formatResources } from "./resources";

describe("detectCrisis", () => {
  it("detects a Chinese crisis statement", () => {
    const result = detectCrisis("我不想活了");
    expect(result.crisis).toBe(true);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  it("detects an English crisis statement", () => {
    expect(detectCrisis("I want to kill myself").crisis).toBe(true);
    expect(detectCrisis("I think I might commit suicide").crisis).toBe(true);
  });

  it("does not fire on ordinary sadness", () => {
    const result = detectCrisis("今天好累");
    expect(result.crisis).toBe(false);
    expect(result.weakSignal).toBe(true);
  });

  it("does not fire on an ordinary complaint", () => {
    expect(detectCrisis("工作好烦").crisis).toBe(false);
    expect(detectCrisis("I'm so tired today").crisis).toBe(false);
  });

  it("does not fire on an empty message", () => {
    expect(detectCrisis("").crisis).toBe(false);
    expect(detectCrisis("   ").crisis).toBe(false);
  });

  it("does not fire on a mention of the word in a quotation", () => {
    // The check is deliberately simple, but it should not match a phrase
    // that merely contains a substring of a crisis term.
    expect(detectCrisis("他说要好好活下去").crisis).toBe(false);
  });

  it("prefers the crisis verdict over the weak signal", () => {
    const result = detectCrisis("我很累，也不想活了");
    expect(result.crisis).toBe(true);
  });
});

describe("buildCrisisResponse", () => {
  it("steps out of character and lists the resources", () => {
    const reply = buildCrisisResponse("小A");
    expect(reply).toContain("12356");
    expect(reply).toContain("findahelpline.com");
    expect(reply).toContain("988");
  });

  it("does not address the user with the persona's name", () => {
    // The persona is the one speaking; using its name here would sound like
    // the app is calling the *user* by the AI's name.
    const reply = buildCrisisResponse("小A");
    expect(reply).not.toContain("小A");
  });

  it("does not pretend to be a professional", () => {
    const reply = buildCrisisResponse("小A");
    expect(reply).toContain("我只是一段代码");
  });

  it("speaks English for an English conversation", () => {
    const reply = buildCrisisResponse("小A", "en");
    expect(reply).toContain("I'm still here");
    expect(reply).toContain("12356");
    expect(reply).not.toContain("我只是一段代码");
  });

  it("does not include the resource list in the gentle check-in", () => {
    const reply = buildGentleCheckIn("小A");
    expect(reply).not.toContain("12356");
  });

  it("does not address the user with the persona's name in the check-in", () => {
    expect(buildGentleCheckIn("小A")).not.toContain("小A");
  });

  it("speaks English for an English conversation", () => {
    const reply = buildGentleCheckIn("小A", "en");
    expect(reply).toContain("I'm here");
    expect(reply).not.toContain("12356");
  });
});

describe("crisis resources", () => {
  it("ships the mainland and international lines", () => {
    const ids = DEFAULT_CRISIS_RESOURCES.map((r) => r.id);
    expect(ids).toContain("cn-national");
    expect(ids).toContain("intl-directory");
  });

  it("marks every entry with the date it was last checked", () => {
    for (const resource of DEFAULT_CRISIS_RESOURCES) {
      expect(resource.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("renders one line per resource", () => {
    const text = formatResources(DEFAULT_CRISIS_RESOURCES);
    expect(text.split("\n")).toHaveLength(DEFAULT_CRISIS_RESOURCES.length);
  });
});
