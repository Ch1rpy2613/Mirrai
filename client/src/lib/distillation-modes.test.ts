import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import { en } from "@/i18n/en";
import { DISTILLATION_PRESETS } from "@shared/distillation-modes";

/**
 * The distillation presets in the interface.
 *
 * A preset is only useful if the user can tell what it does — which means
 * every preset needs a name and an explanation, in both languages, and
 * they have to be different: an untranslated preset is a preset nobody can
 * choose.
 */

/** Reads a dotted key out of a dictionary. */
function lookup(dictionary: unknown, key: string): string | undefined {
  const value = key.split(".").reduce<any>(
    (acc, part) => (acc == null ? acc : acc[part]),
    dictionary,
  );
  return typeof value === "string" ? value : undefined;
}

describe("the distillation presets in the interface", () => {
  it("gives every preset a name and an explanation in both languages", () => {
    const missing: string[] = [];
    for (const preset of DISTILLATION_PRESETS) {
      for (const key of [preset.labelKey, preset.descriptionKey]) {
        for (const [name, dictionary] of [["zh", zh], ["en", en]] as const) {
          const value = lookup(dictionary, key);
          if (!value || !value.trim()) missing.push(`${name}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("does not leave the English label in the Chinese dictionary", () => {
    const same: string[] = [];
    for (const preset of DISTILLATION_PRESETS) {
      for (const key of [preset.labelKey, preset.descriptionKey]) {
        if (lookup(zh, key) === lookup(en, key)) same.push(key);
      }
    }
    expect(same).toEqual([]);
  });

  it("tells the user what a preset costs", () => {
    // The estimate of the model calls is the one number a user cannot
    // guess, so it has to be in the dictionary and it has to carry the
    // placeholder.
    const calls = lookup(zh, "distillation.calls");
    expect(calls).toContain("{{count}}");
    expect(lookup(en, "distillation.calls")).toContain("{{count}}");
  });

  it("tells the user how much material a preset reads", () => {
    expect(lookup(zh, "distillation.sample")).toContain("{{count}}");
    expect(lookup(en, "distillation.photos")).toContain("{{count}}");
  });
});
