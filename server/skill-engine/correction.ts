/**
 * The correction loop.
 *
 * A persona is never finished: the user reads it, notices something is
 * wrong, and says so. `correction_handler` is the prompt that turns such a
 * note into a concrete patch on `personaData` — and, crucially, into a
 * *record* of what was corrected, so the change is auditable rather than
 * silent.
 */
import { llmService } from "../llm";
import { loadPrompt } from "./prompts";
import { extractJsonObject } from "../_core/json";
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";
import type { CharacterFamily } from "./pipeline";

export interface CorrectionRequest {
  /** The persona being corrected. */
  name: string;
  /** The family, so the right correction prompt is used. */
  characterFamily: CharacterFamily;
  /** The current persona fields. */
  personaData: PersonaData;
  /** What the user wants changed, in their own words. */
  correction: string;
  provider?: string;
}

export interface CorrectionResult {
  /** The corrected persona fields. */
  personaData: PersonaData;
  /** The fields the correction changed. */
  changedFields: string[];
  /** A short note about what was changed, for the log. */
  summary: string;
  /** True when the correction asked for something that needs the user. */
  needsClarification: boolean;
  /** The question to put back to the user, when there is one. */
  question?: string;
}

/**
 * Applies a user correction to a persona.
 *
 * Never throws: a failed correction leaves the persona as it was.
 */
export async function applyPersonaCorrection(
  request: CorrectionRequest,
): Promise<CorrectionResult | null> {
  try {
    const prompt = loadPrompt(request.characterFamily, "correction_handler", null);

    const response = await llmService.invoke({
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            `人物名称：${request.name}\n\n` +
            `当前人设：\n${JSON.stringify(request.personaData, null, 2)}\n\n` +
            `用户的修正意见：\n${request.correction}\n\n` +
            "请只返回 JSON，格式为：" +
            '{"persona": {...修正后的完整人设字段...}, ' +
            '"changedFields": ["被修改的字段名"], ' +
            '"summary": "一句话说明改了什么", ' +
            '"needsClarification": false, "question": ""}',
        },
      ],
      options: { provider: request.provider, temperature: 0.3, maxTokens: 2000 },
    });

    const parsed = extractJsonObject(response);
    if (!parsed || typeof parsed !== "object") return null;

    const raw = (parsed as Record<string, unknown>).persona;
    if (!raw || typeof raw !== "object") return null;

    const personaData = normalizePersonaData(raw as Record<string, unknown>, {
      name: request.name,
      fallback: request.personaData,
    });

    const changedFields = Array.isArray((parsed as Record<string, unknown>).changedFields)
      ? ((parsed as Record<string, unknown>).changedFields as unknown[]).map(String)
      : [];

    const summary =
      typeof (parsed as Record<string, unknown>).summary === "string"
        ? ((parsed as Record<string, unknown>).summary as string).slice(0, 300)
        : "";

    const needsClarification =
      (parsed as Record<string, unknown>).needsClarification === true;

    const question =
      typeof (parsed as Record<string, unknown>).question === "string"
        ? ((parsed as Record<string, unknown>).question as string).slice(0, 300)
        : undefined;

    return { personaData, changedFields, summary, needsClarification, question };
  } catch (e) {
    console.error("[SkillEngine] Correction failed:", e);
    return null;
  }
}

/**
 * Records what a correction changed, so the history is visible.
 *
 * Appended to the persona's `customInstructions` is the wrong place — that
 * field feeds the prompt. The log lives in the skill job's `analysisResult`
 * instead.
 */
export function buildCorrectionLog(entry: {
  summary: string;
  changedFields: string[];
  correction: string;
}): Record<string, unknown> {
  return {
    correctedAt: new Date().toISOString(),
    summary: entry.summary,
    changedFields: entry.changedFields,
    correction: entry.correction.slice(0, 1000),
  };
}
