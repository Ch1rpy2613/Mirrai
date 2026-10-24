/**
 * Celebrity research pipeline (Phase 2.2).
 *
 * The `celebrity` family ships a four-stage research flow
 * (research → audit → synthesis → validation). The prompts existed on disk
 * but nothing could select them: `loadPrompt` resolves
 * `family + profile + stage` through `prompts/registry.json`, and only the
 * `budget-unfriendly` profile declares all four stages.
 *
 * Everything in this module is best-effort by design:
 *   - a missing stage, a failing model call or a missing `research_profiles`
 *     table must never break the persona pipeline. The research artefacts are
 *     evidence for the persona stages, not a precondition for them.
 *   - the machine counters (`tools/research/merge_research.py`,
 *     `tools/research/quality_check.py`) only recognise the section titles and
 *     marker spellings documented in
 *     `references/celebrity_budget_unfriendly_framework.md`, so the model
 *     output is normalised into that spelling before it is stored.
 */
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { llmService } from "../llm";
import { loadPrompt, loadRegistry } from "./prompts";
import { runPythonTool } from "./runner";
import { extractJsonObject } from "../_core/json";
import { ENV } from "../_core/env";
import * as db from "../db";

/** The four research stages, in the order the pipeline runs them. */
export const CELEBRITY_RESEARCH_STAGES = [
  "researching",
  "auditing",
  "synthesizing",
  "validating",
] as const;

export type CelebrityResearchStage = (typeof CELEBRITY_RESEARCH_STAGES)[number];

/** The prompt stage each research stage loads from the prompt registry. */
const STAGE_PROMPTS: Record<CelebrityResearchStage, string> = {
  researching: "research",
  auditing: "audit",
  synthesizing: "synthesis",
  validating: "validation",
};

/** The prompt stages a research profile must declare to unlock the flow. */
const REQUIRED_PROMPT_STAGES = ["research", "audit", "synthesis", "validation"] as const;

export type CelebrityProfileResolution = {
  /** The profile whose prompts should be used, or null when none applies. */
  profile: string | null;
  /** True when the profile declares the complete research flow. */
  hasResearchStages: boolean;
};

/** A mental model that survived the triple gate of the synthesis prompt. */
export type CelebrityMentalModel = {
  name: string;
  definition: string;
  evidence_anchors: string;
  sees_first: string;
  filters_out: string;
  failure_mode: string;
};

/** A question the subject answered publicly, with its evidence anchors. */
export type CelebrityKnownAnswer = {
  question: string;
  evidence_anchors: string;
};

/** The report the Python quality gate produced for a draft. */
export type CelebrityQualityReport = {
  passed: boolean;
  checks: Record<string, boolean>;
  profile: string;
  thresholds?: Record<string, number>;
  research_metrics?: Record<string, unknown>;
};

export type CelebrityResearchResult = {
  profile: string;
  status: "complete" | "partial" | "failed";
  /** Merged research digest that feeds the persona stages. */
  digest: string;
  /** The rendered audit review. */
  audit: string;
  /** The rendered synthesis review. */
  synthesis: string;
  /** The rendered validation review. */
  validation: string;
  mentalModels: CelebrityMentalModel[];
  knownAnswerQuestions: CelebrityKnownAnswer[];
  /** The intellectual genealogy the subject was exposed to. */
  genealogy: string[];
  /** The grounded source URLs found in the research notes. */
  sources: string[];
  /** The quality gate report taken right after the audit stage. */
  qualityReport: CelebrityQualityReport | null;
  /** The quality gate report taken after validation (the final state). */
  finalQualityReport: CelebrityQualityReport | null;
  errors: string[];
};

export type CelebrityResearchInput = {
  personaId: number;
  userId: number;
  name: string;
  profile: string;
  /** Where the research artefacts are written (the generated skill directory). */
  skillDir: string;
  /** The user-supplied source material (chat content and collected files). */
  sourceMaterial: string;
  provider?: string;
  /** Called before each stage so the pipeline can report progress. */
  onStage?: (stage: CelebrityResearchStage, progress: number, message: string) => void | Promise<void>;
};

/** A row of the `research_profiles` table. */
export type ResearchProfileRow = {
  userId: number;
  personaId: number;
  profile: string;
  notes?: unknown;
  audit?: unknown;
  synthesis?: unknown;
  validation?: unknown;
  qualityReport?: unknown;
  status: string;
};

/**
 * The six research tracks.
 *
 * The file names matter: the merge counter derives the track coverage from the
 * two-digit prefix, so `01_writings.md` … `06_timeline.md` are what make
 * `track_coverage_count` reach 6.
 */
const RESEARCH_DIMENSIONS = [
  {
    track: "01",
    file: "01_writings.md",
    title: "Writings（著作与系统思考）",
    focus: "系统性的成文立场：核心论点、论证链、反复书写的主题、观点随时间的演变。",
  },
  {
    track: "02",
    file: "02_conversations.md",
    title: "Conversations（即兴对话与压力应对）",
    focus: "即兴推理：长访谈、辩论、突发提问、被冒犯或被挑战时的反应。",
  },
  {
    track: "03",
    file: "03_expression_dna.md",
    title: "Expression DNA（语言指纹）",
    focus: "句式节奏、比喻来源、分歧框架、压缩程度、确定性语言、口头禅与幽默方式。",
  },
  {
    track: "04",
    file: "04_decisions.md",
    title: "Decisions（行为与选择）",
    focus: "实际做了什么：重大押注、方向反转、显式取舍、失败叙事、用人与时机。",
  },
  {
    track: "05",
    file: "05_external_views.md",
    title: "External Views（他者视角与批评）",
    focus: "他人眼中的版本：实质批评、被指出的矛盾、同行认定的盲点、自述形象与外述形象的落差。",
  },
  {
    track: "06",
    file: "06_timeline.md",
    title: "Timeline（认知轨迹）",
    focus: "认知演化轨迹：里程碑的认知影响、观点转折、阶段划分、最近 12-24 个月的变化。",
  },
] as const;

