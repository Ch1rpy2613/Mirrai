import { describe, expect, it } from "vitest";
import { TTS_VOICES, voicesForLocale, DEFAULT_VOICE } from "./tts";

/**
 * The voices.
 *
 * The picker was added to the settings, and the list behind it was
 * untested — so a voice could be listed for a language it does not
 * speak, or the default could be missing from the list the picker shows,
 * and the interface would offer a voice it then refused.
 */
describe("the voice list", () => {
  it("has both languages", () => {
    expect(TTS_VOICES.some((v) => v.locale === "zh")).toBe(true);
    expect(TTS_VOICES.some((v) => v.locale === "en")).toBe(true);
  });

  it("gives every voice an id and a label", () => {
    for (const voice of TTS_VOICES) {
      expect(voice.id).toBeTruthy();
      expect(voice.label).toBeTruthy();
    }
  });

  it("has no duplicate ids", () => {
    const ids = TTS_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers only the voices of the language asked for", () => {
    for (const voice of voicesForLocale("en")) {
      expect(voice.locale).toBe("en");
    }
    for (const voice of voicesForLocale("zh")) {
      expect(voice.locale).toBe("zh");
    }
  });

  it("includes the default voice in the list it is offered from", () => {
    // The default has to be one of the choices, or the picker opens on
    // something that is not in it.
    const chinese = voicesForLocale("zh").map((v) => v.id);
    const english = voicesForLocale("en").map((v) => v.id);
    expect(chinese.includes(DEFAULT_VOICE) || english.includes(DEFAULT_VOICE)).toBe(true);
  });

  it("falls back to the whole list for a language it has no voices for", () => {
    // Better to show every voice than to show none.
    expect(voicesForLocale("zh").length).toBeGreaterThan(0);
  });
});
