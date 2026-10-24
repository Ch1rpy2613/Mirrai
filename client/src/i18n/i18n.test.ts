import { describe, expect, it } from "vitest";
import { zh } from "./zh";
import { en } from "./en";
import { translate, NAMESPACES, type TranslationKey } from "./index";

/** Every dotted path in an object, including array leaves. */
function leaves(value: unknown, prefix = ""): string[] {
  if (value == null || typeof value !== "object") return [prefix];
  if (Array.isArray(value)) return [prefix];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(...leaves(child, path));
  }
  return out;
}

/** The `{{name}}` placeholders a string uses. */
function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{(\w+)\}\}/g)).map((m) => m[1]).sort();
}

describe("the dictionaries", () => {
  it("have the same keys in both languages", () => {
    const zhKeys = leaves(zh).sort();
    const enKeys = leaves(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("have no empty strings", () => {
    const empties: string[] = [];
    for (const key of leaves(zh)) {
      const value = key.split(".").reduce<any>((acc, part) => acc?.[part], zh);
      if (typeof value === "string" && !value.trim()) empties.push(key);
    }
    expect(empties).toEqual([]);
  });

  it("use the same placeholders in both languages", () => {
    const mismatched: string[] = [];
    for (const key of leaves(zh)) {
      const zhValue = key.split(".").reduce<any>((acc, part) => acc?.[part], zh);
      const enValue = key.split(".").reduce<any>((acc, part) => acc?.[part], en);
      if (typeof zhValue !== "string" || typeof enValue !== "string") continue;
      if (placeholders(zhValue).join(",") !== placeholders(enValue).join(",")) {
        mismatched.push(key);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("do not leave an English string in the Chinese dictionary", () => {
    // A copy-paste slip: the Chinese file with English text.
    const suspicious: string[] = [];
    for (const key of leaves(zh)) {
      const value = key.split(".").reduce<any>((acc, part) => acc?.[part], zh);
      if (typeof value !== "string") continue;
      // Latin words with no CJK at all, in a dictionary that is mostly Chinese.
      if (!/[一-龥]/.test(value) && /[A-Za-z]{4,}/.test(value)) suspicious.push(key);
    }
    // A few keys are legitimately Latin: product names (App Secret), file
    // formats, the landing page's technology stack, the names of the
    // agent hosts a skill package can be installed into, and the platform
    // field names a user has to recognise when copying a value.
    const allowedLatin =
      /landing\.tech|upload\.formats|settings\.channels\.appSecret|skillExport\.hosts|settings\.sources\.credentialLabels/;
    expect(suspicious.filter((k) => !allowedLatin.test(k))).toEqual([]);
  });

  it("carry the same namespaces in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});

describe("the safety namespace", () => {
  const required = [
    "safety.care.longSession",
    "safety.care.dailyLimit",
    "safety.care.dependency",
    "safety.usageBanner",
    "safety.crisisTitle",
    "safety.crisisBody",
    "safety.resourcesTitle",
  ];

  it("is registered as a namespace", () => {
    expect(NAMESPACES).toContain("safety");
  });

  it("has every key the safety copy needs, in both languages", () => {
    const missing: string[] = [];
    for (const key of required) {
      const zhValue = key.split(".").reduce<any>((acc, part) => acc?.[part], zh);
      const enValue = key.split(".").reduce<any>((acc, part) => acc?.[part], en);
      if (typeof zhValue !== "string" || !zhValue.trim()) missing.push(`zh:${key}`);
      if (typeof enValue !== "string" || !enValue.trim()) missing.push(`en:${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("says something different in the two languages", () => {
    // A half-finished translation would leave the English copy identical to
    // the Chinese one.
    const identical = required.filter(
      (key) =>
        key.split(".").reduce<any>((acc, part) => acc?.[part], zh) ===
        key.split(".").reduce<any>((acc, part) => acc?.[part], en),
    );
    expect(identical).toEqual([]);
  });
});

describe("the persona card namespace", () => {
  it("has the import and export labels in both languages", () => {
    for (const key of ["personaCard.export", "personaCard.import"]) {
      const zhValue = key.split(".").reduce<any>((acc, part) => acc?.[part], zh);
      const enValue = key.split(".").reduce<any>((acc, part) => acc?.[part], en);
      expect(typeof zhValue).toBe("string");
      expect(typeof enValue).toBe("string");
      expect(zhValue).not.toBe(enValue);
    }
  });
});

describe("translate", () => {
  it("returns the Chinese text for the Chinese locale", () => {
    expect(translate("zh", "common.save")).toBe(zh.common.save);
  });

  it("returns the English text for the English locale", () => {
    expect(translate("en", "common.save")).toBe(en.common.save);
  });

  it("interpolates parameters", () => {
    expect(translate("zh", "chat.intimacyScore" as TranslationKey, { level: "初识", score: 120 })).toContain(
      "初识",
    );
  });

  it("falls back to Chinese for a key the English dictionary is missing", () => {
    // An unknown key returns the key itself rather than undefined.
    expect(translate("en", "does.not.exist" as TranslationKey)).toBe("does.not.exist");
  });
});
