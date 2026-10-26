import { describe, expect, it } from "vitest";
import { careBannerText } from "./care-note";
import { zh } from "@/i18n/zh";
import { en } from "@/i18n/en";

/**
 * The safety banner.
 *
 * The care note itself is appended to the persona's reply by the server.
 * The banner is the application's own line, and it has to be a *different*
 * line: showing the note in both places meant the user read the same
 * sentence twice — once as a message and once as a toast.
 */

/** A translator that reads the real dictionaries. */
function translator(locale: "zh" | "en") {
  const dictionary = locale === "en" ? en : zh;
  return (key: string) => {
    const value = key.split(".").reduce<any>((acc, part) => (acc == null ? acc : acc[part]), dictionary);
    return typeof value === "string" ? value : key;
  };
}

describe("the care banner", () => {
  it("says nothing when the note did not ask for a banner", () => {
    expect(careBannerText({ kind: "long_session", text: "…", showBanner: false }, translator("zh"))).toBe("");
    expect(careBannerText({ kind: "long_session", text: "…" }, translator("zh"))).toBe("");
    expect(careBannerText(null, translator("zh"))).toBe("");
  });

  it("says something when the note asked for one", () => {
    const banner = careBannerText(
      { kind: "dependency", text: "…", showBanner: true },
      translator("zh"),
    );
    expect(banner).not.toBe("");
    expect(banner).toBe(zh.safety.usageBanner);
  });

  it("follows the interface language", () => {
    const zhBanner = careBannerText({ kind: "usage", text: "…", showBanner: true }, translator("zh"));
    const enBanner = careBannerText({ kind: "usage", text: "…", showBanner: true }, translator("en"));
    expect(zhBanner).toBe(zh.safety.usageBanner);
    expect(enBanner).toBe(en.safety.usageBanner);
    expect(enBanner).not.toBe(zhBanner);
  });

  it("is the line that matches the note", () => {
    // The dependency warning is the product's own named safety risk.
    // It used to reach the user dressed as a rest suggestion.
    const dependency = careBannerText(
      { kind: "dependency", text: "…", textKey: "safety.care.dependency", showBanner: true },
      translator("zh"),
    );
    expect(dependency).toBe(zh.safety.banner.dependency);
    expect(dependency).not.toBe(zh.safety.usageBanner);

    const daily = careBannerText(
      { kind: "daily_frequency", text: "…", textKey: "safety.care.dailyLimit", showBanner: true },
      translator("zh"),
    );
    expect(daily).toBe(zh.safety.banner.dailyLimit);
  });

  it("is not the note's own text", () => {
    // The note goes into the reply. The banner is a different sentence.
    const note = { kind: "dependency", text: "the note itself", showBanner: true };
    expect(careBannerText(note, translator("zh"))).not.toBe(note.text);
  });

  it("stays quiet when the dictionary does not know the wording", () => {
    // A client whose dictionary is behind the server should show nothing
    // rather than the key itself.
    const banner = careBannerText(
      { kind: "usage", text: "…", showBanner: true },
      (key: string) => key,
    );
    expect(banner).toBe("");
  });
});
