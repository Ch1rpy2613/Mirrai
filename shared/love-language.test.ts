import { describe, expect, it } from "vitest";
import {
  LOVE_LANGUAGES,
  LOVE_LANGUAGE_BY_ANSWER_KEY,
  loveLanguageKey,
  normaliseLoveLanguage,
} from "./love-language";

/**
 * One vocabulary for the love languages.
 *
 * There were three. The profile editor offered five values, the lobby
 * drew an icon from five *different* values — one of them misspelled,
 * so the gift icon never appeared for anybody — and the questionnaire
 * wrote a localised string into the persona, so a persona created that
 * way matched neither list: the editor's select showed nothing at all.
 */
describe("the love languages", () => {
  it("gives every value a label key", () => {
    for (const entry of LOVE_LANGUAGES) {
      expect(entry.labelKey).toMatch(/^personaOptions\.loveLanguages\./);
      expect(entry.value.length).toBeGreaterThan(0);
    }
  });

  it("has no two values the same", () => {
    const values = LOVE_LANGUAGES.map((entry) => entry.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("answers every question the questionnaire asks", () => {
    // The questionnaire offers six; the five love languages cover them.
    for (const key of ["words", "time", "gifts", "acts", "touch", "service"]) {
      const value = LOVE_LANGUAGE_BY_ANSWER_KEY[key];
      expect(value, key).toBeTruthy();
      // And the value it answers with is one of the stored values.
      expect(LOVE_LANGUAGES.map((entry) => entry.value)).toContain(value);
    }
  });

  it("brings the old spellings forward", () => {
    // The values the questionnaire used to write, and the one the lobby
    // had misspelled.
    expect(normaliseLoveLanguage("具体的礼物")).toBe("接收礼物");
    expect(normaliseLoveLanguage("陪伴的时间")).toBe("精心时刻");
    expect(normaliseLoveLanguage("接受礼物")).toBe("接收礼物");
    expect(normaliseLoveLanguage("身体接触和亲密")).toBe("身体接触");
  });

  it("leaves a value it knows alone", () => {
    expect(normaliseLoveLanguage("肯定的言辞")).toBe("肯定的言辞");
    expect(normaliseLoveLanguage("")).toBe("");
    expect(normaliseLoveLanguage(null)).toBe("");
  });

  it("gives the key for a stored value", () => {
    expect(loveLanguageKey("接收礼物")).toBe("gifts");
    expect(loveLanguageKey("具体的礼物")).toBe("gifts");
    expect(loveLanguageKey("")).toBeNull();
  });
});
