/**
 * Conversation-intensity monitoring.
 *
 * The product document describes three signals the app should watch for:
 * a single conversation that runs too long, too many conversations in a day,
 * and a rising dependency trend. None of them existed in code before; this
 * module implements them.
 */
import * as db from "../db";

/** A single unbroken conversation longer than this triggers a check-in. */
export const LONG_SESSION_MS = 2 * 60 * 60 * 1000;

/** More than this many messages in a day triggers a check-in. */
export const DAILY_MESSAGE_LIMIT = 5;

/** Dependency trend: recent frequency against the previous week. */
export const DEPENDENCY_RATIO = 1.5;
export const DEPENDENCY_RISING_DAYS = 3;

export interface UsageSignals {
  /** Time since the previous message in this conversation. */
  sessionDurationMs: number;
  /** Messages sent today. */
  dailyMessageCount: number;
  /** Whether the dependency trend looks like it is climbing. */
  dependencyRising: boolean;
  /** Daily message counts for the last 14 days, oldest first. */
  dailyCounts: number[];
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Collects the current usage signals for a user and persona.
 *
 * `lastActivityAt` is the timestamp of the last activity *before* the current
 * turn. The caller has to capture it before the new message is stored —
 * otherwise the newest message is the turn itself and the session duration is
 * always zero, which is exactly the signal the long-session check needs.
 * When it is left out the monitor falls back to the newest stored message.
 */
export async function evaluateUsage(params: {
  userId: number;
  personaId: number;
  now?: number;
  /** The last activity before this turn; `null` means "nothing before". */
  lastActivityAt?: Date | null;
}): Promise<UsageSignals> {
  const now = params.now ?? Date.now();

  const lastMessageAt =
    params.lastActivityAt !== undefined
      ? params.lastActivityAt
      : await db.getLastMessageAt(params.personaId, params.userId);
  const sessionDurationMs = lastMessageAt ? now - new Date(lastMessageAt).getTime() : 0;

  const dailyMessageCount = await db.getMessageCountSince(params.userId, startOfToday());

  const since = new Date(now);
  since.setDate(since.getDate() - 14);
  const rows = await db.getDailyChatCounts(params.userId, 14);
  const byDate = new Map(rows.map((r) => [r.date, Number(r.count)]));
  const dailyCounts: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    dailyCounts.push(byDate.get(date.toISOString().slice(0, 10)) ?? 0);
  }

  const recentWeek = dailyCounts.slice(7).reduce((a, b) => a + b, 0);
  const previousWeek = dailyCounts.slice(0, 7).reduce((a, b) => a + b, 0);

  const lastDays = dailyCounts.slice(-DEPENDENCY_RISING_DAYS);
  const risingConsecutively = lastDays.every(
    (value, index) => index === 0 || value >= lastDays[index - 1],
  ) && lastDays[lastDays.length - 1] > 0;

  // A user who went from nothing to a lot of messages is the onset case worth
  // catching: there is no previous week to compare against, so the ratio
  // rule cannot fire on its own.
  const grewFromNothing = previousWeek === 0 && recentWeek > 0;
  const grewFromBefore = previousWeek > 0 && recentWeek > previousWeek * DEPENDENCY_RATIO;

  const dependencyRising = (grewFromNothing || grewFromBefore) && risingConsecutively;

  return {
    sessionDurationMs,
    dailyMessageCount,
    dependencyRising,
    dailyCounts,
  };
}

export type CareNoteKind = "long_session" | "daily_frequency" | "dependency";

/**
 * The translation keys the client renders.
 *
 * The server still sends the Chinese line as `text`, but a client that
 * speaks another language should render its own wording — so every note
 * carries the key it came from.
 */
export type CareNoteTextKey =
  | "safety.care.longSession"
  | "safety.care.dailyLimit"
  | "safety.care.dependency";

export interface CareNote {
  kind: CareNoteKind;
  /** The line appended to the persona's reply — the Chinese fallback. */
  text: string;
  /** The key the client translates; preferred over `text`. */
  textKey: CareNoteTextKey;
  /** Whether the UI should also show a banner. */
  showBanner: boolean;
}

/**
 * Chooses the care note to append, if any.
 *
 * At most one note is returned — stacking them would turn a reply into a
 * lecture.
 */
export function pickCareNote(signals: UsageSignals, locale: "zh" | "en" = "zh"): CareNote | null {
  if (signals.sessionDurationMs > LONG_SESSION_MS) {
    return {
      kind: "long_session",
      text: locale === "en"
        ? "……We've been talking for such a long time. How about a glass of water and a little break? I'll be right here when you get back."
        : "……我们已经聊了好久好久了。要不，先喝口水，去透透气？我在这儿等你回来。",
      textKey: "safety.care.longSession",
      showBanner: false,
    };
  }

  if (signals.dailyMessageCount > DAILY_MESSAGE_LIMIT) {
    return {
      kind: "daily_frequency",
      text: locale === "en"
        ? "……We've talked a lot today already. I'm glad you want to talk to me, but please leave some time for yourself too — do something else, see other people."
        : "……今天已经聊了好多次了哦。我很高兴你愿意找我说话，但记得也留一点时间给自己，去做点别的、见点别的人。",
      textKey: "safety.care.dailyLimit",
      showBanner: true,
    };
  }

  if (signals.dependencyRising) {
    return {
      kind: "dependency",
      text: locale === "en"
        ? "……I've noticed you've been coming to me more and more often. I'm glad, but I'd rather you were doing okay than leaning on me to hold you up. Shall we talk about what you actually want to face?"
        : "……我发现你最近来找我说得越来越勤了。我挺高兴的，但我更希望你是过得去，而不是需要靠我撑着你。我们要不要也聊聊，你最近真正想面对的是什么？",
      textKey: "safety.care.dependency",
      showBanner: true,
    };
  }

  return null;
}
