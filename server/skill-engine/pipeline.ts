/**
 * Persona distillation pipeline.
 *
 * This is the single path for building a persona. Every entry point
 * (`persona.triggerAnalysis`, `skillEngine.startPipeline`) routes here, so
 * there is one implementation of the multi-stage distillation described in the
 * README rather than two divergent ones.
 *
 * Stages:
 *   intake        — collect source material
 *   analyzing     — extract behavioral patterns (persona_analyzer prompt)
 *   building      — write the structured persona (persona_builder prompt)
 *   merging       — normalize into the canonical personaData contract
 *   complete      — persist
 *
 * The `celebrity` family can add a research flow in front of those stages
 * (researching → auditing → synthesizing → validating). It only runs when the
 * selected research profile declares the complete flow; every other family
 * and profile keeps the historical five-stage behaviour.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { invokeForUser, invokeForUserWithReason } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import type { LLMMessage, LLMOptions } from "../llm/types";
import { loadPrompt } from "./prompts";
import { asMaterial } from "./material";
import { runPythonTool } from "./runner";
import { extractJsonObject } from "../_core/json";
import {
  normalizePersonaData,
  PERSONA_DOCUMENT_FIELDS,
  type PersonaData,
} from "../_core/persona-schema";
import { normalizeMicroRules, type MicroRule } from "@shared/micro-rules";
import { normalizeImperfectionProfile } from "@shared/imperfection";
import { ENV } from "../_core/env";
import { safeErrorMessage } from "../_core/safe-error";
import * as db from "../db";
import {
  resolveCelebrityProfile,
  runCelebrityResearch,
  runQualityCheck,
  sanitizeForCopyright,
  saveResearchProfile,
  type CelebrityResearchResult,
  type CelebrityResearchStage,
} from "./celebrity";
import {
  getDistillationPreset,
  type DistillationMode,
  type DistillationPreset,
} from "@shared/distillation-modes";
import {
  findContrastPairs,
  MICRO_RULE_PAIR_BUDGET,
  mineMicroRules,
  parseTranscriptMessages,
} from "./micro-rules";
import { copy, type Locale } from "@shared/copy";
import { extractMemories } from "../chat/memory-extract";

/**
 * How many lines of the upload are read for the memories.
 *
 * The same ceiling the conversation extraction uses — the model is
 * given a window, not the whole file.
 */
const MEMORY_EXTRACTION_MESSAGE_LIMIT = 50;
import { registerSkillPrompts } from "@shared/copy/skill-prompts";

// The prompt dictionary is assembled in `shared/copy/index.ts`. Registering it
// here as well means `copy()` finds these keys whether or not that wiring
// has landed yet — a prompt must never go out carrying a key name.
registerSkillPrompts();

export type CharacterFamily = "colleague" | "relationship" | "celebrity";

/**
 * One model call for the pipeline.
 *
 * It goes to the user's own provider when they have one — the uploaded
 * chat log is their material, and it must not go to the operator's
 * account, or the operator's bill, when they chose a key of their own.
 *
 * The environment's provider is used only when the user has nothing of
 * their own, which is what running your own instance means.
 */
async function invokePipeline(params: {
  userId: number;
  providerName?: string;
  messages: LLMMessage[];
  options?: LLMOptions;
}): Promise<string> {
  /**
   * The reason, not just "no provider".
   *
   * It used to say "no LLM provider available" for a provider that was
   * there and had failed — so the user was told to configure a model
   * service they had already configured, and the actual error was
   * nowhere.
   */
  const outcome = await invokeForUserWithReason(params);
  if (outcome.text == null) {
    throw new Error(
      outcome.reason
        ? `The model service did not answer: ${outcome.reason}`
        : "No LLM provider available. Configure one in .env, or add a key of your own in the settings.",
    );
  }
  return outcome.text;
}

export type PipelineInput = {
  personaId: number;
  userId: number;
  characterFamily: CharacterFamily;
  name: string;
  chatContent: string;
  /** Image URLs to describe and fold into the persona memories. */
  imageUrls?: string[];
  intakeMeta?: Record<string, unknown>;
  /** Explicit LLM provider override; falls back to the registry default. */
  provider?: string;
  /**
   * The research profile to use for the celebrity family.
   *
   * Only a profile that declares the complete research flow (research, audit,
   * synthesis, validation) unlocks it; anything else keeps the historical
   * five-stage path.
   */
  researchProfile?: string | null;
  /**
   * The named preset for this run.
   *
   * A preset decides the family, the research profile and the three depth
   * knobs — how much material the analysis reads, how deterministic the
   * extraction is, and how many photos are described. When it is given it
   * wins over `characterFamily` and `researchProfile`; when it is not, the
   * run behaves exactly as it did before the presets existed.
   */
  mode?: DistillationMode | null;
  /**
   * The language the prompts and the progress messages are written in.
   *
   * It defaults to Chinese, which is what the app has always used.
   */
  locale?: Locale;
  /**
   * Whether the discriminative rules should be mined from the records.
   *
   * The mining is an extra model call, so a caller that does not want it
   * says so. It is optional by nature: when the material is thin, when
   * the model fails, or when it is switched off here, the run finishes
   * with no rules at all — a persona without rules is still a persona.
   */
  mineRules?: boolean;
};

/**
 * The families whose persona has a professional dimension.
 *
 * A colleague's job is part of who they are, and a public figure's craft is
 * too. A relationship persona does not need either, so it skips the work
 * stages — and the merge that depends on them.
 */
const WORK_DIMENSION_FAMILIES: CharacterFamily[] = ["colleague", "celebrity"];

/**
 * The research material limits.
 *
 * The chat sample size is not here: it is part of the distillation preset,
 * so that the user can choose how much of the material a run reads.
 */
const MAX_RESEARCH_SAMPLE = 12000;
const MAX_RESEARCH_MATERIAL = 20000;

