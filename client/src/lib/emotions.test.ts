import { describe, expect, it } from "vitest";
import { EMOTIONS, resolveEmotionKey } from "./emotions";
import { zh } from "@/i18n/zh";
import { en } from "@/i18n/en";

/**
 * A diary is written in the reader's language.
 *
 * The prompt asks the model for the emotion *in that language*, so the
 * emotional arc holds "温柔" or "俏皮" — not "warm" or "playful". The
 * chip lookup was by the English key, so it never matched, and every
 * chip in a Chinese diary fell back to the unstyled grey text.
 */
describe("the emotion a mood names", () => {
  const label = (dictionary: any, key: string) => {
    const path = key.split(".");
    let value: any = dictionary;
    for (const part of path) value = value?.[part];
    return String(value ?? "");
  };
  const zhLabel = (key: string) => label(zh, key);
  const enLabel = (key: string) => label(en, key);

  it("is found by the Chinese label", () => {
    expect(resolveEmotionKey("温柔", zhLabel)).toBe("warm");
    expect(resolveEmotionKey("俏皮", zhLabel)).toBe("playful");
    expect(resolveEmotionKey("疏离", zhLabel)).toBe("distant");
  });

  it("is found by the English label", () => {
    expect(resolveEmotionKey("Nostalgic", enLabel)).toBe("nostalgic");
  });

  it("is the English key when it is given", () => {
    expect(resolveEmotionKey("melancholy", zhLabel)).toBe("melancholy");
  });

  it("is nothing when the mood names no emotion", () => {
    expect(resolveEmotionKey("今天天气不错", zhLabel)).toBeUndefined();
  });

  it("covers every emotion the interface knows", () => {
    for (const definition of Object.values(EMOTIONS)) {
      expect(resolveEmotionKey(zhLabel(definition.labelKey), zhLabel)).toBeDefined();
    }
  });
});
