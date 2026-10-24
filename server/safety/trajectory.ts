/**
 * Emotional-trajectory assessment.
 *
 * The graduation check used to be a fixed threshold: enough chats, enough
 * positive emotions, and a falling message frequency. That misses the thing
 * the product document actually describes — the *shape* of what the user says.
 * Regret ("如果当初…") fading while gratitude ("谢谢你…", "我释然了") rises is
 * the signal that a relationship is reaching a natural end.
 *
 * The classification is done by the model over a window of messages, and the
 * result is stored so the trajectory can be tracked over time.
 */
import { llmService } from "../llm";
import { extractJsonObject } from "../_core/json";
import type { LLMProvider } from "../llm/types";
import * as db from "../db";

export type Trajectory = "improving" | "stable" | "worsening";

export interface TrajectoryAssessment {
  trajectory: Trajectory;
  /** Percentage 0-100 of messages carrying regret language. */
  regretRatio: number;
  /** Percentage 0-100 of messages carrying gratitude language. */
  gratitudeRatio: number;
  /** The model's free-form note. */
  note?: string;
}

const SYSTEM_PROMPT = `你是一个情感状态分析助手。阅读一段用户与 AI 分身的对话，判断用户当前的情绪走向。

判断依据：
- "遗憾"类表达：假设、后悔、弥补、如果当初、可惜、没能、错过了、还在想
- "释然"类表达：谢谢、感谢你、成长、释怀、放下、接受了、挺好的、想通了

只返回 JSON，不要任何其他文字：
{"trajectory":"improving|stable|worsening","regretRatio":0-100,"gratitudeRatio":0-100,"note":"30字以内的观察"}`;

function ratioOf(text: string, patterns: RegExp[]): number {
  if (!text) return 0;
  let hits = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) hits++;
  }
  return Math.round((hits / patterns.length) * 100);
}

const REGRET_PATTERNS = [
  /如果当初/, /要是当时/, /后悔/, /可惜/, /没能/, /错过了/, /还在想/, /弥补/,
];
const GRATITUDE_PATTERNS = [
  /谢谢你/, /感谢/, /成长/, /释怀/, /放下/, /接受了/, /想通了/, /挺好的/,
];

/**
 * Assesses the emotional trajectory over a window of recent messages.
 *
 * Never throws: a failed classification leaves the trajectory unknown rather
 * than interrupting the conversation.
 */
export async function assessTrajectory(params: {
  userId: number;
  personaId: number;
  provider?: string;
  /**
   * The already-resolved provider. Pass it when the caller has one, so the
   * assessment runs on the same credentials as the conversation instead of
   * falling back to the environment key.
   */
  providerInstance?: LLMProvider;
  now?: number;
}): Promise<TrajectoryAssessment | null> {
  const now = params.now ?? Date.now();
  const since = new Date(now);
  since.setDate(since.getDate() - 28);

  const rows = await db.getMessagesSince(params.personaId, params.userId, since);
  const userMessages = rows.filter((m) => m.role === "user").map((m) => m.content);
  if (userMessages.length < 8) return null;

  const transcript = userMessages
    .slice(-120)
    .map((content) => `用户：${content}`)
    .join("\n");

  const localRegret = ratioOf(transcript, REGRET_PATTERNS);
  const localGratitude = ratioOf(transcript, GRATITUDE_PATTERNS);

  let trajectory: Trajectory = "stable";
  let regretRatio = localRegret;
  let gratitudeRatio = localGratitude;
  let note: string | undefined;

  try {
    const request = {
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        { role: "user" as const, content: transcript },
      ],
      options: { provider: params.provider, temperature: 0, maxTokens: 300 },
    };
    const response = params.providerInstance
      ? await llmService.invokeWithProvider(params.providerInstance, request)
      : await llmService.invoke(request);
    const parsed = extractJsonObject(response);
    const parsedTrajectory = parsed?.trajectory;
    if (parsedTrajectory === "improving" || parsedTrajectory === "stable" || parsedTrajectory === "worsening") {
      trajectory = parsedTrajectory;
    }
    if (typeof parsed?.regretRatio === "number") regretRatio = parsed.regretRatio;
    if (typeof parsed?.gratitudeRatio === "number") gratitudeRatio = parsed.gratitudeRatio;
    if (typeof parsed?.note === "string") note = parsed.note.slice(0, 120);
  } catch (e) {
    console.warn("[Safety] Trajectory assessment failed, using keyword ratios:", (e as Error).message);
  }

  await db.createGraduationAssessment({
    userId: params.userId,
    personaId: params.personaId,
    windowStart: since,
    windowEnd: new Date(now),
    trajectory,
    regretRatio,
    gratitudeRatio,
    assessment: note ? { note } : null,
  }).catch((e) => console.warn("[Safety] Failed to store trajectory assessment:", e));

  return { trajectory, regretRatio, gratitudeRatio, note };
}

/**
 * Reads the most recent stored trajectory assessment.
 */
export async function getStoredTrajectory(personaId: number, userId: number) {
  const row = await db.getLatestGraduationAssessment(personaId, userId);
  if (!row) return null;
  return {
    trajectory: row.trajectory as Trajectory,
    regretRatio: row.regretRatio,
    gratitudeRatio: row.gratitudeRatio,
    createdAt: row.createdAt,
  };
}