/** The `pipeline_stage` values the job row accepts. */
type SkillJobStage = Parameters<typeof db.updateSkillJob>[2]["pipelineStage"];

/**
 * The research stages are part of `pipeline_stage` — the enum carries
 * `researching`, `auditing`, `synthesizing` and `validating` so the database
 * accepts them. The cast only exists to keep the two stage vocabularies
 * (TypeScript union and PG enum) from drifting at compile time.
 */
function researchStage(stage: CelebrityResearchStage): SkillJobStage {
  return stage as unknown as SkillJobStage;
}

/**
 * Builds a stable skill directory name.
 *
 * `skill_writer.py` derives its slug from the display name with pypinyin,
 * which is an optional dependency — so the slug is computed here and passed
 * explicitly. The persona id keeps two people with the same name apart.
 */
/**
 * What the user decided, kept across a re-run.
 *
 * A re-distillation rebuilds the persona from the records, and it would
 * happily throw away everything the user worked out by hand: the rules
 * they confirmed, and the per-state imperfection they wrote. Those are
 * not the model's to overwrite — the whole point of them is that they are
 * the user's decisions about a person the model cannot see.
 *
 * So the confirmed rules and the whole imperfection profile are carried
 * over. The mined *candidates* are not: they are read off the records
 * again, and a fresh reading is a better reading.
 */
export function mergeUserDecisions(
  fresh: PersonaData,
  previous: Partial<PersonaData>,
  minedRules: MicroRule[],
  locale: "zh" | "en" = "zh",
): PersonaData {
  const confirmed = normalizeMicroRules(previous.microRules).filter(
    (rule) => rule.verified,
  );
  const imperfectionProfile = normalizeImperfectionProfile(
    previous.imperfectionProfile,
    locale,
  );
  // A mined rule whose trigger the user has already confirmed is dropped:
  // the user's version is the one they checked, and two rules about the
  // same word are two contradictory instructions in one prompt.
  const covered = new Set(confirmed.map((rule) => rule.trigger.join("|")));
  const uncovered = minedRules.filter(
    (rule) => !covered.has(rule.trigger.join("|")),
  );
  return {
    ...fresh,
    microRules: [...confirmed, ...uncovered],
    imperfectionProfile,
  };
}

