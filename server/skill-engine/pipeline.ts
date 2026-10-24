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
import { llmService } from "../llm";
import { loadPrompt } from "./prompts";
import { runPythonTool } from "./runner";
import { extractJsonObject } from "../_core/json";
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";
import { ENV } from "../_core/env";
import * as db from "../db";
import {
  resolveCelebrityProfile,
  runCelebrityResearch,
  runQualityCheck,
  sanitizeForCopyright,
  saveResearchProfile,
  AGENTIC_PROTOCOL,
  type CelebrityResearchResult,
  type CelebrityResearchStage,
} from "./celebrity";

export type CharacterFamily = "colleague" | "relationship" | "celebrity";

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
};

/**
 * The families whose persona has a professional dimension.
 *
 * A colleague's job is part of who they are, and a public figure's craft is
 * too. A relationship persona does not need either, so it skips the work
 * stages — and the merge that depends on them.
 */
const WORK_DIMENSION_FAMILIES: CharacterFamily[] = ["colleague", "celebrity"];

const MAX_CHAT_SAMPLE = 10000;
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
  provider?: string,
): Promise<string> {
  if (imageUrls.length === 0) return "";

  try {
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; url: string }> = [
      {
        type: "text",
        text: `这些是我和${name}的照片。请描述照片中体现的情感氛围，以及能反映${name}性格特质的细节。用中文，2-3句话。`,
      },
    ];
    for (const url of imageUrls.slice(0, 6)) {
      content.push({ type: "image_url", url });
    }

    const response = await llmService.invoke({
      messages: [{ role: "user", content }],
      options: { provider, maxTokens: 500 },
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
function renderPersonaDocument(name: string, personaData: PersonaData): string {
  const catchphrases = personaData.catchphrases.map((phrase) => `- ${phrase}`).join("\n");
  return sanitizeForCopyright(
    [
      `# 人物性格：${name}`,
      "",
      "## 性格",
      personaData.personality,
      "",
      "## 说话方式",
      personaData.speakingStyle,
      "",
      "## 口头禅",
      catchphrases,
      "",
      "## 昵称",
      personaData.nickname,
      "",
      "## 依恋类型",
      personaData.attachmentStyle,
      "",
      "## 爱的语言",
      personaData.loveLanguage,
      "",
      "## 争吵方式",
      personaData.conflictStyle,
      "",
      "## 动人时刻",
      personaData.touchingMoments,
      "",
      "## 记忆",
      personaData.memories,
      "",
      "## 一句话总结",
      personaData.summary,
    ].join("\n"),
  );
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
): string {
  const lines: string[] = [];

  // When the work dimension ran, its document is the work file — the
  // derived summary below would only repeat it in less detail.
  if (producedWorkDocument && producedWorkDocument.trim()) {
    lines.push(producedWorkDocument.trim());
  } else {
    lines.push(`# 工作能力：${name}`);
    lines.push("");
    lines.push("## 定位");
    lines.push(personaData.summary);
    lines.push("");
    lines.push("## 经验素材");
    lines.push(personaData.memories);
  }

  if (research) {
    lines.push("");
    lines.push("## 心智模型");
    if (research.mentalModels.length > 0) {
      for (const model of research.mentalModels) {
        lines.push(`- ${model.name}：${model.definition}（依据：${model.evidence_anchors}）`);
        lines.push(`  - 第一眼先看：${model.sees_first}`);
        lines.push(`  - 会过滤掉：${model.filters_out}`);
        lines.push(`  - 失效场景：${model.failure_mode}`);
      }
    } else {
      lines.push("- 研究阶段未产出心智模型。");
    }
    lines.push("");
    lines.push("## 已知答案");
    if (research.knownAnswerQuestions.length > 0) {
      for (const answer of research.knownAnswerQuestions) {
        lines.push(`- Question: ${answer.question}`);
        lines.push(`  Evidence anchors: ${answer.evidence_anchors}`);
      }
    } else {
      lines.push("- 研究阶段未产出已知答案问题。");
    }
    lines.push("");
    lines.push("## 智识谱系");
    if (research.genealogy.length > 0) {
      for (const entry of research.genealogy) lines.push(`- ${entry}`);
    } else {
      lines.push("- 智识谱系尚未整理：研究笔记里还没有可核对的思想来源。");
    }
    lines.push("");
    lines.push("## 分析协议");
    for (const step of AGENTIC_PROTOCOL.split("\n")) lines.push(step);
    lines.push("");
    lines.push("## 来源");
    if (research.sources.length > 0) {
      for (const source of research.sources) lines.push(`- ${source}`);
    } else {
      lines.push("- 尚未记录可核对的来源 URL。");
    }
    if (research.audit) {
      lines.push("");
      lines.push("## 研究审计");
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
}): Promise<string | null> {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-skill-"));
  try {
    const workPath = path.join(stagingDir, "work.md");
    const personaPath = path.join(stagingDir, "persona.md");
    fs.writeFileSync(
      workPath,
      renderWorkDocument(input.name, input.personaData, input.research, input.workDocument),
      "utf-8",
    );
    fs.writeFileSync(
      personaPath,
      input.personaDocument?.trim()
        ? input.personaDocument.trim()
        : renderPersonaDocument(input.name, input.personaData),
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
  provider?: string;
}): Promise<string> {
  try {
    const prompt = loadPrompt(input.characterFamily, "intake", input.profile);
    const material = [
      `人物名称：${input.name}`,
      `聊天记录字数：${input.chatContent.length}`,
      `图片数量：${input.imageCount}`,
      input.chatContent.slice(0, 4000) || "（没有聊天记录文本）",
    ].join("\n\n");

    const response = await llmService.invoke({
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            "以下是已经拿到的材料。请盘点这些材料能支撑到什么程度，" +
            "并列出还缺哪些材料（按优先级排列）。\n\n" +
            material,
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
  provider?: string;
}): Promise<{ analysis: string; document: string } | null> {
  try {
    const analyzerPrompt = loadPrompt(input.characterFamily, "work_analyzer", input.profile);
    const builderPrompt = loadPrompt(input.characterFamily, "work_builder", input.profile);

    const researchBlock = input.research?.digest
      ? `\n\n## 研究笔记\n\n${input.research.digest.slice(0, MAX_RESEARCH_SAMPLE)}`
      : "";

    const analysis = await llmService.invoke({
      messages: [
        { role: "system", content: analyzerPrompt },
        {
          role: "user",
          content:
            `人物名称：${input.name}\n\n人物分析结果：\n${input.analysisResult}${researchBlock}`,
        },
      ],
      options: { provider: input.provider },
    });

    const document = await llmService.invoke({
      messages: [
        { role: "system", content: builderPrompt },
        {
          role: "user",
          content:
            `人物名称：${input.name}\n\n工作维度分析：\n${analysis}${researchBlock}`,
        },
      ],
      options: { provider: input.provider },
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
  provider?: string;
}): Promise<string> {
  try {
    const prompt = loadPrompt(input.characterFamily, "merger", input.profile);
    const merged = await llmService.invoke({
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            `人物名称：${input.name}\n\n` +
            `=== persona.md ===\n${input.personaDocument}\n\n` +
            `=== work.md ===\n${input.workDocument}`,
        },
      ],
      options: { provider: input.provider },
    });
    return (merged || "").trim();
  } catch (e) {
    console.warn("[SkillEngine] Merge stage failed (non-critical):", e);
    return "";
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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runSkillPipelineOnce(input, attempt, maxAttempts);
      return;
    } catch (error) {
      console.error(
        `[SkillEngine] Pipeline attempt ${attempt}/${maxAttempts} failed:`,
        error,
      );
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

/** Runs the pipeline once. Throws when it fails, so the caller can retry. */
async function runSkillPipelineOnce(
  input: PipelineInput,
  attempt: number,
  maxAttempts: number,
): Promise<void> {
  const { personaId, userId, characterFamily, name, chatContent } = input;

  // The research profile only applies to the celebrity family, and only a
  // profile that declares the complete research flow unlocks the extra stages.
  const resolution = resolveCelebrityProfile(characterFamily, input.researchProfile);
  const effectiveProfile = resolution.profile;

  const jobId = await db.createSkillJob({
    personaId,
    userId,
    characterFamily,
    // The profile is stored on the job row so it can be read back without
    // digging through `inputMeta`, and so the UI can show which research
    // profile a run used.
    researchProfile: effectiveProfile ?? null,
    pipelineStage: "intake",
    inputMeta: effectiveProfile
      ? { ...(input.intakeMeta ?? {}), researchProfile: effectiveProfile }
      : input.intakeMeta ?? null,
  }).catch((e) => {
    console.error("[SkillEngine] Failed to create skill job:", e);
    return 0;
  });

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
    await setJobStage(
      {
        pipelineStage: hasMaterial ? "intake" : "collecting",
        stageProgress: stageProgress.intake,
        stageMessage: hasMaterial ? "正在盘点素材..." : "等待素材...",
      },
      jobId,
    );
    await setPersonaProgress(
      stageProgress.intake,
      hasMaterial ? "正在盘点素材..." : "等待素材...",
    );

    intakeNotes = await runIntakeStage({
      characterFamily,
      profile: effectiveProfile,
      name,
      chatContent,
      imageCount: input.imageUrls?.length ?? 0,
      provider: input.provider,
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
        stageMessage: "正在分析人物性格...",
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.analyzing_persona, "正在分析人物性格...");

    const analyzerPrompt = loadPrompt(characterFamily, "persona_analyzer", effectiveProfile);
    const chatSample = chatContent.slice(0, MAX_CHAT_SAMPLE);
    const chatBlock = chatSample || "（暂无聊天记录，请基于已有信息谨慎推断）";
    const analysisMaterial = research
      ? [
          chatBlock,
          `## 研究笔记（来自公开资料研究阶段）\n\n${research.digest.slice(0, MAX_RESEARCH_SAMPLE)}`,
        ].join("\n\n")
      : chatBlock;
    const analysisResult = await llmService.invoke({
      messages: [
        { role: "system", content: analyzerPrompt },
        {
          role: "user",
          content: `人物名称：${name}\n\n聊天记录/素材：\n${analysisMaterial}`,
        },
      ],
      options: { provider: input.provider },
    });

    // ── Stage 2: build ─────────────────────────────────────────────────────
    await setJobStage(
      {
        pipelineStage: "building",
        stageProgress: stageProgress.building,
        stageMessage: "正在构建人物画像...",
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.building, "正在构建人物画像...");

    const builderPrompt = loadPrompt(characterFamily, "persona_builder", effectiveProfile);
    const builderMaterial = research
      ? [
          `分析结果：\n${analysisResult}`,
          `研究笔记：\n${research.digest.slice(0, MAX_RESEARCH_SAMPLE)}`,
        ].join("\n\n")
      : `分析结果：\n${analysisResult}`;
    const builtPersona = await llmService.invoke({
      messages: [
        { role: "system", content: builderPrompt },
        { role: "user", content: `人物名称：${name}\n\n${builderMaterial}` },
      ],
      options: { provider: input.provider },
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
          stageMessage: "正在分析工作维度...",
        },
        jobId,
      );
      await setPersonaProgress(stageProgress.analyzing_work, "正在分析工作维度...");

      const work = await runWorkDimension({
        characterFamily,
        profile: effectiveProfile,
        name,
        analysisResult,
        research,
        provider: input.provider,
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
          stageMessage: "正在合并工作与人格维度...",
        },
        jobId,
      );
      await setPersonaProgress(stageProgress.merging, "正在合并工作与人格维度...");

      mergedPersonaDocument =
        (await runMerger({
          characterFamily,
          profile: effectiveProfile,
          name,
          personaDocument: builtPersona,
          workDocument,
          provider: input.provider,
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
        stageMessage: "正在整合结果...",
      },
      jobId,
    );
    await setPersonaProgress(stageProgress.structuring, "正在整合结果...");

    const structurerPrompt = loadPrompt(characterFamily, "structurer", effectiveProfile);
    const structuredRaw = await llmService.invoke({
      messages: [
        { role: "system", content: structurerPrompt },
        {
          role: "user",
          content:
            `人物名称：${name}\n\n行为分析：\n${analysisResult}\n\n人物画像：\n` +
            `${mergedPersonaDocument || builtPersona}`,
        },
      ],
      options: { provider: input.provider, temperature: 0.3 },
    });

    const parsed = extractJsonObject(structuredRaw);

    // ── Stage 4: enrich with photo memories ────────────────────────────────
    const imageNote = await describeImages(name, input.imageUrls ?? [], input.provider);
    const baseData = normalizePersonaData(parsed, { name });
    const personaData: PersonaData = imageNote
      ? { ...baseData, memories: `${baseData.memories}\n\n【照片记忆】${imageNote}`.trim() }
      : baseData;

    // ── Stage 5: persist ───────────────────────────────────────────────────
    await db.updatePersona(personaId, userId, {
      personaData,
      analysisStatus: "ready",
      analysisProgress: 100,
      analysisMessage: `${name} 的数字分身已准备好，可以开始对话了`,
      // Only link the job when one was actually created.
      ...(jobId ? { skillJobId: jobId } : {}),
    });

    if (jobId) {
      await db.updateSkillJob(jobId, userId, {
        pipelineStage: "complete",
        stageProgress: 100,
        stageMessage: "完成",
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
      .updateSkillJob(jobId, userId, { retryCount: Math.max(0, attempt - 1) })
      .catch(() => undefined);

    if (attempt < maxAttempts) {
      // The run is going to be repeated, so the job stays in a retryable
      // state rather than being marked as failed.
      await setJobStage(
        {
          pipelineStage: "intake",
          stageMessage: `第 ${attempt} 次尝试失败，正在重试...`,
        },
        jobId,
      );
      throw error;
    }

    await setJobStage(
      {
        pipelineStage: "error",
        stageMessage: `Pipeline failed: ${error}`,
      },
      jobId,
    );
    await db.updatePersona(personaId, userId, {
      analysisStatus: "error",
      analysisMessage: "性格蒸馏失败，请重试",
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
