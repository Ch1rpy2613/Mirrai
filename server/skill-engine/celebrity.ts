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
import { asMaterial } from "./material";
import { runPythonTool } from "./runner";
import { extractJsonObject } from "../_core/json";
import { ENV } from "../_core/env";
import { copy, type Locale } from "@shared/copy";
import { registerSkillPrompts } from "@shared/copy/skill-prompts";
import * as db from "../db";

// The prompt dictionary is assembled in `shared/copy/index.ts`. Registering it
// here as well means `copy()` finds these keys whether or not that wiring
// has landed yet — a prompt must never go out carrying a key name.
registerSkillPrompts();

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
  /** The language the prompts and the progress messages are written in. */
  locale?: Locale;
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
 *
 * The titles and the focus lines are shown to the model, so they are words
 * the person reads — they come from the copy table, in their language. The
 * track number and the file name are protocol and stay as they are.
 */
function researchDimensions(locale: Locale): {
  track: string;
  file: string;
  title: string;
  focus: string;
}[] {
  return [
    {
      track: "01",
      file: "01_writings.md",
      title: copy(locale, "skillPrompts.dimension.writings.title"),
      focus: copy(locale, "skillPrompts.dimension.writings.focus"),
    },
    {
      track: "02",
      file: "02_conversations.md",
      title: copy(locale, "skillPrompts.dimension.conversations.title"),
      focus: copy(locale, "skillPrompts.dimension.conversations.focus"),
    },
    {
      track: "03",
      file: "03_expression_dna.md",
      title: copy(locale, "skillPrompts.dimension.expression.title"),
      focus: copy(locale, "skillPrompts.dimension.expression.focus"),
    },
    {
      track: "04",
      file: "04_decisions.md",
      title: copy(locale, "skillPrompts.dimension.decisions.title"),
      focus: copy(locale, "skillPrompts.dimension.decisions.focus"),
    },
    {
      track: "05",
      file: "05_external_views.md",
      title: copy(locale, "skillPrompts.dimension.externalViews.title"),
      focus: copy(locale, "skillPrompts.dimension.externalViews.focus"),
    },
    {
      track: "06",
      file: "06_timeline.md",
      title: copy(locale, "skillPrompts.dimension.timeline.title"),
      focus: copy(locale, "skillPrompts.dimension.timeline.focus"),
    },
  ];
}

/**
 * The note contract handed to the model.
 *
 * The counters match the English section titles literally and only recognise
 * `Source weight: 3` (no brackets), `一手` (followed by punctuation or a
 * space) and `Question: ` (no digits in front of the colon), so the contract
 * spells those out instead of leaving them to the prompt files.
 *
 * The contract itself is a sentence written for a model, so it lives in the
 * copy table: `copy(locale, "skillPrompts.noteContract")`. Both languages
 * spell the section headings the same way, because the counters count them
 * by name.
 */

/**
 * The audit contract — the spellings the quality gate counts on.
 *
 * It is a sentence written for a model, so it lives in the copy table:
 * `copy(locale, "skillPrompts.auditContract")`. The section headings are
 * protocol and are spelled the same way in both languages.
 */

/**
 * The synthesis contract — JSON so the result can be stored and reused.
 *
 * It is a sentence written for a model, so it lives in the copy table:
 * `copy(locale, "skillPrompts.synthesisContract")`. The JSON keys are
 * protocol: the code reads them, so both languages spell them the same way.
 */

/**
 * The validation contract — JSON so the result can be stored and reused.
 *
 * It is a sentence written for a model, so it lives in the copy table:
 * `copy(locale, "skillPrompts.validationContract")`. The JSON keys are
 * protocol: the code reads them, so both languages spell them the same way.
 */

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
 *
 * The marker is written in the language the research ran in, because the
 * merge tool counts it by name and both spellings are ones it knows.
 */
