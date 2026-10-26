import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./persona-utils";

/**
 * The prompt and a malformed field.
 *
 * The persona's data is written by a procedure that accepts any JSON
 * shape at all, and the prompt calls `.join()`, `.filter()` and
 * `.map()` on several of its fields. So one field with the wrong type
 * threw a TypeError on *every* chat turn for that persona — and the
 * user had no way to repair it, because the field is not shown
 * anywhere.
 */
function persona(personaData: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    personaData,
    emotionalState: "warm",
    ...extra,
  } as any;
}

describe("the prompt and a malformed field", () => {
  it("survives a catchphrases that is a string", () => {
    const prompt = buildSystemPrompt(
      persona({ personality: "温柔", catchphrases: "我准备好了, 加油" }),
      { locale: "zh" },
    );
    expect(prompt).toContain("温柔");
  });

  it("survives a microRules that is a string", () => {
    const prompt = buildSystemPrompt(
      persona({ personality: "温柔", microRules: "oops" }),
      { locale: "zh" },
    );
    expect(prompt).toContain("温柔");
  });

  it("survives a micro rule whose trigger is a string", () => {
    const prompt = buildSystemPrompt(
      persona({
        personality: "温柔",
        microRules: [{ trigger: "x", verified: true, meaning: "m", rendering: "r" }],
      }),
      { locale: "zh" },
    );
    expect(prompt).toContain("温柔");
  });

  it("survives an imperfectionProfile that is a string", () => {
    const prompt = buildSystemPrompt(
      persona({ personality: "温柔", imperfectionProfile: "oops" }),
      { locale: "zh" },
    );
    expect(prompt).toContain("温柔");
  });

  it("keeps the fields the normaliser does not know about", () => {
    // `customInstructions` is the user's own words to the persona. It
    // is not one of the normaliser's fields, and it is read further
    // down — so normalising must not throw it away.
    const prompt = buildSystemPrompt(
      persona({ personality: "温柔", customInstructions: "不要叫我小朋友" }),
      { locale: "zh" },
    );
    expect(prompt).toContain("不要叫我小朋友");
  });
});
