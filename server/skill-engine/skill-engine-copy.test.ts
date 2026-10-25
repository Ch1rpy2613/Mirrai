import { describe, expect, it } from "vitest";
import { buildResearchDraftSkill } from "./celebrity";

/**
 * The skill engine in two languages.
 *
 * The draft skill is not only read by a person — it is counted. The quality
 * gate (`skill-engine/tools/research/quality_check.py`) looks for a handful
 * of words in the rendered draft, and it knows them in Chinese and in
 * English. If the English draft stops using the spellings the gate
 * recognises, an English run quietly fails its own gate.
 *
 * These are the same patterns the gate uses.
 */
const GATE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "mental_models", pattern: /mental model|心智模型/i },
  { name: "limitations", pattern: /limitations|boundary|局限|边界/i },
  { name: "expression_dna", pattern: /expression DNA|表达 DNA|sentence rhythm|metaphor/i },
  { name: "honest_boundaries", pattern: /honest boundar|诚实边界|what .* does not know/i },
  { name: "internal_tension", pattern: /contradiction|tension|矛盾|张力/i },
  { name: "intellectual_genealogy", pattern: /intellectual genealogy|influenced by|智识谱系|influenced:/i },
  { name: "agentic_protocol", pattern: /agentic protocol|research dimensions|step 1.*classify|分析协议/i },
];

const draftInput = {
  name: "Someone",
  slug: "someone_1",
  profile: "budget-unfriendly",
  digest: "digest",
  findings: ["A finding"],
  mentalModels: [
    {
      name: "Cost prior",
      definition: "Count the cost before the plan",
      evidence_anchors: "01_writings.md · weight 2",
      sees_first: "The ratio of effort to return",
      filters_out: "Sunk-cost arguments",
      failure_mode: "When the return is invisible in the short window",
    },
  ],
  knownAnswers: [{ question: "How would they judge a new project?", evidence_anchors: "04_decisions.md · weight 4" }],
  edgeCase: {
    question: "How would they handle a conflict in the team?",
    why: "They have never talked about managing people in public",
    approach: "Call on the cost prior and on the reversibility of decisions",
  },
  contradictions: ["Temporal: they opposed outsourcing early and built a team later"],
  boundaries: ["Fewer than 10 sources — a cold figure"],
  genealogy: ["《Thinking, Fast and Slow》｜source: long interview｜note: where the decision framework comes from"],
  sources: ["https://example.com/interview-01"],
};

describe("the research draft in English", () => {
  const draft = buildResearchDraftSkill({ ...draftInput, locale: "en" });

  it("uses the headings the quality gate counts on", () => {
    for (const { name, pattern } of GATE_PATTERNS) {
      expect(pattern.test(draft), `the gate's ${name} check does not match the English draft`).toBe(
        true,
      );
    }
  });

  it("keeps the markers the merge counter counts on", () => {
    expect(draft).toContain("- Question: ");
    expect(draft).toContain("Evidence anchors:");
    expect(draft).toContain("Edge-Case");
  });

  it("says the same things as the Chinese draft", () => {
    const chinese = buildResearchDraftSkill({ ...draftInput, name: "某人", locale: "zh" });
    // The Chinese draft keeps its Chinese headings; the English one carries
    // the same sections in the other language.
    expect(chinese).toContain("心智模型");
    expect(chinese).toContain("诚实边界");
    expect(draft).toContain("Mental models");
    expect(draft).toContain("Honest boundaries");
    expect(chinese.split("\n").length).toBe(draft.split("\n").length);
  });
});

describe("the research draft in Chinese", () => {
  it("is what it always was", () => {
    const draft = buildResearchDraftSkill({ ...draftInput, name: "某人" });
    expect(draft).toContain("## PART A：工作能力");
    expect(draft).toContain("### 研究要点");
    expect(draft).toContain("### 心智模型");
    expect(draft).toContain("### 表达 DNA");
    expect(draft).toContain("### 智识谱系");
    expect(draft).toContain("### 分析协议");
    expect(draft).toContain("### 来源");
    expect(draft).toContain("### 已知答案");
    expect(draft).toContain("## PART B：人物性格");
    expect(draft).toContain("### 矛盾与张力");
    expect(draft).toContain("### 诚实边界");
    expect(draft).toContain("### Edge-Case Candidate（边界案例）");
    expect(draft).toContain("## 运行规则");
  });
});
