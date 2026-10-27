import { describe, expect, it } from "vitest";
import { parseRecalledIds } from "./user-side";
import { normalizeMicroRules } from "./micro-rules";

/**
 * The little coercions that decide what the app says.
 *
 * Both of them turned "nothing was stored" into a number that reads as
 * a measurement: a rule with no confidence came out as "0% certain",
 * and a memory list with a null in it came out as the memory with the
 * id zero.
 */
describe("the memories a message recorded", () => {
  it("reads the ids that are there", () => {
    expect(parseRecalledIds("[3,5,7]")).toEqual([3, 5, 7]);
  });

  it("does not turn a null into the memory with the id zero", () => {
    // `Number(null)` is zero — and the id zero is not a memory.
    expect(parseRecalledIds("[null]")).toEqual([]);
    expect(parseRecalledIds("[1,null,2]")).toEqual([1, 2]);
  });

  it("does not turn an empty string into the memory with the id zero", () => {
    expect(parseRecalledIds('[""]')).toEqual([]);
  });

  it("reads nothing out of a malformed value", () => {
    expect(parseRecalledIds("not json")).toEqual([]);
    expect(parseRecalledIds('{"a":1}')).toEqual([]);
    expect(parseRecalledIds(null)).toEqual([]);
  });
});

describe("the confidence of a rule", () => {
  it("is unknown when nothing was stored", () => {
    const rules = normalizeMicroRules([
      { trigger: ["嗯"], meaning: "在想事情", rendering: "……", confidence: undefined },
    ]);
    // The middle of the scale — which is what "unknown" means. It used
    // to be zero, which reads as "we checked and it is worthless".
    expect(rules[0]?.confidence).toBe(0.5);
  });

  it("is zero when zero was stored", () => {
    const rules = normalizeMicroRules([
      { trigger: ["嗯"], meaning: "在想事情", rendering: "……", confidence: 0 },
    ]);
    expect(rules[0]?.confidence).toBe(0);
  });

  it("reads the number that was stored", () => {
    const rules = normalizeMicroRules([
      { trigger: ["嗯"], meaning: "在想事情", rendering: "……", confidence: 0.8 },
    ]);
    expect(rules[0]?.confidence).toBe(0.8);
  });
});
