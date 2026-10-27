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
import { copy } from "@shared/copy";
import { asMaterial } from "../_core/material";

export type Trajectory = "improving" | "stable" | "worsening";

/**
 * A percentage, in the range a percentage is in.
 *
 * A fraction (0.4) is read as forty per cent — the panel says what
 * the number is — and anything outside the range is brought back
 * inside it.
 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

export interface TrajectoryAssessment {
  trajectory: Trajectory;
  /** Percentage 0-100 of messages carrying regret language. */
  regretRatio: number;
  /** Percentage 0-100 of messages carrying gratitude language. */
  gratitudeRatio: number;
  /** The model's free-form note. */
  note?: string;
}

/**
 * The percentage of messages that carry the language.
 *
 * It used to count the *patterns* that appeared anywhere in the
 * transcript — so one message saying "如果当初" and one saying "谢谢
 * 你" gave the same number as a hundred messages of each. And the
 * numbers are shown to the user as "percentage of messages carrying
 * regret language".
 *
 * So the count is over the messages.
 */
function ratioOf(messages: string[], patterns: RegExp[]): number {
  if (messages.length === 0) return 0;
  let hits = 0;
  for (const message of messages) {
    if (patterns.some((pattern) => pattern.test(message))) hits++;
  }
  return Math.round((hits / messages.length) * 100);
}

/**
 * How many of the user's turns the assessment reads.
 *
 * The model is shown the most recent ones, and the keyword ratios —
 * the ones shown when the model cannot be reached — are counted over
 * the same turns, so the number on the panel describes the same
 * conversation the model was asked about.
 */
const TRANSCRIPT_MESSAGES = 120;

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
  /** The language the assessment is written in. */
  locale?: "zh" | "en";
  now?: number;
}): Promise<TrajectoryAssessment | null> {
  const now = params.now ?? Date.now();
  const locale = params.locale ?? "zh";
  const since = new Date(now);
  since.setDate(since.getDate() - 28);

  /**
   * The window is read bounded.
   *
   * It used to be read whole: twenty-eight days of the user's private
   * conversation — every turn, the persona's answers included — was
   * pulled into the heap, and then all but the last hundred and twenty
   * of the user's turns were thrown away.
   *
   * So the read asks the database for the newest messages and for the
   * user's own turns only, and the rows that are not needed never
   * leave the database.
   */
  const rows = await db.getRecentMessages(
    params.personaId,
    params.userId,
    since,
    TRANSCRIPT_MESSAGES,
    "user",
  );
  const userMessages = rows.map((m) => m.content);
  if (userMessages.length < 8) return null;

  /**
   * The transcript is fenced.
   *
   * It is the user's own messages, verbatim, and a message can contain
   * newlines — so a line in it could forge a transcript line, or an
   * instruction, and the verdict about the user's own state (improving,
   * stable, worsening) and the regret and gratitude ratios in the
   * safety panel are computed from it.
   *
   * The same value is fenced everywhere else in the app: the memories,
   * the anchors, the summaries, the quoted letter.
   */
  const transcript = asMaterial(
    userMessages
      .map((content) => copy(locale, "prompts.trajectoryTranscriptLine", { content }))
      .join("\n"),
    locale,
  );

  const localRegret = ratioOf(userMessages, REGRET_PATTERNS);
  const localGratitude = ratioOf(userMessages, GRATITUDE_PATTERNS);

  let trajectory: Trajectory = "stable";
  let regretRatio = clampPercent(localRegret);
  let gratitudeRatio = clampPercent(localGratitude);
  let note: string | undefined;

  try {
    const request = {
      messages: [
        { role: "system" as const, content: copy(locale, "prompts.trajectoryAnalysis") },
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
    /**
     * The ratios are percentages.
     *
     * They come from the model, and the model sometimes answers with
     * a fraction, or with a number that is not a percentage at all —
     * so the panel showed "1400%" and "0.4%". The panel says what
     * they are, so they have to be in the range they say.
     */
    regretRatio = clampPercent(regretRatio);
    gratitudeRatio = clampPercent(gratitudeRatio);
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
