import { describe, expect, it } from "vitest";
import { resolveEmotionKey } from "./emotions";
import { translate } from "@/i18n";

/**
 * The diary's emotional arc is stored in the language it was written in.
 *
 * The server asks the model for the emotion "in that language" — so a
 * Chinese diary holds 「温柔」. And the label it was matched against
 * was the *current* interface language's: so the match only succeeded
 * while the interface was in the language the diary was written in.
 * Switch the interface to English and the chips fell back to the
 * unstyled grey one and printed the raw Chinese in an English
 * interface.
 */

describe("the mood of a diary", () => {
  it("is found in the language it was written in", () => {
    const chinese = translate("zh", "emotions.warm.label");
    expect(chinese).toBe("温柔");
    // The interface is in English, and the diary is in Chinese.
    expect(
      resolveEmotionKey(
        chinese,
        (key) => translate("en", key as any),
        (key) => translate("zh", key as any),
      ),
    ).toBe("warm");
  });

  it("is found in the other language too", () => {
    const english = translate("en", "emotions.playful.label");
    // The interface is in Chinese, and the diary is in English.
    expect(
      resolveEmotionKey(
        english,
        (key) => translate("zh", key as any),
        (key) => translate("en", key as any),
      ),
    ).toBe("playful");
  });

  it("still prefers the reader's own wording", () => {
    // The mood the reader is reading in is tried first.
    expect(
      resolveEmotionKey(
        translate("zh", "emotions.happy.label"),
        (key) => translate("zh", key as any),
        (key) => translate("en", key as any),
      ),
    ).toBe("happy");
  });
});