export function skillSlug(name: string, personaId: number): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${ascii || "persona"}_${personaId}`;
}

/** The storage root a character family's generated skills live in. */
export function skillBaseDir(characterFamily: CharacterFamily): string {
  return path.resolve(ENV.skillEngineDir, "skills", characterFamily);
}

/** Describes uploaded photos so they can contribute to the persona memories. */
async function describeImages(
  name: string,
  imageUrls: string[],
  providerName: string | undefined,
  maxImages: number = 6,
  locale: Locale = "zh",
  /** Whose pictures these are — and whose key they go to. */
  userId?: number,
): Promise<string> {
  if (imageUrls.length === 0) return "";

  /**
   * The model has to be able to see.
   *
   * It was never checked — and a provider that cannot read images
   * simply drops the picture parts and answers the text. So the model
   * was asked "these are photos of X and me, please describe them" and
   * it *invented* a description of a photo it had never seen — and the
   * invention was stored as a memory of the persona, shown in the
   * persona's editor and fed back into the prompt.
   *
   * The chat path has this check ("this model cannot see images"); the
   * distillation did not.
   */
  const resolved = await resolveProviderForUser({
    userId: userId ?? 0,
    providerName: providerName,
  });
  if (resolved && !resolved.capabilities.vision) {
    console.warn(
      `[SkillEngine] The photos were not described: ${resolved.name} cannot see images.`,
    );
    return "";
  }

  try {
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; url: string }> = [
      {
        type: "text",
        text: copy(locale, "skillPrompts.pipeline.describeImages", { name }),
      },
    ];
    for (const url of imageUrls.slice(0, maxImages)) {
      content.push({ type: "image_url", url });
    }

    const response = await invokePipeline({
      userId: userId ?? 0,
      providerName: providerName,
      messages: [{ role: "user", content }],
      options: { provider: providerName, maxTokens: 500 },
    });
    return response?.trim() || "";
  } catch (e) {
    console.warn("[SkillEngine] Image analysis failed (non-critical):", e);
    return "";
  }
}

/**
 * Renders the persona document of the generated skill package.
 *
 * The content is sanitised because the rendered `SKILL.md` is checked by the
 * quality gate: code fences, quote blocks and timestamps fail the copyright
 * check.
 */
function renderPersonaDocument(name: string, personaData: PersonaData, locale: Locale): string {
  /**
   * The heading each field gets in the document.
   *
   * The list of fields itself lives in the schema — the one place that
   * owns it — so a field cannot be added to the persona and forgotten
   * in the document.
   */
  const HEADINGS: Partial<Record<keyof PersonaData, string>> = {
    personality: "skillPrompts.document.personality",
    speakingStyle: "skillPrompts.document.speakingStyle",
    catchphrases: "skillPrompts.document.catchphrases",
    nickname: "skillPrompts.document.nickname",
    attachmentStyle: "skillPrompts.document.attachmentStyle",
    loveLanguage: "skillPrompts.document.loveLanguage",
    conflictStyle: "skillPrompts.document.conflictStyle",
    touchingMoments: "skillPrompts.document.touchingMoments",
    memories: "skillPrompts.document.memories",
    summary: "skillPrompts.document.summary",
  };

  const parts: string[] = [copy(locale, "skillPrompts.document.personaTitle", { name }), ""];
  for (const field of PERSONA_DOCUMENT_FIELDS) {
    const headingKey = HEADINGS[field];
    if (!headingKey) continue;
    const value = personaData[field];
    const text = Array.isArray(value)
      ? value.map((entry) => `- ${entry}`).join("\n")
      : String(value ?? "");
    parts.push(copy(locale, headingKey), text, "");
  }

  return sanitizeForCopyright(parts.join("\n"));
}

/**
 * Renders the work document of the generated skill package.
 *
 * For the celebrity family the research artefacts are part of the work
 * profile: the mental models and the known answers are what make the skill
 * answerable, not just the persona voice.
 */
function renderWorkDocument(
  name: string,
  personaData: PersonaData,
  research: CelebrityResearchResult | null,
  producedWorkDocument?: string | null,
  locale: Locale = "zh",
): string {
  const lines: string[] = [];

  // When the work dimension ran, its document is the work file — the
  // derived summary below would only repeat it in less detail.
  if (producedWorkDocument && producedWorkDocument.trim()) {
    lines.push(producedWorkDocument.trim());
  } else {
    lines.push(copy(locale, "skillPrompts.document.workTitle", { name }));
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.positioning"));
    lines.push(personaData.summary);
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.experienceMaterial"));
    lines.push(personaData.memories);
  }

  if (research) {
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.mentalModels"));
    if (research.mentalModels.length > 0) {
      for (const model of research.mentalModels) {
        lines.push(
          copy(locale, "skillPrompts.draft.modelLine", {
            name: model.name,
            definition: model.definition,
            evidence: model.evidence_anchors,
          }),
        );
        lines.push(copy(locale, "skillPrompts.draft.modelSeesFirst", { value: model.sees_first }));
        lines.push(copy(locale, "skillPrompts.draft.modelFiltersOut", { value: model.filters_out }));
        lines.push(
          copy(locale, "skillPrompts.draft.modelFailureMode", { value: model.failure_mode }),
        );
      }
    } else {
      lines.push(copy(locale, "skillPrompts.document.noMentalModels"));
    }
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.knownAnswers"));
    if (research.knownAnswerQuestions.length > 0) {
      for (const answer of research.knownAnswerQuestions) {
        lines.push(`- Question: ${answer.question}`);
        lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
      }
    } else {
      lines.push(copy(locale, "skillPrompts.document.noKnownAnswers"));
    }
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.genealogy"));
    if (research.genealogy.length > 0) {
      for (const entry of research.genealogy) lines.push(`- ${entry}`);
    } else {
      lines.push(copy(locale, "skillPrompts.draft.noGenealogy"));
    }
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.protocol"));
    for (const step of copy(locale, "skillPrompts.agenticProtocol").split("\n")) lines.push(step);
    lines.push("");
    lines.push(copy(locale, "skillPrompts.document.sources"));
    if (research.sources.length > 0) {
      for (const source of research.sources) lines.push(`- ${source}`);
    } else {
      lines.push(copy(locale, "skillPrompts.draft.noSources"));
    }
    if (research.audit) {
      lines.push("");
      lines.push(copy(locale, "skillPrompts.document.researchAudit"));
      lines.push(sanitizeForCopyright(research.audit).slice(0, 4000));
    }
  }

  return sanitizeForCopyright(lines.join("\n"));
}

/** Reads the generated skill directory out of the writer output. */
function parseGeneratedSkillPath(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^Created skill:\s*(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Writes the skill package through `skill_writer.py`.
 *
 * The writer takes file paths rather than inline content, so the rendered
 * work and persona documents are staged in a temporary directory first. The
 * real persona data is what makes the package worth exporting — an empty
 * `work.md` / `persona.md` produces a skill that says nothing.
 */
async function writeSkillPackage(input: {
  characterFamily: CharacterFamily;
  name: string;
  slug: string;
  baseDir: string;
  personaData: PersonaData;
  research: CelebrityResearchResult | null;
  researchProfile: string | null;
  /** The work document produced by the work-dimension stages. */
  workDocument?: string | null;
  /** The merged persona document, when the merge stage ran. */
  personaDocument?: string | null;
  /** The language the documents are written in. */
  locale?: Locale;
}): Promise<string | null> {
  const locale = input.locale ?? "zh";
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-skill-"));
  try {
    const workPath = path.join(stagingDir, "work.md");
    const personaPath = path.join(stagingDir, "persona.md");
    fs.writeFileSync(
      workPath,
      renderWorkDocument(
        input.name,
        input.personaData,
        input.research,
        input.workDocument,
        locale,
      ),
      "utf-8",
    );
    fs.writeFileSync(
      personaPath,
      input.personaDocument?.trim()
        ? input.personaDocument.trim()
        : renderPersonaDocument(input.name, input.personaData, locale),
      "utf-8",
    );

    const args = [
      "--action", "create",
      "--character", input.characterFamily,
      "--name", input.name,
      "--slug", input.slug,
      "--base-dir", input.baseDir,
      "--work", workPath,
      "--persona", personaPath,
      /**
       * The skill is not installed into the operator's home.
       *
       * The writer installs what it creates into `~/.claude/skills` by
       * default — so every distillation dropped a folder into the
       * operator's own Claude directory, outside the application, with
       * nothing said. The subprocess environment is stripped, so the
       * variable that turns it off could not be set from `.env` either.
       *
       * The skill belongs to the app; the app exports it when the user
       * asks for it.
       */
      "--no-install-claude-skill",
    ];
    if (input.researchProfile) {
      args.push("--research-profile", input.researchProfile);
    }

    try {
      const { stdout } = await runPythonTool("skill_writer.py", args);
      return parseGeneratedSkillPath(stdout) ?? path.join(input.baseDir, input.slug);
    } catch (e) {
      // The writer installs into the host skills directory as a side effect;
      // that step can fail even though the package itself was written.
      const fallback = path.join(input.baseDir, input.slug);
      if (fs.existsSync(fallback)) {
        console.warn("[SkillEngine] skill_writer reported a failure but the package exists:", e);
        return fallback;
      }
      throw e;
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** Reads the PASS/FAIL verdict out of an audit review. */
function parseAuditVerdict(audit: string): string {
  const match = audit.match(/Status:\s*(PASS|FAIL)/i);
  return match ? match[1].toUpperCase() : "UNKNOWN";
}

/**
 * The intake stage: takes stock of the material and names what is missing.
 *
 * The output is the "gap list" the plan asks for — it goes into the job's
 * `inputMeta` so the UI can tell the user what else to upload. For the
 * colleague family this is exactly what `colleague/intake.md` asks for; the
 * relationship and celebrity intake prompts are interview scripts, and their
 * questions become the gap list just as usefully.
 *
 * A failure here is not fatal — the pipeline continues with the material it
 * has.
 */
async function runIntakeStage(input: {
  characterFamily: CharacterFamily;
  profile: string | null;
  name: string;
  chatContent: string;
  imageCount: number;
  /** Whose material this is — and whose key it goes to. */
  userId: number;
  provider?: string;
  locale?: Locale;
}): Promise<string> {
  const locale = input.locale ?? "zh";
  try {
    const prompt = loadPrompt(input.characterFamily, "intake", input.profile);
    const material = [
      copy(locale, "skillPrompts.pipeline.intakePersonName", { name: input.name }),
      copy(locale, "skillPrompts.pipeline.intakeChatLength", {
        length: input.chatContent.length,
      }),
      copy(locale, "skillPrompts.pipeline.intakeImageCount", { count: input.imageCount }),
      input.chatContent.slice(0, 4000) || copy(locale, "skillPrompts.pipeline.intakeNoChat"),
    ].join("\n\n");

    const response = await invokePipeline({
      userId: input.userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.intakeInstruction") + asMaterial(material, locale),
        },
      ],
      options: { provider: input.provider, temperature: 0.3, maxTokens: 1200 },
    });
    return (response || "").trim();
  } catch (e) {
    console.warn("[SkillEngine] Intake stage failed:", e);
    return "";
  }
}

/**
 * The work dimension: what this person does and how they do it.
 *
 * Only the families that have a professional dimension run it — a colleague,
 * or a public figure whose craft is part of who they are. A relationship
 * persona does not need a job description, so it skips this and the merge
 * that follows it.
 */
async function runWorkDimension(input: {
  characterFamily: CharacterFamily;
  profile: string | null;
  name: string;
  analysisResult: string;
  research?: CelebrityResearchResult | null;
  /** Whose material this is — and whose key it goes to. */
  userId: number;
  provider?: string;
  /** The extraction stages run at a lower temperature than the default. */
  temperature?: number;
  locale?: Locale;
}): Promise<{ analysis: string; document: string } | null> {
  const locale = input.locale ?? "zh";
  try {
    const analyzerPrompt = loadPrompt(input.characterFamily, "work_analyzer", input.profile);
    const builderPrompt = loadPrompt(input.characterFamily, "work_builder", input.profile);

    const researchBlock = input.research?.digest
      ? `\n\n${copy(locale, "skillPrompts.pipeline.researchNotesHeading")}\n\n${input.research.digest.slice(0, MAX_RESEARCH_SAMPLE)}`
      : "";

    const analysis = await invokePipeline({
      userId: input.userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: analyzerPrompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.workAnalyzerName", { name: input.name }) +
            "\n\n" +
            copy(locale, "skillPrompts.pipeline.workAnalyzerResult", {
              result: input.analysisResult,
            }) +
            researchBlock,
        },
      ],
      options: { provider: input.provider, temperature: input.temperature },
    });

    const document = await invokePipeline({
      userId: input.userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: builderPrompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.workAnalyzerName", { name: input.name }) +
            "\n\n" +
            copy(locale, "skillPrompts.pipeline.workBuilderResult", { analysis }) +
            researchBlock,
        },
      ],
      options: { provider: input.provider, temperature: input.temperature },
    });

    return { analysis: analysis || "", document: document || "" };
  } catch (e) {
    console.warn("[SkillEngine] Work dimension failed (non-critical):", e);
    return null;
  }
}

/**
 * The merge stage: folds the work dimension and the persona dimension into
 * one document.
 *
 * This is a different job from the structurer, which normalises a document
 * into the canonical JSON contract: the merger is about reconciling two
 * sources that may disagree, and it leaves the conflicts visible.
 */
async function runMerger(input: {
  characterFamily: CharacterFamily;
  profile: string | null;
  name: string;
  personaDocument: string;
  workDocument: string;
  /** Whose material this is — and whose key it goes to. */
  userId: number;
  provider?: string;
  /** The extraction stages run at a lower temperature than the default. */
  temperature?: number;
  locale?: Locale;
}): Promise<string> {
  const locale = input.locale ?? "zh";
  try {
    const prompt = loadPrompt(input.characterFamily, "merger", input.profile);
    const merged = await invokePipeline({
      userId: input.userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.mergerName", { name: input.name }) + "\n\n" +
            `=== persona.md ===\n${input.personaDocument}\n\n` +
            `=== work.md ===\n${input.workDocument}`,
        },
      ],
      options: { provider: input.provider, temperature: input.temperature },
    });
    return (merged || "").trim();
  } catch (e) {
    console.warn("[SkillEngine] Merge stage failed (non-critical):", e);
    return "";
  }
}

/**
 * The mining stage: finds the smallest contrasts in the records and asks
 * the model what they mean.
 *
 * It runs after the persona has been assembled, because a rule is only
 * worth mining when there is a person to attach it to. It changes nothing
 * else about the persona: the rules are added to the contract and every
 * other field is left exactly as the structurer wrote it.
 *
 * Only the persona's own words are read. The rules are about how *she*
 * discriminates, so a contrast between her messages and the user's says
 * nothing about her — unless the records do not say whose the words are,
 * in which case the whole transcript is offered and the model is left to
 * quote what it can source.
 */
async function runMicroRuleStage(input: {
  chatContent: string;
  name: string;
  userId: number;
  provider?: string;
  mode: DistillationMode;
  temperature?: number;
  locale?: Locale;
  onProgress?: (message: string) => void;
}): Promise<MicroRule[]> {
  const locale = input.locale ?? "zh";
  try {
    const messages = parseTranscriptMessages(input.chatContent, { personaName: input.name });
    const known = messages.some((message) => message.role === "persona");
    const pairs = findContrastPairs(messages, {
      role: known ? "persona" : undefined,
      // The presets promise how much of the material a run reads, and the
      // mining reads the same records: the deep preset mines more pairs
      // than the quick one.
      limit: MICRO_RULE_PAIR_BUDGET[input.mode] ?? 12,
    });
    if (!pairs.length) return [];

    return await mineMicroRules({
      pairs,
      userId: input.userId,
      providerName: input.provider,
      locale,
      temperature: input.temperature,
      onProgress: input.onProgress,
    });
  } catch (e) {
    console.warn("[SkillEngine] Micro rule mining failed (non-critical):", e);
    return [];
  }
}

/**
 * How a failed run is retried.
 *
 * The pauses exist to get past a rate limit rather than to hammer it, so
 * they grow with the attempt number.
 */
export const pipelineRetryPolicy: {
  maxAttempts: number;
  delaysMs: number[];
} = {
  maxAttempts: 3,
  delaysMs: [1000, 2000],
};

/**
 * Runs the full distillation pipeline for a persona.
 *
 * Never throws: failures are recorded on the persona and the skill job so the
 * UI can surface them, but the caller is not left with an unhandled rejection.
 *
 * A failed attempt is retried: the stages call a model, and a model call can
 * fail for reasons that have nothing to do with the material — a timeout, a
 * rate limit, a provider that was briefly unavailable. The retry count is
 * kept on the job so the UI can show that a run had to be repeated.
 */
export async function runSkillPipeline(input: PipelineInput): Promise<void> {
  const maxAttempts = pipelineRetryPolicy.maxAttempts;

  /**
   * The job row is created once, before the first attempt.
   *
   * It used to be created inside the attempt, so a run that was retried
   * left one row per attempt behind: the earlier rows stayed in the
   * non-terminal stage "intake" with a "retrying" message on them, for
   * ever. And the retry count was written to the last row, which nothing
   * read.
   */
  const jobId = await createPipelineJob(input);
  if (jobId) {
    // The persona points at the job straight away, so the interface
    // polls the run that is happening — not the one before it.
    await db
      .updatePersona(input.personaId, input.userId, { skillJobId: jobId })
      .catch((e) => console.warn("[SkillEngine] Could not link the job:", e));
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runSkillPipelineOnce(input, attempt, maxAttempts, jobId);
      return;
    } catch (error) {
      console.error(
        `[SkillEngine] Pipeline attempt ${attempt}/${maxAttempts} failed:`,
        error,
      );
      if (jobId) {
        // The retry count is on the one row, so it can be counted.
        await db
          .updateSkillJob(jobId, input.userId, { retryCount: attempt })
          .catch((e) => console.warn("[SkillEngine] Job update failed:", e));
      }
      if (attempt >= maxAttempts) return;

      // A short pause before the next attempt — an immediate retry would
      // hit the same rate limit.
      const delay = pipelineRetryPolicy.delaysMs[attempt - 1] ?? 1000;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

/**
 * The job row for a run.
 *
 * It is created once, whatever happens to the run.
 */
async function createPipelineJob(input: PipelineInput): Promise<number> {
  const preset = getDistillationPreset(input.mode);
  const characterFamily: CharacterFamily = input.mode
    ? preset.characterFamily
    : input.characterFamily;
  const requestedProfile = input.mode ? preset.researchProfile : input.researchProfile;
  const resolution = resolveCelebrityProfile(characterFamily, requestedProfile);
  const effectiveProfile = resolution.profile;

  // What the job row records about the run: the research profile and the
  // preset, if there were any. Nothing at all stays NULL, as it was.
  const jobMeta: Record<string, unknown> = {
    ...(input.intakeMeta ?? {}),
    ...(effectiveProfile ? { researchProfile: effectiveProfile } : {}),
    ...(input.mode ? { distillationMode: preset.id } : {}),
  };

  return db.createSkillJob({
    personaId: input.personaId,
    userId: input.userId,
    characterFamily,
    // The profile is stored on the job row so it can be read back without
    // digging through `inputMeta`, and so the UI can show which research
    // profile a run used.
    researchProfile: effectiveProfile ?? null,
    pipelineStage: "intake",
    inputMeta: Object.keys(jobMeta).length > 0 ? jobMeta : null,
  }).catch((e) => {
    console.error("[SkillEngine] Failed to create skill job:", e);
    return 0;
  });
}

/** Runs the pipeline once. Throws when it fails, so the caller can retry. */
async function runSkillPipelineOnce(
  input: PipelineInput,
  attempt: number,
  maxAttempts: number,
  /** The job row, created once for the whole run. */
  jobId: number,
): Promise<void> {
  const { personaId, userId, name, chatContent } = input;
  // Chinese is the default: it is what the app has always said, and a
  // caller that does not name a locale keeps the historical behaviour.
  const locale = input.locale ?? "zh";

  // The preset decides the family, the research profile and the three depth
  // knobs. When the caller named one, it wins over the family and the
  // profile that were passed alongside it; when it did not, the run keeps
  // the family and the profile it was given and takes the depth knobs from
  // the standard preset — which is what the app always used.
  const preset: DistillationPreset = getDistillationPreset(input.mode);
  const characterFamily: CharacterFamily = input.mode
    ? preset.characterFamily
    : input.characterFamily;
  const requestedProfile = input.mode ? preset.researchProfile : input.researchProfile;

  // The research profile only applies to the celebrity family, and only a
  // profile that declares the complete research flow unlocks the extra stages.
  const resolution = resolveCelebrityProfile(characterFamily, requestedProfile);
  const effectiveProfile = resolution.profile;

  // What the job row records about the run: the research profile and the
  // preset, if there were any. Nothing at all stays NULL, as it was.
  const jobMeta: Record<string, unknown> = {
    ...(input.intakeMeta ?? {}),
    ...(effectiveProfile ? { researchProfile: effectiveProfile } : {}),
    ...(input.mode ? { distillationMode: preset.id } : {}),
  };

  const setPersonaProgress = (analysisProgress: number, analysisMessage: string) =>
    db
      .updatePersona(personaId, userId, { analysisProgress, analysisMessage })
      .catch((e) => console.warn("[SkillEngine] Progress update failed:", e));

  /** Job tracking is best-effort: if the job row could not be created, skip it. */
  const setJobStage = (stage: Parameters<typeof db.updateSkillJob>[2], jobId: number) =>
    jobId
      ? db.updateSkillJob(jobId, userId, stage).catch((e) => console.warn("[SkillEngine] Job update failed:", e))
      : Promise.resolve();

  // The celebrity research flow claims the first slice of the progress bar.
  const stageProgress = resolution.hasResearchStages
    ? {
        intake: 40,
        analyzing_persona: 55,
        building: 70,
        analyzing_work: 78,
        merging: 84,
        structuring: 92,
      }
    : {
        intake: 8,
        analyzing_persona: 18,
        building: 45,
        analyzing_work: 58,
        merging: 68,
        structuring: 78,
      };

  const slug = skillSlug(name, personaId);
  const baseDir = skillBaseDir(characterFamily);
  const skillDir = path.join(baseDir, slug);

  try {
    // ── Celebrity research (researching → auditing → synthesizing → validating)
    let research: CelebrityResearchResult | null = null;
    if (resolution.hasResearchStages && effectiveProfile) {
      fs.mkdirSync(skillDir, { recursive: true });
      try {
        research = await runCelebrityResearch({
          personaId,
          userId,
          name,
          profile: effectiveProfile,
          skillDir,
          sourceMaterial: buildResearchMaterial(chatContent, input.intakeMeta),
          provider: input.provider,
          locale,
          onStage: async (stage, progress, message) => {
            await setJobStage(
              {
                pipelineStage: researchStage(stage),
                stageProgress: progress,
                stageMessage: message,
              },
              jobId,
            );
            await setPersonaProgress(progress, message);
          },
        });
      } catch (e) {
        // The research is evidence, not a precondition: without it the persona
        // stages still run, they just have less material.
        console.warn("[SkillEngine] Celebrity research failed (non-critical):", e);
      }
    }

    // ── Stage 0: intake ─────────────────────────────────────────────────────
    // Takes stock of the material and names what is missing, so the user can
    // be told what else to upload.
    let intakeNotes = "";
    // With no material at all the run is really still *collecting* — the
    // stage id has to say so, otherwise a consumer cannot tell "we are
    // waiting for the chat logs" from "we are reading them".
    const hasMaterial = chatContent.trim().length > 0 || (input.imageUrls?.length ?? 0) > 0;
    const intakeMessage = hasMaterial
      ? copy(locale, "skill.takingStock")
      : copy(locale, "skill.waitingMaterial");
    await setJobStage(
      {
        pipelineStage: hasMaterial ? "intake" : "collecting",
        stageProgress: stageProgress.intake,
        stageMessage: intakeMessage,
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.intake, intakeMessage);

    intakeNotes = await runIntakeStage({
      characterFamily,
      profile: effectiveProfile,
      name,
      chatContent,
      imageCount: input.imageUrls?.length ?? 0,
      userId,
      provider: input.provider,
      locale,
    });

    if (intakeNotes && jobId) {
      await db
        .updateSkillJob(jobId, userId, {
          inputMeta: {
            ...(input.intakeMeta ?? {}),
            ...(effectiveProfile ? { researchProfile: effectiveProfile } : {}),
            intake: intakeNotes.slice(0, 8000),
          },
        })
        .catch((e) => console.warn("[SkillEngine] Failed to store the intake notes:", e));
    }

    // ── Stage 1: analyze ────────────────────────────────────────────────────
    await setJobStage(
      {
        pipelineStage: "analyzing_persona",
        stageProgress: stageProgress.analyzing_persona,
        stageMessage: copy(locale, "skill.analyzingPersona"),
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.analyzing_persona, copy(locale, "skill.analyzingPersona"));

    const analyzerPrompt = loadPrompt(characterFamily, "persona_analyzer", effectiveProfile);
    const chatSample = chatContent.slice(0, preset.chatSampleLimit);
    const chatBlock = chatSample || copy(locale, "skillPrompts.pipeline.noChatBlock");
    const analysisMaterial = research
      ? [
          chatBlock,
          copy(locale, "skill.researchNote", {
            notes: research.digest.slice(0, MAX_RESEARCH_SAMPLE),
          }),
        ].join("\n\n")
      : chatBlock;
    const analysisResult = await invokePipeline({
      userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: analyzerPrompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.analyzerName", { name }) +
            "\n\n" +
            copy(locale, "skillPrompts.pipeline.analyzerMaterial", {
              // The material is fenced: it is the user's own chat log,
              // and it can say anything.
              material: asMaterial(analysisMaterial, locale),
            }),
        },
      ],
      options: { provider: input.provider, temperature: preset.analysisTemperature },
    });

    // ── Stage 2: build ─────────────────────────────────────────────────────
    await setJobStage(
      {
        pipelineStage: "building",
        stageProgress: stageProgress.building,
        stageMessage: copy(locale, "skill.buildingPortrait"),
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.building, copy(locale, "skill.buildingPortrait"));

    const builderPrompt = loadPrompt(characterFamily, "persona_builder", effectiveProfile);
    const builderMaterial = asMaterial(
      research
        ? [
            copy(locale, "skillPrompts.pipeline.builderAnalysis", { result: analysisResult }),
            copy(locale, "skillPrompts.pipeline.builderResearchNotes", {
              notes: research.digest.slice(0, MAX_RESEARCH_SAMPLE),
            }),
          ].join("\n\n")
        : copy(locale, "skillPrompts.pipeline.builderAnalysis", { result: analysisResult }),
      locale,
    );
    const builtPersona = await invokePipeline({
      userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: builderPrompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.builderName", { name }) + "\n\n" + builderMaterial,
        },
      ],
      options: { provider: input.provider, temperature: preset.analysisTemperature },
    });

    // ── Stage 2b: the work dimension ───────────────────────────────────────
    // Only for the families that have a professional side. A relationship
    // persona skips it, and with it the merge that depends on it.
    let workDocument: string | null = null;
    if (WORK_DIMENSION_FAMILIES.includes(characterFamily)) {
      await setJobStage(
        {
          pipelineStage: "analyzing_work",
          stageProgress: stageProgress.analyzing_work,
          stageMessage: copy(locale, "skill.analyzingWork"),
        },
        jobId,
      );
      await setPersonaProgress(stageProgress.analyzing_work, copy(locale, "skill.analyzingWork"));

      const work = await runWorkDimension({
        characterFamily,
        profile: effectiveProfile,
        name,
        analysisResult,
        research,
        userId,
        provider: input.provider,
        temperature: preset.analysisTemperature,
        locale,
      });
      workDocument = work?.document?.trim() || null;
    }

    // ── Stage 3: merge the work and persona dimensions ──────────────────────
    // `builtPersona` is the layered persona document the builder produced; the
    // merge reconciles it with the work document rather than restructuring
    // either one.
    let mergedPersonaDocument: string | null = null;
    if (workDocument) {
      await setJobStage(
        {
          pipelineStage: "merging",
          stageProgress: stageProgress.merging,
          stageMessage: copy(locale, "skill.mergingDimensions"),
        },
        jobId,
      );
      await setPersonaProgress(stageProgress.merging, copy(locale, "skill.mergingDimensions"));

      mergedPersonaDocument =
        (await runMerger({
          characterFamily,
          profile: effectiveProfile,
          name,
          userId,
          personaDocument: builtPersona,
          workDocument,
          provider: input.provider,
          temperature: preset.analysisTemperature,
          locale,
        })) || null;
    }

    // ── Stage 4: structure into the canonical contract ─────────────────────
    await setJobStage(
      {
        // Its own stage id: the merge step and the structurer step are
        // different, and a consumer of `pipeline_stage` has to be able to
        // tell them apart.
        pipelineStage: "structuring",
        stageProgress: stageProgress.structuring,
        stageMessage: copy(locale, "skill.integrating"),
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.structuring, copy(locale, "skill.integrating"));

    const structurerPrompt = loadPrompt(characterFamily, "structurer", effectiveProfile);
    const structuredRaw = await invokePipeline({
      userId,
      providerName: input.provider,
      messages: [
        { role: "system", content: structurerPrompt },
        {
          role: "user",
          content:
            copy(locale, "skillPrompts.pipeline.structurerName", { name }) +
            "\n\n" +
            copy(locale, "skillPrompts.pipeline.structurerAnalysis", {
              analysis: analysisResult,
            }) +
            "\n\n" +
            copy(locale, "skillPrompts.pipeline.structurerPortrait", {
              portrait: mergedPersonaDocument || builtPersona,
            }),
        },
      ],
      options: { provider: input.provider, temperature: preset.analysisTemperature },
    });

    const parsed = extractJsonObject(structuredRaw);

    // ── Stage 4: enrich with photo memories ────────────────────────────────
    const imageNote = await describeImages(
      name,
      input.imageUrls ?? [],
      input.provider,
      preset.maxImages,
      locale,
      userId,
    );
    const baseData = normalizePersonaData(parsed, { name, locale });
    const enrichedData: PersonaData = imageNote
      ? {
          ...baseData,
          memories: `${baseData.memories}\n\n${copy(locale, "skillPrompts.pipeline.photoMemories")}${imageNote}`.trim(),
        }
      : baseData;

    // ── Stage 4b: mine the discriminative rules ─────────────────────────────
    // The rules are read off the records and written into the contract; the
    // persona itself is left exactly as the structurer wrote it.
    await setJobStage(
      {
        pipelineStage: "structuring",
        stageProgress: stageProgress.structuring,
        stageMessage: copy(locale, "labels.microRules.mining"),
      },
      jobId,
    );
    await setPersonaProgress(
      stageProgress.structuring,
      copy(locale, "labels.microRules.mining"),
    );

    const microRules =
      input.mineRules === false
        ? []
        : await runMicroRuleStage({
            chatContent,
            name,
            userId,
            provider: input.provider,
            mode: preset.id,
            temperature: preset.analysisTemperature,
            locale,
            onProgress: (message) => {
              void setPersonaProgress(stageProgress.structuring, message);
            },
          });

    await setPersonaProgress(
      stageProgress.structuring,
      microRules.length
        ? copy(locale, "labels.microRules.mined", { count: microRules.length })
        : copy(locale, "labels.microRules.minedNone"),
    );

    const previous = await (async () => {
      try {
        const persona = await db.getPersonaById(personaId, userId);
        return (persona?.personaData as Partial<PersonaData>) || {};
      } catch {
        // A persona that cannot be read is a persona whose own decisions
        // are unknown. The distillation still runs; it just cannot carry
        // anything over.
        return {};
      }
    })();

    /**
     * The persona is read again, right before the write.
     *
     * Between the read above and the write there is a model call — so
     * a correction typed in the persona editor in that window ("she
     * actually says X, not Y") was written, the toast said it was
     * applied, and a minute later the distillation finished and put
     * the persona back exactly as it was before the correction. The
     * correction log kept the record; the persona did not.
     *
     * So the persona is read again, and if it has changed, the user's
     * own words win.
     */
    const changedWhileRunning = await (async () => {
      try {
        const persona = await db.getPersonaById(personaId, userId);
        const latest = (persona?.personaData as Partial<PersonaData>) || {};
        return JSON.stringify(latest) !== JSON.stringify(previous);
      } catch {
        return false;
      }
    })();

    const personaData = changedWhileRunning
      ? {
          ...enrichedData,
          ...(await (async () => {
            try {
              const persona = await db.getPersonaById(personaId, userId);
              return (persona?.personaData as Partial<PersonaData>) || {};
            } catch {
              return {};
            }
          })()),
        }
      : mergeUserDecisions(enrichedData, previous, microRules, locale);

    if (changedWhileRunning) {
      console.warn(
        "[SkillEngine] The persona was changed while the run was going — the newer version was kept.",
      );
    }

    /**
     * The facts in the upload become memories.
     *
     * The distillation wrote the persona's personality and its rules —
     * and the individual facts (the birthday, the anniversary, the
     * place they went) stayed in the upload. So the memory panel was
     * empty after the very upload the person did to fill it, and the
     * anchors and the pinning had nothing to work with.
     *
     * The extraction reads the transcript itself, so it is the same
     * reading the persona is built from.
     */
    if (chatContent.trim()) {
      const transcript = parseTranscriptMessages(chatContent, { personaName: name });
      const uploaded = transcript
        .filter((m) => m.content.trim())
        .slice(0, MEMORY_EXTRACTION_MESSAGE_LIMIT)
        .map((m, index) => ({
          id: index + 1,
          // The role is optional in the parser's shape — a line with no
          // speaker has none — and the extraction wants a string.
          role: m.role ?? "",
          content: m.content,
          createdAt: new Date(0),
        }));
      if (uploaded.length >= 1) {
        /**
         * The extraction is a bonus, not a step.
         *
         * A persona that cannot be read is a persona whose own decisions
         * are unknown — and the run still finishes. So the extraction
         * never stops the distillation.
         */
        let persona: Awaited<ReturnType<typeof db.getPersonaById>> | undefined;
        try {
          persona = await db.getPersonaById(personaId, userId);
        } catch {
          persona = undefined;
        }
        if (persona) {
          await extractMemories({
            persona,
            userId,
            locale,
            history: uploaded,
          }).catch((e) =>
            console.warn("[SkillEngine] The memories could not be extracted from the upload:", e.message),
          );
        }
      }
    }

    // ── Stage 5: persist ───────────────────────────────────────────────────
    await db.updatePersona(personaId, userId, {
      personaData,
      analysisStatus: "ready",
      analysisProgress: 100,
      analysisMessage: copy(locale, "skillPrompts.pipeline.personaReady", { name }),
      // Only link the job when one was actually created.
      ...(jobId ? { skillJobId: jobId } : {}),
    });

    if (jobId) {
      await db.updateSkillJob(jobId, userId, {
        pipelineStage: "complete",
        stageProgress: 100,
        stageMessage: copy(locale, "skill.done"),
        analysisResult: personaData as any,
      });
    }

    // Optional: generate a reusable skill package (non-blocking).
    let generatedSkillPath: string | null = null;
    try {
      generatedSkillPath = await writeSkillPackage({
        characterFamily,
        name,
        slug,
        baseDir,
        personaData,
        research,
        researchProfile: effectiveProfile,
        workDocument,
        personaDocument: mergedPersonaDocument,
        locale,
      });
    } catch (e) {
      console.warn("[SkillEngine] Python skill_writer failed (non-critical):", e);
    }
    if (jobId && generatedSkillPath) {
      await db
        .updateSkillJob(jobId, userId, { generatedSkillPath })
        .catch((e) => console.warn("[SkillEngine] Job update failed:", e));
    }

    // The research artefacts are stored separately from the job row so the
    // research history survives a re-run of the persona pipeline.
    if (research) {
      await saveResearchProfile({
        userId,
        personaId,
        profile: research.profile,
        notes: { digest: research.digest },
        audit: { verdict: parseAuditVerdict(research.audit), text: research.audit },
        synthesis: {
          text: research.synthesis,
          mental_models: research.mentalModels,
          known_answer_questions: research.knownAnswerQuestions,
        },
        validation: { text: research.validation },
        qualityReport: {
          afterAudit: research.qualityReport,
          afterValidation: research.finalQualityReport,
          afterPackage: generatedSkillPath
            ? await runQualityCheck(generatedSkillPath, research.profile)
            : null,
        },
        status: research.status,
      });
    }
  } catch (error) {
    console.error("[SkillEngine] Pipeline error:", error);

    // The retry count lives on the job, so the UI can tell "this failed
    // three times" from "this failed once".
    await db
      .updateSkillJob(jobId, userId, { retryCount: Math.max(0, attempt) })
      .catch(() => undefined);

    if (attempt < maxAttempts) {
      // The run is going to be repeated, so the job stays in a retryable
      // state rather than being marked as failed.
      await setJobStage(
        {
          pipelineStage: "intake",
          stageMessage: copy(locale, "skill.retrying", { attempt }),
        },
        jobId,
      );
      throw error;
    }

    /**
     * Why the run failed.
     *
     * The reason is shown to the user — a failed distillation used to
     * say only "the analysis failed", so there was no way to tell a bad
     * key from a bad upload. The reason is the provider's own error,
     * so it is stripped of the endpoint and the credentials first.
     */
    const reason = safeErrorMessage(error);
    await setJobStage(
      {
        pipelineStage: "error",
        stageMessage: reason,
      },
      jobId,
    );
    await db.updatePersona(personaId, userId, {
      analysisStatus: "error",
      analysisMessage: copy(locale, "skill.analysisFailedReason", { reason }),
    });
  }
}

/**
 * Collects the material the research stage starts from.
 *
 * The research stage works on the user-supplied source material; the intake
 * metadata may carry additional collected material.
 */
function buildResearchMaterial(
  chatContent: string,
  intakeMeta?: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (chatContent.trim()) parts.push(chatContent.trim());

  const extra = intakeMeta?.material ?? intakeMeta?.collectedMaterial ?? intakeMeta?.sourceMaterial;
  if (typeof extra === "string" && extra.trim()) parts.push(extra.trim());

  return parts.join("\n\n---\n\n").slice(0, MAX_RESEARCH_MATERIAL);
}