export function normalizeResearchNote(text: string, locale: Locale = "zh"): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines
    .map((line) => {
      let out = line.replace(/source weight:\s*\[\s*(\d)\s*\]/gi, "Source weight: $1");
      // A range placeholder carries no information; fall back to the middle of
      // the 1-7 scale rather than dropping the marker entirely.
      out = out.replace(/source weight:\s*\[[^\]]*\]/gi, "Source weight: 3");
      out = out.replace(/(grounding level:\s*)(.+)$/i, (match, prefix: string, value: string) =>
        /一手|first-person|primary/i.test(value)
          ? `${prefix}${copy(locale, "prompts.sourcePrimary")}`
          : `${prefix}${copy(locale, "prompts.sourceSecondary")}`,
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
export function ensureResearchSections(text: string, locale: Locale = "zh"): string {
  const missing = REPAIRABLE_SECTIONS.filter((section) => !text.includes(section));
  if (missing.length === 0) return text;
  const appended = missing
    .map((section) =>
      section === "## Gaps and Missing Information"
        ? `${section}\n${copy(locale, "skillPrompts.research.emptySection")}`
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
  /** The language the draft is written in. */
  locale?: Locale;
};

/**
 * Builds the draft skill the quality gate and the validation stage read.
 *
 * The content is assembled from the research artefacts rather than generated,
 * so the draft can never contain a code fence, a quote block or a timestamp.
 */
export function buildResearchDraftSkill(input: ResearchDraftInput): string {
  const locale = input.locale ?? "zh";
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: celebrity_${input.slug}`);
  lines.push(
    `description: ${copy(locale, "skillPrompts.draft.description", {
      name: input.name,
      profile: input.profile,
    })}`,
  );
  lines.push("user-invocable: true");
  lines.push("---");
  lines.push("");
  lines.push(`# ${input.name}`);
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.partA"));
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.findingsHeading"));
  if (input.findings.length > 0) {
    for (const finding of input.findings) lines.push(`- ${sanitizeForCopyright(finding)}`);
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noFindings"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.mentalModelsHeading"));
  if (input.mentalModels.length > 0) {
    for (const model of input.mentalModels) {
      lines.push(
        copy(locale, "skillPrompts.draft.modelLine", {
          name: model.name,
          definition: model.definition,
          evidence: model.evidence_anchors,
        }),
      );
      lines.push(
        copy(locale, "skillPrompts.draft.modelSeesFirst", { value: model.sees_first }),
      );
      lines.push(
        copy(locale, "skillPrompts.draft.modelFiltersOut", { value: model.filters_out }),
      );
      lines.push(
        copy(locale, "skillPrompts.draft.modelFailureMode", { value: model.failure_mode }),
      );
    }
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noMentalModels"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.expressionDnaHeading"));
  lines.push(copy(locale, "skillPrompts.draft.expressionDnaPending"));
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.genealogyHeading"));
  const genealogy = input.genealogy ?? [];
  if (genealogy.length > 0) {
    for (const entry of genealogy) lines.push(`- ${entry}`);
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noGenealogy"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.protocolHeading"));
  for (const step of copy(locale, "skillPrompts.agenticProtocol").split("\n")) lines.push(step);
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.sourcesHeading"));
  const sources = input.sources ?? [];
  if (sources.length > 0) {
    for (const source of sources) lines.push(`- ${source}`);
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noSources"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.knownAnswersHeading"));
  if (input.knownAnswers.length > 0) {
    for (const answer of input.knownAnswers) {
      lines.push(`- Question: ${answer.question}`);
      lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
    }
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noKnownAnswers"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.partB"));
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.contradictionsHeading"));
  if (input.contradictions.length > 0) {
    for (const contradiction of input.contradictions) lines.push(`- ${contradiction}`);
  } else {
    lines.push(copy(locale, "skillPrompts.draft.noContradictions"));
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.boundariesHeading"));
  if (input.boundaries.length > 0) {
    for (const boundary of input.boundaries) lines.push(`- ${boundary}`);
  } else {
    lines.push(copy(locale, "skillPrompts.draft.lowConfidence"));
  }
  if (input.edgeCase) {
    lines.push("");
    lines.push(copy(locale, "skillPrompts.draft.edgeCaseHeading"));
    lines.push(`- Question: ${input.edgeCase.question}`);
    lines.push(`  - Why this is adjacent but under-evidenced: ${input.edgeCase.why}`);
    lines.push(`  - Expected reasoning approach: ${input.edgeCase.approach}`);
  }
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.rulesHeading"));
  lines.push("");
  lines.push(copy(locale, "skillPrompts.draft.rule1"));
  lines.push(copy(locale, "skillPrompts.draft.rule2"));
  lines.push(copy(locale, "skillPrompts.draft.rule3"));
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
  locale: Locale;
}): string {
  const locale = input.locale;
  const lines: string[] = [];
  lines.push("# Synthesis Review");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- ${input.summary || copy(locale, "skillPrompts.review.noSummary")}`);
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
    lines.push(copy(locale, "skillPrompts.review.noPassedModels"));
  }
  lines.push("");
  lines.push("## Demoted Heuristics");
  if (input.demoted.length > 0) {
    for (const heuristic of input.demoted) lines.push(`- ${heuristic}`);
  } else {
    lines.push(copy(locale, "skillPrompts.review.none"));
  }
  lines.push("");
  lines.push("## Unresolved Contradictions");
  if (input.unresolved.length > 0) {
    for (const contradiction of input.unresolved) lines.push(`- ${contradiction}`);
  } else {
    lines.push(copy(locale, "skillPrompts.review.none"));
  }
  lines.push("");
  lines.push("## Evidence Gaps");
  if (input.gaps.length > 0) {
    for (const gap of input.gaps) lines.push(`- ${gap}`);
  } else {
    lines.push(copy(locale, "skillPrompts.review.none"));
  }
  lines.push("");
  lines.push("## Known-Answer Anchors");
  if (input.knownAnswers.length > 0) {
    for (const answer of input.knownAnswers) {
      lines.push(`- Question: ${answer.question}`);
      lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
    }
  } else {
    lines.push(copy(locale, "skillPrompts.review.none"));
  }
  lines.push("");
  lines.push("## Edge-Case");
  if (input.edgeCase) {
    lines.push(`- Question: ${input.edgeCase.question}`);
    lines.push(`  - Why this is adjacent but under-evidenced: ${input.edgeCase.why}`);
    lines.push(`  - Expected reasoning approach: ${input.edgeCase.approach}`);
  } else {
    lines.push(copy(locale, "skillPrompts.review.none"));
  }
  lines.push("");
  return sanitizeForCopyright(lines.join("\n"));
}

/** Renders the validation review file from the parsed validation result. */
function renderValidation(raw: Record<string, unknown>, locale: Locale): string {
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
    lines.push(copy(locale, "skillPrompts.review.none"));
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
    lines.push(copy(locale, "skillPrompts.review.none"));
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

  const locale = input.locale ?? "zh";
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
  await report("researching", 10, copy(locale, "skillPrompts.research.collecting"));
  const researchPrompt = loadPrompt("celebrity", STAGE_PROMPTS.researching, input.profile);
  const sourceMaterial = input.sourceMaterial.trim();
  /**
   * The material, fenced.
   *
   * It is the user's own chat log and whatever a collector brought in
   * — text the user did not write, which can say anything at all. It
   * reached the model with no fence and no statement that it was data,
   * so a chat log could steer the research — and the injected text ends
   * up in the persona the user then talks to.
   */
  const materialBlock = asMaterial(
    sourceMaterial ? sourceMaterial : copy(locale, "skillPrompts.research.noMaterial"),
    locale,
  );

  const notes: string[] = [];
  for (const dimension of researchDimensions(locale)) {
    const userContent = [
      copy(locale, "skillPrompts.research.personName", { name: input.name }),
      copy(locale, "skillPrompts.research.track", {
        track: dimension.track,
        title: dimension.title,
      }),
      copy(locale, "skillPrompts.research.trackFocus", { focus: dimension.focus }),
      "",
      copy(locale, "skillPrompts.research.userMaterialHeading"),
      materialBlock,
      "",
      copy(locale, "skillPrompts.noteContract"),
    ].join("\n");
    try {
      const note = await invokeStage(researchPrompt, userContent, {
        provider: input.provider,
        maxTokens: 3500,
        temperature: 0.4,
      });
      const normalized = ensureResearchSections(normalizeResearchNote(note, locale), locale);
      writeFile(path.join(rawDir, dimension.file), `${normalized.trim()}\n`);
      notes.push(normalized);
    } catch (e) {
      console.warn(`[SkillEngine] Research track ${dimension.track} failed:`, e);
      errors.push(
        copy(locale, "skillPrompts.research.trackFailed", {
          track: dimension.track,
          reason: String(e),
        }),
      );
      writeFile(
        path.join(rawDir, dimension.file),
        `${ensureResearchSections(`# ${dimension.title}`, locale)}\n`,
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
    errors.push(copy(locale, "skillPrompts.research.mergeFailed", { reason: String(e) }));
  }
  const findings = extractSummaryFindings(summary);
  const summaryFields = parseSummaryFields(summary);
  // The grounded URLs live in the notes; the rendered skill has to carry them
  // so the quality gate can tell real sources from decoration.
  const sources = extractSourceUrls(notes.join("\n"));

  // ── Stage 2: audit ──────────────────────────────────────────────────────
  await report("auditing", 20, copy(locale, "skillPrompts.research.auditing"));
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
        copy(locale, "skillPrompts.research.personName", { name: input.name }),
        "",
        copy(locale, "skillPrompts.research.notesHeading"),
        notes.join("\n\n---\n\n").slice(0, 40000),
        "",
        copy(locale, "skillPrompts.research.mergedSummaryHeading"),
        summary.slice(0, 8000),
        "",
        copy(locale, "skillPrompts.research.methodologyHeading"),
        framework,
        "",
        copy(locale, "skillPrompts.auditContract"),
      ].join("\n"),
      { provider: input.provider, maxTokens: 3000, temperature: 0.3 },
    );
    audit = sanitizeForCopyright(auditContent);
    writeFile(path.join(reviewsDir, "research_audit.md"), `${audit}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Audit stage failed (non-critical):", e);
    errors.push(copy(locale, "skillPrompts.research.auditFailed", { reason: String(e) }));
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
    locale,
  });
  writeFile(path.join(input.skillDir, "SKILL.md"), draftBeforeSynthesis);
  const qualityReport = await runQualityCheck(input.skillDir, input.profile);

  // ── Stage 3: synthesis ─────────────────────────────────────────────────
  await report("synthesizing", 30, copy(locale, "skillPrompts.research.synthesizing"));
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
        copy(locale, "skillPrompts.research.personName", { name: input.name }),
        "",
        copy(locale, "skillPrompts.research.notesHeading"),
        notes.join("\n\n---\n\n").slice(0, 40000),
        "",
        copy(locale, "skillPrompts.research.auditHeading"),
        audit.slice(0, 12000),
        "",
        copy(locale, "skillPrompts.research.methodologyHeading"),
        framework,
        "",
        copy(locale, "skillPrompts.synthesisContract"),
      ].join("\n"),
      { provider: input.provider, maxTokens: 3000, temperature: 0.3 },
    );
    const parsed = extractJsonObject(synthesisRaw);
    if (!parsed) {
      throw new Error(copy(locale, "skillPrompts.research.synthesisNotJson"));
    }
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
      locale,
    });
    writeFile(path.join(reviewsDir, "synthesis.md"), `${synthesis}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Synthesis stage failed (non-critical):", e);
    errors.push(copy(locale, "skillPrompts.research.synthesisFailed", { reason: String(e) }));
  }

  // ── Stage 4: validation ────────────────────────────────────────────────
  await report("validating", 40, copy(locale, "skillPrompts.research.validating"));
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
      copy(locale, "skillPrompts.research.boundaries", {
        sources: summaryFields["Unique URLs"] ?? copy(locale, "prompt.unknown"),
        markers: summaryFields["Primary-source markers"] ?? copy(locale, "prompt.unknown"),
      }),
      ...evidenceGaps,
    ],
    genealogy,
    sources,
    locale,
  });
  writeFile(path.join(input.skillDir, "SKILL.md"), draft);

  let validation = "";
  try {
    const validationRaw = await invokeStage(
      validationPrompt,
      [
        copy(locale, "skillPrompts.research.personName", { name: input.name }),
        "",
        copy(locale, "skillPrompts.research.auditHeading"),
        audit.slice(0, 10000),
        "",
        copy(locale, "skillPrompts.research.synthesisHeading"),
        synthesis.slice(0, 10000),
        "",
        copy(locale, "skillPrompts.research.draftHeading"),
        draft.slice(0, 20000),
        "",
        copy(locale, "skillPrompts.validationContract"),
      ].join("\n"),
      { provider: input.provider, maxTokens: 2500, temperature: 0.3 },
    );
    const parsed = extractJsonObject(validationRaw);
    if (!parsed) {
      throw new Error(copy(locale, "skillPrompts.research.validationNotJson"));
    }
    validation = renderValidation(parsed, locale);
    writeFile(path.join(reviewsDir, "validation.md"), `${validation}\n`);
  } catch (e) {
    console.warn("[SkillEngine] Validation stage failed (non-critical):", e);
    errors.push(copy(locale, "skillPrompts.research.validationFailed", { reason: String(e) }));
  }

  // The gate is run again so the recorded report reflects the review chain
  // (audit + synthesis + validation) instead of the mid-flight state.
  const finalQualityReport = await runQualityCheck(input.skillDir, input.profile);

  const digest = [
    summary.trim(),
    "",
    copy(locale, "skillPrompts.research.digestHeading"),
    ...(mentalModels.length > 0
      ? mentalModels.map((model) =>
          copy(locale, "skillPrompts.draft.modelLine", {
            name: model.name,
            definition: model.definition,
            evidence: model.evidence_anchors,
          }),
        )
      : [copy(locale, "skillPrompts.research.digestEmpty")]),
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
