/**
 * The held-out cases.
 *
 * A persona is rebuilt from a conversation, and then the conversation is
 * handed to the rebuilt persona — but the answer was in there the whole
 * time, so the question was never really asked. The rebuild would sound
 * exactly like the original and the measurement would mean nothing.
 *
 * So one of their lines is taken away. The persona has to produce it
 * again, from the conversation that came before it, and the result is
 * compared with the line that was actually said.
 *
 * The cases are cut from the *collected* records — the imported chat
 * logs — rather than from the app's own conversation, because the app's
 * conversation was already written by the persona and would measure
 * nothing.
 */
import { matchEmotionTrigger, type EmotionTriggerState } from "@shared/emotion-triggers";

/** A message as the records store it. */
export interface EvalSourceMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  timestamp: Date | null;
}

/** One held-out exchange. */
export interface EvalCaseData {
  context: EvalSourceMessage[];
  expected: EvalSourceMessage;
  /** The emotion the real line carried, read from the trigger words. */
  expectedState: EmotionTriggerState | null;
}

export interface EvalCaseOptions {
  /** How many messages of context the persona is given. */
  contextSize?: number;
  /** The most cases to keep. */
  maxCases?: number;
  /** Lines shorter than this are not worth holding out. */
  minExpectedChars?: number;
  /**
   * How much of the record may be held out.
   *
   * The n-gram model is fitted on the lines that were *not* held out, so
   * holding out too much leaves it with nothing to learn from — and a
   * model fitted on one line rates every other line as unlikely,
   * including the real one. So at most a quarter of their lines are
   * held out.
   */
  maxHoldoutFraction?: number;
  /**
   * How long a silence has to be before it counts as a different scene.
   *
   * A case whose context runs across a night is a case whose context is
   * half of one conversation and half of another, and the persona is
   * being asked to answer a prompt that never happened.
   */
  sceneBreakHours?: number;
  /**
   * The language the records are written in.
   *
   * The emotion is read off the words, so it is read in the language the
   * words are in. Without this, an English persona's held-out lines
   * carried no state at all — and every per-state bucket was empty.
   */
  locale?: "zh" | "en";
}

/**
 * The lines before one message, stopping at a scene break.
 *
 * A window that runs across a long silence joins two conversations that
 * were not having one, and the persona is asked to answer a prompt that
 * never happened. So the window is cut where the silence is long enough
 * to be a different scene.
 */
function contextBefore(
  messages: EvalSourceMessage[],
  index: number,
  contextSize: number,
  sceneBreakMs: number,
): EvalSourceMessage[] {
  const start = Math.max(0, index - contextSize);
  const window = messages.slice(start, index);
  if (!window.length || !sceneBreakMs) return window;

  // Walk backwards while the messages are close enough in time.
  let cut = 0;
  for (let i = window.length - 1; i > 0; i--) {
    const later = window[i].timestamp;
    const earlier = window[i - 1].timestamp;
    if (!later || !earlier) continue;
    if (later.getTime() - earlier.getTime() > sceneBreakMs) {
      cut = i;
      break;
    }
  }
  return cut ? window.slice(cut) : window;
}

/**
 * Cuts the cases out of a conversation.
 *
 * The cases are spread across the conversation rather than taken from
 * the front. A conversation has a shape — the early messages are
 * tentative, the middle ones are the ordinary middle, the last ones are
 * the goodbyes — and a set of cases drawn from only one part of it
 * measures that part and nothing else.
 */