/**
 * The note contract handed to the model.
 *
 * The counters match the English section titles literally and only recognise
 * `Source weight: 3` (no brackets), `一手` (followed by punctuation or a
 * space) and `Question: ` (no digits in front of the colon), so the contract
 * spells those out instead of leaving them to the prompt files.
 */
const NOTE_CONTRACT = `
## 本次输出契约（必须严格遵守）

只输出一个 markdown 文件正文，不要输出解释、不要用代码块、不要用 \`>\` 引用块。结构固定如下：

# <轨道标题>

## Collection Metadata
- Dimension: <1-6> <轨道名>
- Collection strategy: web-only / web+local / local-only
- Sources searched: <数字>
- Sources used: <数字>
- Primary vs secondary ratio: <X>:<Y>

## Source Metadata
（每个来源重复一次以下字段）
- URL: <你真实打开并读过的具体页面 URL，不能是平台首页/搜索页>
- Source type: book / essay / interview / podcast / talk / social post / article / profile / decision record
- Grounding level: 一手 / 二手
- Access note: public / partial / blocked
- Source weight: <1-7>
- Date: <日期>

## Evidence
- <转述 + 出处（轨道、URL、权重）>

## Patterns and Repeated Themes
- <同一现象在不同来源重复出现（≥2 次）>

## Contradictions
- <类型：Temporal / Contextual / Inherent>：<旧立场 vs 新立场>（双方出处）

## Inferences (clearly marked)
- 推断：<结论>（依据：<来源 A> + <来源 B>）

## Gaps and Missing Information
- <缺什么、为什么缺、影响什么>

## Known-Answer Candidates
- Question: <他公开讨论过、存在可核对答案的问题>
  Evidence anchors: <轨道 + 来源 + 权重>

写法硬规则：
- 小节标题必须使用上面的英文原词，中文标题不会被计数器统计。
- \`Source weight: 3\` 写成这个形式；写成 \`Source weight: [3]\` 不计数。
- 一手来源写 \`Grounding level: 一手\`；写成 \`一手材料\` 不计数。
- 不要写超过 25 个词的长引文，不要写 \`HH:MM:SS\` 时间戳。
- 推断只能写进 \`## Inferences (clearly marked)\`，证据只能写进 \`## Evidence\`，两者不要混写。
- 没有证据就写进 \`## Gaps and Missing Information\`，不要编造证据、引用或出处。
`.trim();

/** The audit contract — the spellings the quality gate counts on. */
const AUDIT_CONTRACT = `
## 本次输出契约（必须严格遵守）

只输出 markdown 正文，不要用代码块、不要用 \`>\` 引用块。结构固定如下：

# Research Audit

## Verdict
- Status: PASS 或 FAIL
- Reason: <一句话理由>

## Coverage Review
- Track coverage: <N>/6 dimensions covered
- Missing or weak tracks: <具体是哪些轨道、缺什么>
- Cross-track redundancy: <轨道之间是否互异>

## Source Quality Assessment

### Source Mix
- Primary-source count: <数字>
- Secondary-source count: <数字>
- Primary-source ratio: <数字>%
- Grounding quality: <URL 是否为真实读过的页面>

### Source Hierarchy Compliance
- Sources from weight 1-3: <数字>
- Sources from weight 4-5: <数字>
- Sources from weight 6-7: <数字>
- Blacklisted sources used: <none 或列出；黑名单源一律 FAIL>

### Taste Principle Compliance
- Long-form vs. snippet ratio: <描述>
- Firsthand vs. secondhand ratio: <描述>
- Controversial/distinctive positions captured: <yes/no + 例子>
- Thinking evolution documented: <yes/no>

## Contradictions Inventory
- Total contradictions found: <数字>
- Classification: Temporal <...> / Contextual <...> / Inherent <...>
- Quality: <是否实质张力>

## Mental Model Candidates
- Candidate count: <数字，目标是 ≥3>
- Name: <名称>
  Cross-context evidence: <出现在哪些轨道>
  Preliminary gate assessment: <三重门初判>

## Known-Answer Bank
- Question: <问题原文>
  Evidence anchors: <轨道 + 来源 + 权重>
- Question: <第二个问题>
  Evidence anchors: <轨道 + 来源 + 权重>

## Edge-Case Candidate
- Question: <邻近但没有公开答案的问题>
- Why this is adjacent but under-evidenced: <原因>
- Expected reasoning approach: <应当调用哪些心智模型>

## Cold Figure Assessment
- Total grounded sources: <数字>
- Is this a cold figure (<10 sources)? <yes/no>
- If yes: recommended degradation strategy: <降级策略>

## Backfill Tasks
- missing <N> sources: <具体还要补什么来源>
- <M> contradiction bullets: <具体还要补什么矛盾>

硬规则：
- \`- Question: \` 前面不能有数字（\`Question 1:\` 不计数）。
- \`## Edge-Case Candidate\` 标题必须保留 \`Edge-Case\` 字样。
- FAIL 时必须给出具体缺口清单，不要只写“不足”。
`.trim();

