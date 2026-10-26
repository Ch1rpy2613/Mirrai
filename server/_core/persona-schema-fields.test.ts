import { describe, expect, it } from "vitest";
import {
  PERSONA_DATA_FIELDS,
  PERSONA_DOCUMENT_EXCLUDED_FIELDS,
  PERSONA_DOCUMENT_FIELDS,
} from "./persona-schema";

/**
 * The list of the persona's fields, and the list of the ones the
 * generated document carries.
 *
 * The schema says it owns the first list "instead of being duplicated
 * as a string literal in two different prompts" — but nothing read it,
 * so the two could drift apart without anybody noticing.
 *
 * This test says the same thing about the split between the two lists:
 * every field is either in the document or deliberately left out of it,
 * and nothing is in both.
 */
describe("the persona's fields", () => {
  it("are all accounted for", () => {
    const accounted = new Set([
      ...PERSONA_DOCUMENT_FIELDS,
      ...PERSONA_DOCUMENT_EXCLUDED_FIELDS,
    ]);
    const missing = PERSONA_DATA_FIELDS.filter((field) => !accounted.has(field));
    expect(missing).toEqual([]);
  });

  it("are not in both lists", () => {
    const inBoth = PERSONA_DOCUMENT_FIELDS.filter((field) =>
      PERSONA_DOCUMENT_EXCLUDED_FIELDS.includes(field),
    );
    expect(inBoth).toEqual([]);
  });

  it("are not repeated inside a list", () => {
    expect(new Set(PERSONA_DATA_FIELDS).size).toBe(PERSONA_DATA_FIELDS.length);
    expect(new Set(PERSONA_DOCUMENT_FIELDS).size).toBe(PERSONA_DOCUMENT_FIELDS.length);
    expect(new Set(PERSONA_DOCUMENT_EXCLUDED_FIELDS).size).toBe(
      PERSONA_DOCUMENT_EXCLUDED_FIELDS.length,
    );
  });
});
