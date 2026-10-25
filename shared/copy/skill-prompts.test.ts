import { describe, expect, it } from "vitest";
import { SKILL_PROMPTS } from "./skill-prompts";

/**
 * The skill engine's prompt dictionary.
 *
 * These strings are read by a language model, so the rules are stricter
 * than for ordinary copy: a missing English half is not a missing label,
 * it is an instruction the model cannot follow, and a Chinese string left
 * in the English half is an instruction the model will read in the wrong
 * language.
 *
 * The Chinese is the original — the app has always said it — so it must
 * keep its Chinese characters. The English half must be free of them.
 */
describe("the skill engine's prompts", () => {
  it("has both languages for every entry", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(SKILL_PROMPTS)) {
      if (!entry.zh || !entry.zh.trim()) missing.push(`${key} (zh)`);
      if (!entry.en || !entry.en.trim()) missing.push(`${key} (en)`);
    }
    expect(missing).toEqual([]);
  });

  it("never leaves a Chinese string in the English half", () => {
    const han = /[一-鿿]/;
    const offenders = Object.entries(SKILL_PROMPTS)
      .filter(([, entry]) => han.test(entry.en))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("never leaves an English string in the Chinese half", () => {
    const offenders = Object.entries(SKILL_PROMPTS)
      .filter(([, entry]) => !/[一-鿿]/.test(entry.zh))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("uses the same placeholders on both sides", () => {
    const placeholders = (text: string) => {
      const found: string[] = [];
      const pattern = /\{\{(\w+)\}\}/g;
      let match = pattern.exec(text);
      while (match) {
        found.push(match[1]);
        match = pattern.exec(text);
      }
      return found.sort();
    };
    const mismatched: string[] = [];
    for (const [key, entry] of Object.entries(SKILL_PROMPTS)) {
      if (placeholders(entry.zh).join(",") !== placeholders(entry.en).join(",")) {
        mismatched.push(key);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("keeps the section headings the machine counters recognise", () => {
    // `tools/research/merge_research.py` counts the notes by their heading
    // and `tools/research/quality_check.py` counts the draft by its
    // vocabulary. Both languages have to spell these the same way.
    const note = SKILL_PROMPTS["skillPrompts.noteContract"];
    for (const heading of [
      "## Collection Metadata",
      "## Source Metadata",
      "## Evidence",
      "## Patterns and Repeated Themes",
      "## Contradictions",
      "## Inferences (clearly marked)",
      "## Gaps and Missing Information",
      "## Known-Answer Candidates",
    ]) {
      expect(note.zh).toContain(heading);
      expect(note.en).toContain(heading);
    }

    // The JSON contracts keep their keys in both languages.
    const synthesis = SKILL_PROMPTS["skillPrompts.synthesisContract"];
    const validation = SKILL_PROMPTS["skillPrompts.validationContract"];
    for (const key of ["summary", "mental_models", "edge_case", "intellectual_genealogy"]) {
      expect(synthesis.zh).toContain(key);
      expect(synthesis.en).toContain(key);
    }
    for (const key of ["status", "release_readiness", "required_revisions"]) {
      expect(validation.zh).toContain(key);
      expect(validation.en).toContain(key);
    }
  });
});