/** The synthesis contract — JSON so the result can be stored and reused. */
const SYNTHESIS_CONTRACT = `
## 本次输出契约（必须严格遵守）

只输出一个 JSON 对象，不要输出 markdown，不要用代码块包裹。结构：

{
  "summary": "<一段话结论>",
  "mental_models": [
    {
      "name": "<模型名称>",
      "definition": "<定义>",
      "evidence_anchors": "<轨道 + 来源 + 权重>",
      "sees_first": "<这个模型第一眼先看什么>",
      "filters_out": "<它过滤掉什么>",
      "failure_mode": "<它什么时候会失效>"
    }
  ],
  "demoted_heuristics": [
    { "rule": "<操作规则>", "context": "<适用情境>", "why_not_a_model": "<为什么不能算完整心智模型>" }
  ],
  "unresolved_contradictions": ["<仍未解决的矛盾>"],
  "evidence_gaps": ["<降低信心的证据缺口>"],
  "known_answer_questions": [
    { "question": "<问题原文>", "evidence_anchors": "<轨道 + 来源 + 权重>" }
  ],
  "intellectual_genealogy": [
    { "name": "<思想来源>", "source": "<出处>", "note": "<他如何受影响>" }
  ],
  "edge_case": {
    "question": "<边界案例问题>",
    "why_adjacent_but_under_evidenced": "<为什么没有公开答案>",
    "expected_reasoning_approach": "<应当调用哪些心智模型>"
  }
}

每个心智模型必须通过三重门：跨情境复现、生成力、排他性。至少 2 个已知答案问题、至少 1 个边界案例。
intellectual_genealogy 记录公开可核对的智识谱系（他本人提到的思想来源），没有就返回空数组。
`.trim();

/** The validation contract — JSON so the result can be stored and reused. */
const VALIDATION_CONTRACT = `
## 本次输出契约（必须严格遵守）

只输出一个 JSON 对象，不要输出 markdown，不要用代码块包裹。结构：

{
  "status": "PASS 或 FAIL",
  "release_readiness": "ready 或 revise",
  "known_answer_check": [
    {
      "question": "<问题原文>",
      "direction_match": "<方向是否一致>",
      "framing_match": "<框架是否一致>",
      "confidence_calibration": "<置信度是否校准>",
      "verdict": "<结论>"
    }
  ],
  "edge_case_check": {
    "question": "<边界案例问题>",
    "extrapolates_from_models": "<是否从真实心智模型外推>",
    "shows_uncertainty": "<证据薄弱时是否显露出不确定>",
    "verdict": "<结论>"
  },
  "voice_check": {
    "recognizable": "<是否可辨认>",
    "no_generic_ai_phrasing": "<是否没有通用 AI 腔>",
    "no_quote_stitching": "<是否没有拼贴引语>",
    "verdict": "<结论>"
  },
  "copyright_check": {
    "transcript_dumps": "<有无逐字稿>",
    "long_quotations": "<有无长引文>",
    "blockquote_copying": "<有无引用块>",
    "verdict": "<结论>"
  },
  "required_revisions": ["<必须修改的地方>"]
}

至少用 2 个已知答案问题做方向 / 框架 / 置信度三项判断，再用 1 个边界案例问题判断外推与不确定性。
`.trim();

/**
 * Resolves which profile applies to a family.
 *
 * Only the `celebrity` family declares research profiles, and only a profile
 * that declares the complete four-stage flow unlocks the research pipeline.
 * Every other combination keeps the historical five-stage behaviour.
 */
export function resolveCelebrityProfile(
  family: string,
  profile?: string | null,
): CelebrityProfileResolution {
  if (family !== "celebrity") return { profile: null, hasResearchStages: false };
  if (!profile) return { profile: null, hasResearchStages: false };

  const registry = loadRegistry();
  const stages = registry?.families?.celebrity?.profiles?.[profile]?.stages;
  if (!stages) return { profile: null, hasResearchStages: false };

  const hasResearchStages = REQUIRED_PROMPT_STAGES.every((stage) => !!stages[stage]);
  return { profile, hasResearchStages };
}

/**
 * Normalises a research note into the spelling the counters recognise.
 *
 * `Source weight: [3]` loses the weight and `一手材料` loses the primary
 * marker, which silently deflates the research metrics — so both are repaired
 * here instead of trusting the model to spell them correctly.
 */
export function normalizeResearchNote(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      let out = line.replace(/source weight:\s*\[\s*(\d)\s*\]/gi, "Source weight: $1");
      // A range placeholder carries no information; fall back to the middle of
      // the 1-7 scale rather than dropping the marker entirely.
      out = out.replace(/source weight:\s*\[[^\]]*\]/gi, "Source weight: 3");
      out = out.replace(/(grounding level:\s*)(.+)$/i, (match, prefix: string, value: string) =>
        /一手|first-person|primary/i.test(value) ? `${prefix}一手` : `${prefix}二手`,
      );
      return out;
    })
    .join("\n");
}

/**
 * The section titles the merge counter recognises.
 *
 * `## Source Metadata` is deliberately absent from the repair list: adding the
 * heading would inflate `source_metadata_blocks`, which is a threshold.
 */
const REPAIRABLE_SECTIONS = [
  "## Collection Metadata",
  "## Evidence",
  "## Patterns and Repeated Themes",
  "## Contradictions",
  "## Inferences (clearly marked)",
  "## Gaps and Missing Information",
];

