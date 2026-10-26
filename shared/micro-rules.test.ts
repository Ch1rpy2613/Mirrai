import { describe, expect, it } from "vitest";
import {
  activeMicroRules,
  matchesMicroRule,
  normalizeMicroRules,
  renderMicroRules,
  type MicroRule,
} from "./micro-rules";

/**
 * The rules.
 *
 * A rule is only worth having if it can be obeyed, so the tests here are
 * mostly about what happens to a rule that is incomplete, unverified, or
 * pretending to be something it is not.
 */
const rule: MicroRule = {
  id: "r1",
  trigger: ["随便你", "随便"],
  meaning: "她真的生气了",
  rendering: "更短、更冷，不解释",
  confidence: 0.8,
  source: "manual",
  verified: true,
  evidence: [{ at: "2024-03-02", snippet: "随便你" }],
};

describe("normalising the rules", () => {
  it("keeps a complete rule", () => {
    const rules = normalizeMicroRules([rule]);
    expect(rules).toHaveLength(1);
    expect(rules[0].trigger).toEqual(["随便你", "随便"]);
    expect(rules[0].source).toBe("manual");
  });

  it("drops a rule with nothing to obey", () => {
    const rules = normalizeMicroRules([
      { trigger: [], meaning: "x", rendering: "y" },
      { trigger: ["a"], meaning: "", rendering: "y" },
      { trigger: ["a"], meaning: "x", rendering: "" },
      rule,
    ]);
    expect(rules).toHaveLength(1);
  });

  it("accepts the trigger as a delimited string", () => {
    const rules = normalizeMicroRules([
      { trigger: "随便你、随便", meaning: "生气", rendering: "变冷" },
    ]);
    expect(rules[0].trigger).toEqual(["随便你", "随便"]);
  });

  it("marks a mined rule as unconfirmed until the user says so", () => {
    const rules = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y", source: "auto" },
    ]);
    expect(rules[0].verified).toBe(false);
    expect(rules[0].source).toBe("auto");
  });

  it("keeps the evidence, and drops evidence with no text", () => {
    const rules = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y", evidence: [{ snippet: "原文" }, { at: "x" }] },
    ]);
    expect(rules[0].evidence).toHaveLength(1);
    expect(rules[0].evidence[0].snippet).toBe("原文");
  });

  it("is empty when there is nothing stored", () => {
    expect(normalizeMicroRules(null)).toEqual([]);
    expect(normalizeMicroRules("nonsense")).toEqual([]);
  });

  it("skips an entry that is not a rule at all", () => {
    const rules = normalizeMicroRules([null, "nonsense", 42, rule]);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("r1");
  });

  it("reads the parts of a rule as text", () => {
    const rules = normalizeMicroRules([
      { trigger: ["a"], meaning: 42, rendering: true },
    ]);
    expect(rules[0].meaning).toBe("42");
    expect(rules[0].rendering).toBe("true");
  });

  it("reads the triggers as text and drops the empty ones", () => {
    const rules = normalizeMicroRules([
      { trigger: [1, "", "b"], meaning: "x", rendering: "y" },
    ]);
    expect(rules[0].trigger).toEqual(["1", "b"]);
  });

  it("gives a rule with no id an id of its own", () => {
    const rules = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y" },
    ]);
    expect(rules[0].id).toBe("rule-1");
  });

  it("keeps a rule the user wrote even when they have not confirmed it", () => {
    const rules = normalizeMicroRules([
      {
        trigger: ["a"],
        meaning: "x",
        rendering: "y",
        source: "manual",
        verified: false,
      },
    ]);
    // The user's own rule is theirs; it is kept, and it is kept unverified.
    expect(rules).toHaveLength(1);
    expect(rules[0].verified).toBe(false);
  });

  it("keeps a mined rule the user has confirmed", () => {
    const rules = normalizeMicroRules([
      {
        trigger: ["a"],
        meaning: "x",
        rendering: "y",
        source: "auto",
        verified: true,
      },
    ]);
    expect(rules[0].verified).toBe(true);
    expect(rules[0].source).toBe("auto");
  });

  it("reads the confidence as a number", () => {
    expect(
      normalizeMicroRules([
        { trigger: ["a"], meaning: "x", rendering: "y", confidence: "0.9" },
      ])[0].confidence,
    ).toBe(0.9);
  });

  it("gives a confidence it cannot read the middle of the road", () => {
    expect(
      normalizeMicroRules([
        { trigger: ["a"], meaning: "x", rendering: "y", confidence: "abc" },
      ])[0].confidence,
    ).toBe(0.5);
  });

  it("keeps a confidence inside the scale it is on", () => {
    const high = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y", confidence: 2 },
    ]);
    const low = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y", confidence: -1 },
    ]);
    expect(high[0].confidence).toBe(1);
    expect(low[0].confidence).toBe(0);
  });

  it("has no evidence when the evidence is not a list", () => {
    const rules = normalizeMicroRules([
      { trigger: ["a"], meaning: "x", rendering: "y", evidence: "原文" },
    ]);
    expect(rules[0].evidence).toEqual([]);
  });

  it("skips evidence that is not an evidence", () => {
    const rules = normalizeMicroRules([
      {
        trigger: ["a"],
        meaning: "x",
        rendering: "y",
        evidence: [null, "原文", { snippet: "真的" }],
      },
    ]);
    expect(rules[0].evidence).toHaveLength(1);
    expect(rules[0].evidence[0].snippet).toBe("真的");
  });
});

describe("which rules are said out loud", () => {
  it("hides a rule the user has not confirmed", () => {
    const candidate: MicroRule = { ...rule, source: "auto", verified: false };
    expect(activeMicroRules([candidate])).toHaveLength(0);
    expect(activeMicroRules([candidate], true)).toHaveLength(1);
  });

  it("says a confirmed rule", () => {
    expect(activeMicroRules([rule])).toHaveLength(1);
  });
});

describe("matching a rule against a line", () => {
  it("fires when the trigger is in the line", () => {
    expect(matchesMicroRule(rule, "随便你")).toBe(true);
  });

  it("does not fire otherwise", () => {
    expect(matchesMicroRule(rule, "好的")).toBe(false);
  });

  it("does not fire on an empty line", () => {
    expect(matchesMicroRule(rule, "")).toBe(false);
  });

  it("does not fire on a trigger that is nothing", () => {
    expect(matchesMicroRule({ ...rule, trigger: [""] }, "随便你")).toBe(false);
  });
});

describe("writing the rules for the model", () => {
  it("says nothing when there is nothing to say", () => {
    expect(renderMicroRules([], "zh")).toBe("");
    expect(renderMicroRules([{ ...rule, verified: false }], "zh")).toBe("");
  });

  it("writes the trigger, the meaning and the rendering", () => {
    const text = renderMicroRules([rule], "zh");
    expect(text).toContain("随便你");
    expect(text).toContain("她真的生气了");
    expect(text).toContain("更短、更冷，不解释");
  });

  it("writes the framing in English and keeps the person's own words", () => {
    const text = renderMicroRules([rule], "en");
    // The framing is the app's, so it is translated. The meaning and the
    // rendering are the user's own writing, and they stay in the language
    // they were written in.
    expect(text).toContain("Discriminative rules");
    expect(text).toContain("她真的生气了");
  });
});
