import { llmService } from "../llm";
import { loadPrompt } from "./prompts";
import { runPythonTool } from "./runner";
import * as db from "../db";

export type PipelineInput = {
  personaId: number;
  userId: number;
  characterFamily: "colleague" | "relationship" | "celebrity";
  name: string;
  chatContent: string;
  intakeMeta?: Record<string, unknown>;
};

export async function runSkillPipeline(input: PipelineInput): Promise<void> {
  const { personaId, userId, characterFamily, name, chatContent } = input;

  const jobId = await db.createSkillJob({
    personaId,
    userId,
    characterFamily,
    pipelineStage: "intake",
    inputMeta: input.intakeMeta ?? null,
  });

  try {
    // Stage 1: Persona analysis
    await db.updateSkillJob(jobId, {
      pipelineStage: "analyzing_persona",
      stageProgress: 20,
      stageMessage: "正在分析人物性格...",
    });

    const analyzerPrompt = loadPrompt(characterFamily, "persona_analyzer");
    const analysisResult = await llmService.invoke({
      messages: [
        { role: "system", content: analyzerPrompt },
        { role: "user", content: `人物名称：${name}\n\n聊天记录/素材：\n${chatContent.slice(0, 10000)}` },
      ],
    });

    // Stage 2: Build persona
    await db.updateSkillJob(jobId, {
      pipelineStage: "building",
      stageProgress: 50,
      stageMessage: "正在构建人物画像...",
    });

    const builderPrompt = loadPrompt(characterFamily, "persona_builder");
    const personaResult = await llmService.invoke({
      messages: [
        { role: "system", content: builderPrompt },
        { role: "user", content: `人物名称：${name}\n\n分析结果：\n${analysisResult}` },
      ],
    });

    // Stage 3: Parse and store
    await db.updateSkillJob(jobId, {
      pipelineStage: "merging",
      stageProgress: 80,
      stageMessage: "正在整合结果...",
    });

    let personaData: Record<string, unknown> = {};
    try {
      const jsonMatch = personaResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) personaData = JSON.parse(jsonMatch[0]);
    } catch {
      personaData = {
        personality: analysisResult.slice(0, 500),
        speakingStyle: "自然对话风格",
        catchphrases: [],
        nickname: "宝贝",
        memories: "",
        summary: personaResult.slice(0, 300),
      };
    }

    await db.updatePersona(personaId, userId, {
      personaData,
      analysisStatus: "ready",
      analysisProgress: 100,
      analysisMessage: `${name} 的数字分身已准备好`,
      skillJobId: jobId,
    });

    await db.updateSkillJob(jobId, {
      pipelineStage: "complete",
      stageProgress: 100,
      stageMessage: "完成",
      analysisResult: personaData as any,
    });

    // Try to run Python skill writer (optional, non-blocking)
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
    await db.updateSkillJob(jobId, {
      pipelineStage: "error",
      stageMessage: `Pipeline failed: ${error}`,
    });
    await db.updatePersona(personaId, userId, {
      analysisStatus: "error",
      analysisMessage: "性格蒸馏失败，请重试",
    });
  }
}