export function buildEvalCases(
  messages: EvalSourceMessage[],
  options: EvalCaseOptions = {},
): EvalCaseData[] {
  const contextSize = Math.max(1, options.contextSize ?? 6);
  const minExpectedChars = Math.max(1, options.minExpectedChars ?? 2);
  const locale = options.locale ?? "zh";
  const sceneBreakMs = (options.sceneBreakHours ?? 6) * 3_600_000;

  const assistantCount = messages.filter((m) => m.role === "assistant").length;
  // A conversation with a single one of their lines leaves nothing to
  // measure against and nothing to learn the person's habits from.
  if (assistantCount < 2) return [];

  // At least one of their lines has to stay behind. The n-gram model is
  // fitted on the rest, and a model fitted on nothing would rate every
  // line as unlikely — including the real one.
  // At most a quarter of their lines are held out, so the n-gram model
  // always has the rest to learn from. At least one of their lines
  // always stays behind, for the same reason.
  const fraction = options.maxHoldoutFraction ?? 0.25;
  const holdoutCeiling = Math.max(
    1,
    Math.floor(assistantCount * Math.max(0, Math.min(1, fraction))),
  );
  const maxCases = Math.min(
    Math.max(1, options.maxCases ?? 12),
    holdoutCeiling,
    assistantCount - 1,
  );

  const candidates: EvalCaseData[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (!message.content || message.content.trim().length < minExpectedChars) continue;

    // The context is cut at a scene break: a stretch of silence long
    // enough that the two halves are no longer the same conversation.
    const window = contextBefore(messages, i, contextSize, sceneBreakMs);
    // A context with no user message in it is not a conversation the
    // persona can answer; holding out the reply would only measure how
    // well it continues a monologue.
    if (!window.some((m) => m.role === "user")) continue;

    candidates.push({
      context: window,
      expected: message,
      expectedState: matchEmotionTrigger(message.content, locale),
    });
  }

  if (candidates.length <= maxCases) return candidates;

  // Spread the picks evenly, so the cases cover the whole conversation —
  // including its end, which the old stride never reached.
  const picked: EvalCaseData[] = [];
  if (maxCases === 1) {
    // One case is the middle of the conversation, which is the most
    // representative line there is. The first line is usually a
    // greeting, and it says nothing about how the person talks.
    picked.push(candidates[Math.floor((candidates.length - 1) / 2)]);
    return picked;
  }
  for (let i = 0; i < maxCases; i++) {
    picked.push(candidates[Math.round((i * (candidates.length - 1)) / (maxCases - 1))]);
  }
  return picked;
}

/**
 * The cases that are already stored, read back.
 *
 * The stored cases are the *标答* — the held-out lines the persona has to
 * produce. A run that cut a fresh set every time would measure a
 * different question each time, and the comparison with the last run
 * would be between two different things.
 *
 * So the stored ones are what gets measured. They are read defensively:
 * they were written by an earlier version of this code, and a row that
 * cannot be read is a row that is skipped rather than a crash.
 */
export function casesFromRows(
  rows: Array<{ contextJson: unknown; expectedJson: unknown; expectedState?: string | null }>,
): EvalCaseData[] {
  const out: EvalCaseData[] = [];
  for (const row of rows) {
    const expected = toMessage(row.expectedJson);
    if (!expected) continue;
    const context = Array.isArray(row.contextJson)
      ? row.contextJson.map(toMessage).filter((m): m is EvalSourceMessage => m !== null)
      : [];
    if (!context.length) continue;
    out.push({
      context,
      expected,
      expectedState: (row.expectedState as EmotionTriggerState | null) ?? null,
    });
  }
  return out;
}

/** One stored message, read back. */
function toMessage(value: unknown): EvalSourceMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : "";
  if (!content) return null;
  const role = record.role === "assistant" ? "assistant" : "user";
  const timestamp =
    record.timestamp instanceof Date
      ? record.timestamp
      : typeof record.timestamp === "string"
        ? new Date(record.timestamp)
        : null;
  return {
    id: typeof record.id === "number" ? record.id : undefined,
    role,
    content,
    timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
  };
}

/**
 * The texts the n-gram model is fitted on.
 *
 * Every message *except* the held-out ones. A model that had seen the
 * answer would rate it as likely and rate anything else as unlikely,
 * and the measurement would be measuring the model, not the persona.
 */
export function trainingTexts(
  messages: EvalSourceMessage[],
  cases: EvalCaseData[],
): string[] {
  const heldOut = new Set(cases.map((c) => c.expected.content));
  return messages
    .filter((m) => m.role === "assistant" && !heldOut.has(m.content))
    .map((m) => m.content)
    .filter((text) => text.trim().length > 0);
}

/**
 * A short description of a case, for a human reading the report.
 */
export function describeCase(caseData: EvalCaseData): string {
  const last = caseData.context[caseData.context.length - 1];
  const from = last ? last.content.slice(0, 40) : "";
  return `…${from} → ${caseData.expected.content.slice(0, 40)}`;
}
