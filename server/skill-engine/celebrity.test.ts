import { describe, expect, it } from "vitest";
import {
  buildResearchDraftSkill,
  ensureResearchSections,
  extractSummaryFindings,
  normalizeResearchNote,
  parseSummaryFields,
  resolveCelebrityProfile,
  sanitizeForCopyright,
} from "./celebrity";
import { skillSlug } from "./pipeline";

describe("resolveCelebrityProfile", () => {
  it("ignores research profiles for other families", () => {
    expect(resolveCelebrityProfile("relationship", "budget-unfriendly")).toEqual({
      profile: null,
      hasResearchStages: false,
    });
    expect(resolveCelebrityProfile("colleague", "budget-unfriendly")).toEqual({
      profile: null,
      hasResearchStages: false,
    });
  });

  it("keeps the historical path when no profile is selected", () => {
    expect(resolveCelebrityProfile("celebrity", null)).toEqual({
      profile: null,
      hasResearchStages: false,
    });
    expect(resolveCelebrityProfile("celebrity", "")).toEqual({
      profile: null,
      hasResearchStages: false,
    });
  });

  it("only unlocks the research flow for a profile with all four stages", () => {
    expect(resolveCelebrityProfile("celebrity", "budget-unfriendly")).toEqual({
      profile: "budget-unfriendly",
      hasResearchStages: true,
    });
    // budget-friendly declares research but no audit/synthesis/validation.
    expect(resolveCelebrityProfile("celebrity", "budget-friendly")).toEqual({
      profile: "budget-friendly",
      hasResearchStages: false,
    });
  });

  it("ignores an unknown profile", () => {
    expect(resolveCelebrityProfile("celebrity", "does-not-exist")).toEqual({
      profile: null,
      hasResearchStages: false,
    });
  });
});

describe("normalizeResearchNote", () => {
  it("repairs the source weight spelling the counter needs", () => {
    const note = normalizeResearchNote("- Source weight: [3]");
    expect(note).toContain("Source weight: 3");
    expect(note).not.toContain("[3]");
  });

  it("repairs the primary source marker", () => {
    expect(normalizeResearchNote("- Grounding level: 一手材料")).toContain(
      "- Grounding level: 一手",
    );
    expect(normalizeResearchNote("- Grounding level: primary source")).toContain(
      "- Grounding level: 一手",
    );
    expect(normalizeResearchNote("- Grounding level: secondary")).toContain(
      "- Grounding level: 二手",
    );
  });
});

describe("ensureResearchSections", () => {
  it("adds the sections the model skipped", () => {
    const note = ensureResearchSections("# Writings\n\n## Evidence\n- 一条证据");
    expect(note).toContain("## Patterns and Repeated Themes");
    expect(note).toContain("## Contradictions");
    expect(note).toContain("## Gaps and Missing Information");
  });

  it("never invents a source metadata block", () => {
    const note = ensureResearchSections("# Writings\n\n## Evidence\n- 一条证据");
    expect(note).not.toContain("## Source Metadata");
  });
});

describe("sanitizeForCopyright", () => {
  it("removes code fences, quote markers and timestamps", () => {
    const dirty = ["```md", "```", "> 引用行", "发生在 12:30:45 的事", "普通文本"].join("\n");
    const clean = sanitizeForCopyright(dirty);
    expect(clean).not.toContain("```");
    expect(clean).not.toContain("12:30:45");
    expect(clean.split("\n").some((line) => line.trimStart().startsWith(">"))).toBe(false);
    expect(clean).toContain("普通文本");
  });
});

describe("summary parsing", () => {
  const summary = [
    "# Research Summary",
    "",
    "- Files scanned: 6",
    "- Unique URLs: 9",
    "",
    "## Key Findings",
    "",
    "- 关键发现一",
    "- 关键发现二",
  ].join("\n");

  it("reads the metric fields", () => {
    const fields = parseSummaryFields(summary);
    expect(fields["Files scanned"]).toBe("6");
    expect(fields["Unique URLs"]).toBe("9");
  });

  it("collects the key findings", () => {
    expect(extractSummaryFindings(summary)).toEqual(["关键发现一", "关键发现二"]);
  });
});

describe("buildResearchDraftSkill", () => {
  const draft = buildResearchDraftSkill({
    name: "测试人物",
    slug: "test_1",
    profile: "budget-unfriendly",
    digest: "digest",
    findings: ["关键发现一"],
    mentalModels: [
      {
        name: "成本先验",
        definition: "先算成本再谈方案",
        evidence_anchors: "01_writings.md · 权重 2",
        sees_first: "投入产出比",
        filters_out: "沉没成本论证",
        failure_mode: "短期窗口看不到收益时",
      },
    ],
    knownAnswers: [{ question: "他会如何评估一个新项目？", evidence_anchors: "04_decisions.md · 权重 4" }],
    edgeCase: {
      question: "他会如何处理团队冲突？",
      why: "没有公开谈过人事处理",
      approach: "调用成本先验与决策可逆性",
    },
    contradictions: ["Temporal：早期反对外包，后期自建团队"],
    boundaries: ["来源数不足 10，属于冷人物"],
    genealogy: ["《思考，快与慢》｜来源：长访谈｜note：决策框架的来源"],
    sources: ["https://example.com/interview-01"],
  });

  it("carries the sections the quality gate looks for", () => {
    expect(draft).toContain("心智模型");
    expect(draft).toContain("诚实边界");
    expect(draft).toContain("矛盾");
    expect(draft).toContain("- Question: ");
    expect(draft).toContain("Edge-Case");
    expect(draft).toContain("智识谱系");
    expect(draft).toContain("分析协议");
    expect(draft).toContain("https://example.com/interview-01");
  });

  it("stays inside the copyright rules", () => {
    expect(draft).not.toContain("```");
    expect(draft.split("\n").some((line) => line.trimStart().startsWith(">"))).toBe(false);
    expect(draft).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("skillSlug", () => {
  it("keeps ascii names readable", () => {
    expect(skillSlug("Alice Smith", 7)).toBe("alice_smith_7");
  });

  it("falls back for names without ascii characters", () => {
    expect(skillSlug("张三", 7)).toBe("persona_7");
  });
});