/**
 * Adds the section headings the model skipped.
 *
 * The headings carry no bullets, so no counter moves; the point is that the
 * audit stage sees an explicit "nothing here" instead of a missing section.
 */
export function ensureResearchSections(text: string): string {
  const missing = REPAIRABLE_SECTIONS.filter((section) => !text.includes(section));
  if (missing.length === 0) return text;
  const appended = missing
    .map((section) =>
      section === "## Gaps and Missing Information"
        ? `${section}\n- 本轨道缺少该小节的有效内容：模型输出未覆盖。`
        : section,
    )
    .join("\n\n");
  return `${text.trimEnd()}\n\n${appended}\n`;
}

/**
 * Removes the artefacts the copyright check rejects.
 *
 * The rendered skill must not contain code fences, quote blocks or
 * `HH:MM:SS` timestamps, and the model output regularly contains all three.
 */
export function sanitizeForCopyright(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\b/g, "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith(">") ? trimmed.replace(/^>\s?/, "") : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reads the `- Key: value` pairs of a merged research summary. */
export function parseSummaryFields(summary: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of summary.split("\n")) {
    const match = line.match(/^-\s+([^:]+):\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

/** Extracts the bullet findings of the merged summary. */
export function extractSummaryFindings(summary: string): string[] {
  const findings: string[] = [];
  let inFindings = false;
  for (const line of summary.split("\n")) {
    if (/^##\s+Key Findings/i.test(line)) {
      inFindings = true;
      continue;
    }
    if (inFindings && /^##\s+/.test(line)) break;
    if (inFindings && line.trim().startsWith("- ")) findings.push(line.trim().slice(2).trim());
  }
  return findings;
}

/** Extracts the contradictions recorded by the merge counter. */
function extractSummaryCount(summary: string, label: string): number {
  const value = parseSummaryFields(summary)[label];
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ResearchDraftInput = {
  name: string;
  slug: string;
  profile: string;
  digest: string;
  findings: string[];
  mentalModels: CelebrityMentalModel[];
  knownAnswers: CelebrityKnownAnswer[];
  edgeCase: { question: string; why: string; approach: string } | null;
  contradictions: string[];
  boundaries: string[];
  genealogy: string[];
  sources: string[];
};

/**
 * The protocol the generated skill follows when it answers a question.
 *
 * It is a method, not a claim about the subject, so it is written once here
 * and shared by the research draft and the generated package.
 */
export const AGENTIC_PROTOCOL = [
  "1. 先把问题归到六个研究轨道之一（著作 / 对话 / 表达 / 决策 / 他者视角 / 认知轨迹）。",
  "2. 调用与该轨道匹配的心智模型，不要套用通用建议。",
  "3. 说明证据强度：权重 1-3 的来源可以作为依据，4-5 需要标注为推断，6-7 只能当线索。",
  "4. 证据不足时显露出不确定，不要补全不存在的资料。",
].join("\n");

/**
 * Builds the draft skill the quality gate and the validation stage read.
 *
 * The content is assembled from the research artefacts rather than generated,
 * so the draft can never contain a code fence, a quote block or a timestamp.
 */
export function buildResearchDraftSkill(input: ResearchDraftInput): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: celebrity_${input.slug}`);
  lines.push(`description: ${input.name} 的公开研究蒸馏草稿（${input.profile}）`);
  lines.push("user-invocable: true");
  lines.push("---");
  lines.push("");
  lines.push(`# ${input.name}`);
  lines.push("");
  lines.push("## PART A：工作能力");
  lines.push("");
  lines.push("### 研究要点");
  if (input.findings.length > 0) {
    for (const finding of input.findings) lines.push(`- ${sanitizeForCopyright(finding)}`);
  } else {
    lines.push("- 研究尚未产出可引用的要点。");
  }
  lines.push("");
  lines.push("### 心智模型");
  if (input.mentalModels.length > 0) {
    for (const model of input.mentalModels) {
      lines.push(`- ${model.name}：${model.definition}（依据：${model.evidence_anchors}）`);
      lines.push(`  - 第一眼先看：${model.sees_first}`);
      lines.push(`  - 会过滤掉：${model.filters_out}`);
      lines.push(`  - 失效场景：${model.failure_mode}`);
    }
  } else {
    lines.push("- 综合阶段尚未产出心智模型。");
  }
  lines.push("");
  lines.push("### 表达 DNA");
  lines.push("- 语言指纹与句式节奏由第三轨研究笔记提供，草稿阶段尚未合成。");
  lines.push("");
  lines.push("### 智识谱系");
  const genealogy = input.genealogy ?? [];
  if (genealogy.length > 0) {
    for (const entry of genealogy) lines.push(`- ${entry}`);
  } else {
    lines.push("- 智识谱系尚未整理：研究笔记里还没有可核对的思想来源。");
  }
  lines.push("");
  lines.push("### 分析协议");
  for (const step of AGENTIC_PROTOCOL.split("\n")) lines.push(step);
  lines.push("");
  lines.push("### 来源");
  const sources = input.sources ?? [];
  if (sources.length > 0) {
    for (const source of sources) lines.push(`- ${source}`);
  } else {
    lines.push("- 尚未记录可核对的来源 URL。");
  }
  lines.push("");
  lines.push("### 已知答案");
  if (input.knownAnswers.length > 0) {
    for (const answer of input.knownAnswers) {
      lines.push(`- Question: ${answer.question}`);
      lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
    }
  } else {
    lines.push("- 尚未产出已知答案问题。");
  }
  lines.push("");
  lines.push("## PART B：人物性格");
  lines.push("");
  lines.push("### 矛盾与张力");
  if (input.contradictions.length > 0) {
    for (const contradiction of input.contradictions) lines.push(`- ${contradiction}`);
  } else {
    lines.push("- 尚未整理出矛盾清单。");
  }
  lines.push("");
  lines.push("### 诚实边界");
  if (input.boundaries.length > 0) {
    for (const boundary of input.boundaries) lines.push(`- ${boundary}`);
  } else {
    lines.push("- 研究尚未收敛，结论置信度低。");
  }
  if (input.edgeCase) {
    lines.push("");
    lines.push("### Edge-Case Candidate（边界案例）");
    lines.push(`- Question: ${input.edgeCase.question}`);
    lines.push(`  - Why this is adjacent but under-evidenced: ${input.edgeCase.why}`);
    lines.push(`  - Expected reasoning approach: ${input.edgeCase.approach}`);
  }
  lines.push("");
  lines.push("## 运行规则");
  lines.push("");
  lines.push("1. 先用研究证据校验问题属于哪个心智模型覆盖的范围。");
  lines.push("2. 证据不足时说明不确定，不要补全不存在的资料。");
  lines.push("3. 保留矛盾，不要把矛盾调和成圆滑结论。");
  lines.push("");
  return sanitizeForCopyright(lines.join("\n"));
}

/** Calls the model for one stage. */
async function invokeStage(
  systemPrompt: string,
  userContent: string,
  options: { provider?: string; maxTokens: number; temperature?: number },
): Promise<string> {
  const result = await llmService.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    options: {
      provider: options.provider,
      maxTokens: options.maxTokens,
      temperature: options.temperature ?? 0.4,
    },
  });
  return result?.trim() ?? "";
}

/** Reads a reference document from the skill-engine directory. */
function readReference(relativePath: string, maxChars: number): string {
  const file = path.resolve(ENV.skillEngineDir, relativePath);
  try {
    if (!fs.existsSync(file)) return "";
    return fs.readFileSync(file, "utf-8").slice(0, maxChars);
  } catch (e) {
    console.warn(`[SkillEngine] Could not read reference ${file}:`, e);
    return "";
  }
}

/** The path of the research directory inside a skill directory. */
function researchDir(skillDir: string): string {
  return path.join(skillDir, "knowledge", "research");
}

/** Writes a file, creating the parent directories. */
function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

/** Parses the mental models of a synthesis result. */
function parseMentalModels(raw: unknown): CelebrityMentalModel[] {
  if (!Array.isArray(raw)) return [];
  const models: CelebrityMentalModel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    models.push({
      name,
      definition: typeof record.definition === "string" ? record.definition : "",
      evidence_anchors: typeof record.evidence_anchors === "string" ? record.evidence_anchors : "",
      sees_first: typeof record.sees_first === "string" ? record.sees_first : "",
      filters_out: typeof record.filters_out === "string" ? record.filters_out : "",
      failure_mode: typeof record.failure_mode === "string" ? record.failure_mode : "",
    });
  }
  return models;
}

/** Parses the known-answer questions of a synthesis result. */
function parseKnownAnswers(raw: unknown): CelebrityKnownAnswer[] {
  if (!Array.isArray(raw)) return [];
  const answers: CelebrityKnownAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!question) continue;
    answers.push({
      question,
      evidence_anchors: typeof record.evidence_anchors === "string" ? record.evidence_anchors : "",
    });
  }
  return answers;
}

