import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Two client defects the second-pass audit found.
 *
 * Both were invisible to the test suite: the limits the interface
 * enforced were the server's numbers in the wrong scope, and a state
 * the interface had no wording for fell through to another state's.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the trigger field", () => {
  it("allows the whole list, not one trigger's worth", () => {
    const editor = read("client/src/components/MicroRulesEditor.tsx");
    /**
     * The server's limit is per trigger: `trigger: z.array(z.string()
     * .max(40)).min(1).max(12)`. The field holds the *list*, so a
     * forty-character cap on the field meant a user typing two long
     * triggers could not finish the second one — the caret just
     * stopped moving, with no error and no explanation.
     */
    expect(editor).toMatch(/maxLength=\{MICRO_RULE_TRIGGER_MAX \* MICRO_RULE_TRIGGER_COUNT_MAX\}/);
  });

  it("checks the limit per trigger, and says so", () => {
    const editor = read("client/src/components/MicroRulesEditor.tsx");
    expect(editor).toMatch(/trigger\.find\(\(one\) => one\.length > MICRO_RULE_TRIGGER_MAX\)/);
    expect(editor).toMatch(/microRules\.triggerTooLong/);
    expect(editor).toMatch(/microRules\.tooManyTriggers/);
  });

  it("has the wording in both languages", () => {
    for (const file of ["client/src/i18n/zh.ts", "client/src/i18n/en.ts"]) {
      const source = read(file);
      expect(source, file).toMatch(/triggerTooLong:/);
      expect(source, file).toMatch(/tooManyTriggers:/);
    }
  });
});

describe("a letter kept for oneself", () => {
  it("is badged as what it is", () => {
    const letters = read("client/src/components/OutboundLetters.tsx");
    /**
     * The badge knew three states and fell through to the draft label
     * for everything else — so a letter the user had kept for
     * themselves (the server's status "self") was badged 「还在写」 /
     * "Still writing", which is the opposite of what they had just
     * done. There was no wording for that state at all.
     */
    expect(letters).toMatch(/letter\.status === "self"/);
    expect(letters).toMatch(/outbound\.statusSelf/);
  });

  it("does not offer the buttons of a letter already decided", () => {
    const letters = read("client/src/components/OutboundLetters.tsx");
    expect(letters).toMatch(
      /letter\.status !== "sent" && letter\.status !== "dropped" && letter\.status !== "self"/,
    );
  });

  it("has the wording in both languages", () => {
    for (const file of ["client/src/i18n/zh.ts", "client/src/i18n/en.ts"]) {
      const source = read(file);
      expect(source, file).toMatch(/statusSelf:/);
    }
  });
});
