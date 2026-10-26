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

  it("detects the way it is actually said", () => {
    // "我想死" is the most ordinary sentence in the language for saying
    // it, and the list did not carry it: "不想活" is a different string.
    // A user who typed this got a normal in-character reply and no
    // support resources at all.
    expect(detectCrisis("我想死").crisis).toBe(true);
    expect(detectCrisis("我不想活了，真的").crisis).toBe(true);
    expect(detectCrisis("有点想死").crisis).toBe(true);
    expect(detectCrisis("我不想再这样活下去了").crisis).toBe(true);
    expect(detectCrisis("轻生").crisis).toBe(true);
  });

  it("detects the English ways of saying it", () => {
    expect(detectCrisis("I wish I were dead").crisis).toBe(true);
    expect(detectCrisis("I don't want to live anymore").crisis).toBe(true);
    expect(detectCrisis("I want to end it all").crisis).toBe(true);
    expect(detectCrisis("I'd be better off without me").crisis).toBe(true);
    expect(detectCrisis("there's no reason to live").crisis).toBe(true);
  });

  it("does not mind a typographic apostrophe", () => {
    // A phone keyboard writes ’, not '. The phrase is the same phrase.
    expect(detectCrisis("I don’t want to live").crisis).toBe(true);
  });

  it("does not mind full-width punctuation", () => {
    // A Chinese keyboard writes the full-width forms.
    expect(detectCrisis("我想死，真的").crisis).toBe(true);
  });

  it("does not mind a line break inside the phrase", () => {
    expect(detectCrisis("我想\n死").crisis).toBe(true);
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