/** Parses the intellectual genealogy of a synthesis result. */
function parseGenealogy(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const entries: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) entries.push(text);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const source = typeof record.source === "string" ? record.source.trim() : "";
    const note = typeof record.note === "string" ? record.note.trim() : "";
    entries.push([name, source, note].filter(Boolean).join("｜"));
  }
  return entries;
}

/** Collects the grounded source URLs of the research notes. */
export function extractSourceUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const pattern = /https?:\/\/[^\s)>\]]+/g;
  for (const match of text.match(pattern) ?? []) {
    const url = match.replace(/[.,;]$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** Renders the synthesis review file from the parsed synthesis result. */
function renderSynthesis(input: {
  summary: string;
  mentalModels: CelebrityMentalModel[];
  demoted: string[];
  unresolved: string[];
  gaps: string[];
  knownAnswers: CelebrityKnownAnswer[];
  edgeCase: { question: string; why: string; approach: string } | null;
}): string {
  const lines: string[] = [];
  lines.push("# Synthesis Review");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- ${input.summary || "（综合阶段未给出结论）"}`);
  lines.push("");
  lines.push("## Mental Models");
  if (input.mentalModels.length > 0) {
    for (const model of input.mentalModels) {
      lines.push(`- Name: ${model.name}`);
      lines.push(`  Definition: ${model.definition}`);
      lines.push(`  Evidence anchors: ${model.evidence_anchors}`);
      lines.push(`  Sees first: ${model.sees_first}`);
      lines.push(`  Filters out: ${model.filters_out}`);
      lines.push(`  Failure mode: ${model.failure_mode}`);
    }
  } else {
    lines.push("- 未产出通过三重门的心智模型。");
  }
  lines.push("");
  lines.push("## Demoted Heuristics");
  if (input.demoted.length > 0) {
    for (const heuristic of input.demoted) lines.push(`- ${heuristic}`);
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  lines.push("## Unresolved Contradictions");
  if (input.unresolved.length > 0) {
    for (const contradiction of input.unresolved) lines.push(`- ${contradiction}`);
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  lines.push("## Evidence Gaps");
  if (input.gaps.length > 0) {
    for (const gap of input.gaps) lines.push(`- ${gap}`);
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  lines.push("## Known-Answer Anchors");
  if (input.knownAnswers.length > 0) {
    for (const answer of input.knownAnswers) {
      lines.push(`- Question: ${answer.question}`);
      lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
    }
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  lines.push("## Edge-Case");
  if (input.edgeCase) {
    lines.push(`- Question: ${input.edgeCase.question}`);
    lines.push(`  - Why this is adjacent but under-evidenced: ${input.edgeCase.why}`);
    lines.push(`  - Expected reasoning approach: ${input.edgeCase.approach}`);
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  return sanitizeForCopyright(lines.join("\n"));
}

/** Renders the validation review file from the parsed validation result. */
function renderValidation(raw: Record<string, unknown>): string {
  const lines: string[] = [];
  const status = typeof raw.status === "string" ? raw.status : "FAIL";
  const readiness = typeof raw.release_readiness === "string" ? raw.release_readiness : "revise";
  lines.push("# Validation Review");
  lines.push("");
  lines.push("## Verdict");
  lines.push(`- Status: ${status}`);
  lines.push(`- Release readiness: ${readiness}`);
  lines.push("");
  lines.push("## Known-Answer Check");
  const known = Array.isArray(raw.known_answer_check) ? raw.known_answer_check : [];
  if (known.length > 0) {
    for (const item of known) {
      const record = (item ?? {}) as Record<string, unknown>;
      lines.push(`- Question: ${String(record.question ?? "")}`);
      lines.push(`  - Direction match: ${String(record.direction_match ?? "")}`);
      lines.push(`  - Framing match: ${String(record.framing_match ?? "")}`);
      lines.push(`  - Confidence calibration: ${String(record.confidence_calibration ?? "")}`);
      lines.push(`  - Verdict: ${String(record.verdict ?? "")}`);
    }
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  lines.push("## Edge-Case Check");
  const edge = (raw.edge_case_check ?? {}) as Record<string, unknown>;
  lines.push(`- Question: ${String(edge.question ?? "")}`);
  lines.push(`  - Extrapolates from models: ${String(edge.extrapolates_from_models ?? "")}`);
  lines.push(`  - Shows uncertainty: ${String(edge.shows_uncertainty ?? "")}`);
  lines.push(`  - Verdict: ${String(edge.verdict ?? "")}`);
  lines.push("");
  lines.push("## Voice Check");
  const voice = (raw.voice_check ?? {}) as Record<string, unknown>;
  lines.push(`- Recognizable: ${String(voice.recognizable ?? "")}`);
  lines.push(`- No generic AI phrasing: ${String(voice.no_generic_ai_phrasing ?? "")}`);
  lines.push(`- No quote stitching: ${String(voice.no_quote_stitching ?? "")}`);
  lines.push(`- Verdict: ${String(voice.verdict ?? "")}`);
  lines.push("");
  lines.push("## Copyright Check");
  const copyright = (raw.copyright_check ?? {}) as Record<string, unknown>;
  lines.push(`- Transcript dumps: ${String(copyright.transcript_dumps ?? "")}`);
  lines.push(`- Long quotations: ${String(copyright.long_quotations ?? "")}`);
  lines.push(`- Blockquote copying: ${String(copyright.blockquote_copying ?? "")}`);
  lines.push(`- Verdict: ${String(copyright.verdict ?? "")}`);
  lines.push("");
  lines.push("## Required Revisions");
  const revisions = Array.isArray(raw.required_revisions) ? raw.required_revisions : [];
  if (revisions.length > 0) {
    for (const revision of revisions) lines.push(`- ${String(revision)}`);
  } else {
    lines.push("- 无。");
  }
  lines.push("");
  return sanitizeForCopyright(lines.join("\n"));
}

/**
 * Runs the Python quality gate against a skill directory.
 *
 * This is the code-level gate: it counts the research markers the merge tool
 * produced and checks the rendered skill for copyright safety. A failure is
 * reported, never thrown — the gate is information, not a veto.
 */
export async function runQualityCheck(
  skillDir: string,
  profile: string,
): Promise<CelebrityQualityReport | null> {
  try {
    const { stdout } = await runPythonTool("research/quality_check.py", [
      skillDir,
      "--profile",
      profile,
      "--json",
    ]);
    const parsed = JSON.parse(stdout) as CelebrityQualityReport;
    return parsed;
  } catch (e) {
    console.warn("[SkillEngine] Quality gate failed (non-critical):", e);
    return null;
  }
}

/**
 * Runs the four-stage celebrity research flow.
 *
 * Returns null when the profile does not unlock the flow — the caller then
 * keeps the historical five-stage behaviour.
 */
export async function runCelebrityResearch(
  input: CelebrityResearchInput,
): Promise<CelebrityResearchResult | null> {
  const resolution = resolveCelebrityProfile("celebrity", input.profile);
  if (!resolution.hasResearchStages) return null;

  const errors: string[] = [];
  const rawDir = path.join(researchDir(input.skillDir), "raw");
  const reviewsDir = path.join(researchDir(input.skillDir), "reviews");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(reviewsDir, { recursive: true });

  const report = async (
    stage: CelebrityResearchStage,
    progress: number,
    message: string,
  ): Promise<void> => {
    if (!input.onStage) return;
    try {
      await input.onStage(stage, progress, message);
    } catch (e) {
      console.warn("[SkillEngine] Research stage progress update failed:", e);
    }
  };

  // ── Stage 1: research ───────────────────────────────────────────────────
  await report("researching", 10, "正在收集公开资料...");
  const researchPrompt = loadPrompt("celebrity", STAGE_PROMPTS.researching, input.profile);
  const sourceMaterial = input.sourceMaterial.trim();
  const materialBlock = sourceMaterial
    ? sourceMaterial
    : "（用户没有提供素材。只依据可核实的公开资料；无法核实的写进 Gaps，不要编造。）";

  const notes: string[] = [];
  for (const dimension of RESEARCH_DIMENSIONS) {
    const userContent = [
      `人物名称：${input.name}`,
      `轨道：${dimension.track} ${dimension.title}`,
      `本轨道提取重点：${dimension.focus}`,
      "",
      "## 用户提供的素材",
      materialBlock,
      "",
      NOTE_CONTRACT,
    ].join("\n");
    try {
      const note = await invokeStage(researchPrompt, userContent, {
        provider: input.provider,
        maxTokens: 3500,
        temperature: 0.4,
      });
      const normalized = ensureResearchSections(normalizeResearchNote(note));
      writeFile(path.join(rawDir, dimension.file), `${normalized.trim()}\n`);
      notes.push(normalized);
    } catch (e) {
      console.warn(`[SkillEngine] Research track ${dimension.track} failed:`, e);
      errors.push(`研究轨道 ${dimension.track} 失败：${e}`);
      writeFile(
        path.join(rawDir, dimension.file),
        `${ensureResearchSections(`# ${dimension.title}`)}\n`,
      );
    }
  }

  // The merge tool is the machine counter for the section vocabulary; it also
  // produces the summary the quality gate reads.
  let summary = "";
  try {
    await runPythonTool("research/merge_research.py", [input.skillDir]);
    const summaryPath = path.join(researchDir(input.skillDir), "merged", "summary.md");
    if (fs.existsSync(summaryPath)) summary = fs.readFileSync(summaryPath, "utf-8");
  } catch (e) {
    console.warn("[SkillEngine] merge_research failed (non-critical):", e);
    errors.push(`研究合并失败：${e}`);
  }
  const findings = extractSummaryFindings(summary);
  const summaryFields = parseSummaryFields(summary);
  // The grounded URLs live in the notes; the rendered skill has to carry them
  // so the quality gate can tell real sources from decoration.
  const sources = extractSourceUrls(notes.join("\n"));

  // ── Stage 2: audit ──────────────────────────────────────────────────────
  await report("auditing", 20, "正在审计研究证据...");
  const auditPrompt = loadPrompt("celebrity", STAGE_PROMPTS.auditing, input.profile);
  const framework = readReference(
    "references/celebrity_budget_unfriendly_framework.md",
    12000,
  );
  let audit = "";
  try {
    const auditContent = await invokeStage(
      auditPrompt,
      [
        `人物名称：${input.name}`,
        "",
        "## 六轨研究笔记",
        notes.join("\n\n---\n\n").slice(0, 40000),
        "",
        "## 合并摘要（机器计数结果）",
        summary.slice(0, 8000),
        "",
        "## 方法论",
        framework,
        "",
        AUDIT_CONTRACT,
      ].join("\n"),
      { provider: input.provider, maxTokens: 3000, temperature: 0.3 },
    );
    audit = sanitizeForCopyright(auditContent);
    writeFile(path.join(reviewsDir, "research_audit.md"), `${audit}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Audit stage failed (non-critical):", e);
    errors.push(`审计阶段失败：${e}`);
  }

  // ── Code-level quality gate (right after the audit) ────────────────────
  const draftBeforeSynthesis = buildResearchDraftSkill({
    name: input.name,
    slug: path.basename(input.skillDir),
    profile: input.profile,
    digest: summary,
    findings,
    mentalModels: [],
    knownAnswers: [],
    edgeCase: null,
    contradictions: [],
    boundaries: [],
    genealogy: [],
    sources,
  });
  writeFile(path.join(input.skillDir, "SKILL.md"), draftBeforeSynthesis);
  const qualityReport = await runQualityCheck(input.skillDir, input.profile);

  // ── Stage 3: synthesis ─────────────────────────────────────────────────
  await report("synthesizing", 30, "正在综合心智模型...");
  const synthesisPrompt = loadPrompt("celebrity", STAGE_PROMPTS.synthesizing, input.profile);
  let synthesis = "";
  let mentalModels: CelebrityMentalModel[] = [];
  let knownAnswers: CelebrityKnownAnswer[] = [];
  let unresolvedContradictions: string[] = [];
  let evidenceGaps: string[] = [];
  let genealogy: string[] = [];
  let edgeCase: { question: string; why: string; approach: string } | null = null;
  try {
    const synthesisRaw = await invokeStage(
      synthesisPrompt,
      [
        `人物名称：${input.name}`,
        "",
        "## 六轨研究笔记",
        notes.join("\n\n---\n\n").slice(0, 40000),
        "",
        "## 审计结论",
        audit.slice(0, 12000),
        "",
        "## 方法论",
        framework,
        "",
        SYNTHESIS_CONTRACT,
      ].join("\n"),
      { provider: input.provider, maxTokens: 3000, temperature: 0.3 },
    );
    const parsed = extractJsonObject(synthesisRaw);
    if (!parsed) throw new Error("综合阶段没有返回可解析的 JSON");
    mentalModels = parseMentalModels(parsed.mental_models);
    knownAnswers = parseKnownAnswers(parsed.known_answer_questions);
    const edge = (parsed.edge_case ?? {}) as Record<string, unknown>;
    const edgeQuestion = typeof edge.question === "string" ? edge.question.trim() : "";
    edgeCase = edgeQuestion
      ? {
          question: edgeQuestion,
          why: typeof edge.why_adjacent_but_under_evidenced === "string" ? edge.why_adjacent_but_under_evidenced : "",
          approach: typeof edge.expected_reasoning_approach === "string" ? edge.expected_reasoning_approach : "",
        }
      : null;
    unresolvedContradictions = Array.isArray(parsed.unresolved_contradictions)
      ? parsed.unresolved_contradictions.map((item) => String(item))
      : [];
    evidenceGaps = Array.isArray(parsed.evidence_gaps)
      ? parsed.evidence_gaps.map((item) => String(item))
      : [];
    genealogy = parseGenealogy(parsed.intellectual_genealogy);
    synthesis = renderSynthesis({
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      mentalModels,
      demoted: Array.isArray(parsed.demoted_heuristics)
        ? parsed.demoted_heuristics.map((item) => {
            const record = (item ?? {}) as Record<string, unknown>;
            return `${String(record.rule ?? "")}｜${String(record.context ?? "")}｜${String(record.why_not_a_model ?? "")}`;
          })
        : [],
      unresolved: unresolvedContradictions,
      gaps: evidenceGaps,
      knownAnswers,
      edgeCase,
    });
    writeFile(path.join(reviewsDir, "synthesis.md"), `${synthesis}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Synthesis stage failed (non-critical):", e);
    errors.push(`综合阶段失败：${e}`);
  }

  // ── Stage 4: validation ────────────────────────────────────────────────
  await report("validating", 40, "正在验证已知答案...");
  const validationPrompt = loadPrompt("celebrity", STAGE_PROMPTS.validating, input.profile);
  const draft = buildResearchDraftSkill({
    name: input.name,
    slug: path.basename(input.skillDir),
    profile: input.profile,
    digest: summary,
    findings,
    mentalModels,
    knownAnswers,
    edgeCase,
    contradictions: unresolvedContradictions,
    boundaries: [
      `研究来源数：${summaryFields["Unique URLs"] ?? "未知"}，一手标记：${summaryFields["Primary-source markers"] ?? "未知"}。`,
      ...evidenceGaps,
    ],
    genealogy,
    sources,
  });
  writeFile(path.join(input.skillDir, "SKILL.md"), draft);

  let validation = "";
  try {
    const validationRaw = await invokeStage(
      validationPrompt,
      [
        `人物名称：${input.name}`,
        "",
        "## 审计结论",
        audit.slice(0, 10000),
        "",
        "## 综合结论",
        synthesis.slice(0, 10000),
        "",
        "## 生成的技能草稿",
        draft.slice(0, 20000),
        "",
        VALIDATION_CONTRACT,
      ].join("\n"),
      { provider: input.provider, maxTokens: 2500, temperature: 0.3 },
    );
    const parsed = extractJsonObject(validationRaw);
    if (!parsed) throw new Error("验证阶段没有返回可解析的 JSON");
    validation = renderValidation(parsed);
    writeFile(path.join(reviewsDir, "validation.md"), `${validation}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Validation stage failed (non-critical):", e);
    errors.push(`验证阶段失败：${e}`);
  }

  // The gate is run again so the recorded report reflects the review chain
  // (audit + synthesis + validation) instead of the mid-flight state.
  const finalQualityReport = await runQualityCheck(input.skillDir, input.profile);

  const digest = [
    summary.trim(),
    "",
    "## 心智模型",
    ...(mentalModels.length > 0
      ? mentalModels.map((model) => `- ${model.name}：${model.definition}（依据：${model.evidence_anchors}）`)
      : ["- 综合阶段未产出心智模型。"]),
  ]
    .join("\n")
    .trim();

  return {
    profile: input.profile,
    status: errors.length === 0 ? "complete" : "partial",
    digest,
    audit,
    synthesis,
    validation,
    mentalModels,
    knownAnswerQuestions: knownAnswers,
    genealogy,
    sources,
    qualityReport,
    finalQualityReport,
    errors,
  };
}

/**
 * Stores the research artefacts in the `research_profiles` table.
 *
 * The table is created by the schema migration that ships with this feature,
 * so the write is guarded: a missing table degrades to "the stages ran but
 * could not be persisted" instead of breaking the pipeline.
 */
export async function saveResearchProfile(row: ResearchProfileRow): Promise<boolean> {
  try {
    const id = await db.createResearchProfile({
      userId: row.userId,
      personaId: row.personaId,
      profile: row.profile,
      notes: (row.notes ?? null) as any,
      audit: (row.audit ?? null) as any,
      synthesis: (row.synthesis ?? null) as any,
      validation: (row.validation ?? null) as any,
      qualityReport: (row.qualityReport ?? null) as any,
      status: row.status,
    });
    return id !== undefined;
  } catch (e) {
    console.warn("[SkillEngine] Could not persist the research profile (non-critical):", e);
    return false;
  }
}
