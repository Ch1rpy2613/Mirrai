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
 */
import { llmService } from "../llm";
import { loadPrompt } from "./prompts";
import { runPythonTool } from "./runner";
import { extractJsonObject } from "../_core/json";
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";
import * as db from "../db";

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
};

const MAX_CHAT_SAMPLE = 10000;

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
 * Runs the full distillation pipeline for a persona.
 *
 * Never throws: failures are recorded on the persona and the skill job so the
 * UI can surface them, but the caller is not left with an unhandled rejection.
 */
export async function runSkillPipeline(input: PipelineInput): Promise<void> {
  const { personaId, userId, characterFamily, name, chatContent } = input;

  const jobId = await db.createSkillJob({
    personaId,
    userId,
    characterFamily,
    pipelineStage: "intake",
    inputMeta: input.intakeMeta ?? null,
  }).catch((e) => {
    console.error("[SkillEngine] Failed to create skill job:", e);
    return 0;
  });

  const setPersonaProgress = (analysisProgress: number, analysisMessage: string) =>
    db
      .updatePersona(personaId, userId, { analysisProgress, analysisMessage })
      .catch((e) => console.warn("[SkillEngine] Progress update failed:", e));

  /** Job tracking is best-effort: if the job row could not be created, skip it. */
  const setJobStage = (stage: Parameters<typeof db.updateSkillJob>[1], jobId: number) =>
    jobId
      ? db.updateSkillJob(jobId, stage).catch((e) => console.warn("[SkillEngine] Job update failed:", e))
      : Promise.resolve();

  try {
    // ── Stage 1: analyze ────────────────────────────────────────────────────
    await setJobStage(
      {
        pipelineStage: "analyzing_persona",
        stageProgress: 15,
        stageMessage: "正在分析人物性格...",
      },
      jobId,
    );
    await setPersonaProgress(15, "正在分析人物性格...");

    const analyzerPrompt = loadPrompt(characterFamily, "persona_analyzer");
    const analysisResult = await llmService.invoke({
      messages: [
        { role: "system", content: analyzerPrompt },
        {
          role: "user",
          content: `人物名称：${name}\n\n聊天记录/素材：\n${
            chatContent.slice(0, MAX_CHAT_SAMPLE) || "（暂无聊天记录，请基于已有信息谨慎推断）"
          }`,
        },
      ],
      options: { provider: input.provider },
    });

    // ── Stage 2: build ─────────────────────────────────────────────────────
    await setJobStage(
      {
        pipelineStage: "building",
        stageProgress: 45,
        stageMessage: "正在构建人物画像...",
      },
      jobId,
    );
    await setPersonaProgress(45, "正在构建人物画像...");

    const builderPrompt = loadPrompt(characterFamily, "persona_builder");
    const builtPersona = await llmService.invoke({
      messages: [
        { role: "system", content: builderPrompt },
        { role: "user", content: `人物名称：${name}\n\n分析结果：\n${analysisResult}` },
      ],
      options: { provider: input.provider },
    });

    // ── Stage 3: structure into the canonical contract ─────────────────────
    await setJobStage(
      {
        pipelineStage: "merging",
        stageProgress: 70,
        stageMessage: "正在整合结果...",
      },
      jobId,
    );
    await setPersonaProgress(70, "正在整合结果...");

    const structurerPrompt = loadPrompt(characterFamily, "structurer");
    const structuredRaw = await llmService.invoke({
      messages: [
        { role: "system", content: structurerPrompt },
        {
          role: "user",
          content: `人物名称：${name}\n\n行为分析：\n${analysisResult}\n\n人物画像：\n${builtPersona}`,
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
      await db.updateSkillJob(jobId, {
        pipelineStage: "complete",
        stageProgress: 100,
        stageMessage: "完成",
        analysisResult: personaData as any,
      });
    }

    // Optional: generate a reusable skill package (non-blocking).
    try {
      await runPythonTool("skill_writer.py", [
        "--action", "create",
        "--character", characterFamily,
        "--name", name,
      ]);
    } catch (e) {
      console.warn("[SkillEngine] Python skill_writer failed (non-critical):", e);
    }
  } catch (error) {
    console.error("[SkillEngine] Pipeline error:", error);
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
