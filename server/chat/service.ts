/**
 * The conversation pipeline.
 *
 * Before this existed, the same sequence — assemble the prompt, call the
 * model, store the reply, work out the emotional state, update intimacy, look
 * for a graduation moment — was written out four times: once per tRPC
 * procedure and once for the WeChat channel. Any change to it had to be
 * applied four times, and the streaming path would have made it five.
 *
 * Everything now goes through this module. The tRPC mutations, the SSE route
 * and the channel bridge all call the same functions.
 */
import type { LLMMessage, LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt, computeIntimacy } from "../_core/persona-utils";
import { inferEmotionalState } from "../_core/emotion";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { buildCrisisResponse, buildGentleCheckIn, detectCrisis } from "../safety/crisis";
import { evaluateUsage, pickCareNote, type CareNote } from "../safety/usage-monitor";
import { assessTrajectory, getStoredTrajectory } from "../safety/trajectory";
import { checkGraduationEligibility } from "../_core/persona-utils";

export type ChatMode = "stream" | "once";

/** A summary is written at most this often, and only after this many messages. */
const SUMMARY_MIN_NEW_MESSAGES = 10;

/** A summary older than this is refreshed, whatever the message count says. */
const SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The emotional trajectory is assessed at most once a day per persona. */
const TRAJECTORY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "emotion"; state: string; reason?: string }
  | {
      type: "done";
      messageId: number;
      emotionalState: string;
      graduationSuggested: boolean;
      careNote: CareNote | null;
      crisis: boolean;
    }
  | { type: "error"; message: string; partial: boolean };

export interface ConversationOptions {
  persona: Persona;
  userId: number;
  /** The user's message. */
  message: string;
  /** Explicit provider override (from `persona.llmProvider`). */
  providerName?: string;
  /** Channel the message arrived on. */
  channel?: "web" | "wechat" | "feishu";
  /** Whether the user message has already been stored. */
  alreadyPersisted?: boolean;
  /** Media attached to the message. */
  media?: { url: string; type: "image" | "voice"; mimeType?: string };
  /** Locale for prompt language and trigger words. */
  locale?: "zh" | "en";
  /** Cancels the model call when the client goes away. */
  signal?: AbortSignal;
  now?: Date;
}

/**
 * Summarises the conversation history that no longer fits in the window.
 *
 * Failing here is not fatal: the old behaviour (drop the old turns) still
 * applies, so a summarisation failure only costs some context.
 *
 * The summarisation is throttled: a persona is summarised again only after
 * at least ten new messages have arrived, or after a day has passed. Without
 * the throttle every turn past the window would pay for a fresh model call.
 */
async function maybeCompactHistory(params: {
  persona: Persona;
  userId: number;
  history: Array<{ id: number; role: string; content: string; createdAt: Date }>;
  keepCount: number;
  providerName?: string;
  now: Date;
}): Promise<string> {
  const evicted = params.history.slice(0, Math.max(0, params.history.length - params.keepCount));
  if (evicted.length < 10) return "";

  const latest = await db.getLatestChatSummary(params.persona.id, params.userId);
  if (latest) {
    const age = params.now.getTime() - new Date(latest.createdAt).getTime();
    // The stored summary knows which message it covered, so the number of
    // messages that arrived since then is simply the ones after it.
    const sinceLastSummary = params.history.filter(
      (m) => m.id > (latest.toMessageId ?? 0),
    ).length;
    if (age < SUMMARY_MAX_AGE_MS && sinceLastSummary < SUMMARY_MIN_NEW_MESSAGES) {
      // Summarised recently — do not pay for another LLM call.
      return latest.summary;
    }
  }

  const transcript = evicted
    .map((m) => `${m.role === "user" ? "用户" : "分身"}：${m.content}`)
    .join("\n");

  try {
    const provider = await resolveProviderForUser({
      userId: params.userId,
      providerName: params.providerName,
    });
    const summary = await llmService.invokeWithProvider(provider!, {
      messages: [
        {
          role: "system",
          content:
            "你是一个对话记录整理助手。把下面的聊天记录压缩成不超过 300 字的中文摘要，保留关键事件、约定、称呼和情感转折，不要评论，只输出摘要本身。",
        },
        { role: "user", content: transcript },
      ],
      options: { provider: params.providerName, temperature: 0.2, maxTokens: 500 },
    });

    const trimmed = (summary || "").trim();
    if (!trimmed) return "";

    await db.createChatSummary({
      personaId: params.persona.id,
      userId: params.userId,
      summary: trimmed,
      fromMessageId: evicted[0]?.id ?? null,
      toMessageId: evicted[evicted.length - 1]?.id ?? null,
    });

    return trimmed;
  } catch (e) {
    console.warn("[Chat] History summarisation failed, continuing without it:", (e as Error).message);
    return "";
  }
}

/**
 * Maps a stored message to the shape the providers consume.
 *
 * An image keeps its media URL: the model has to see the picture, not the
 * "[图片]" placeholder. Everything else stays a plain string.
 */
function toLLMMessage(message: {
  role: string;
  content: string;
  messageType?: string | null;
  mediaUrl?: string | null;
}): LLMMessage {
  const role = message.role as "user" | "assistant";
  if (message.messageType === "image" && message.mediaUrl) {
    return {
      role,
      content: [
        { type: "text", text: message.content },
        { type: "image_url", url: message.mediaUrl },
      ],
    };
  }
  return { role, content: message.content };
}

/**
 * Builds the message list sent to the model.
 */
export async function composeMessages(params: {
  persona: Persona;
  userId: number;
  userMessage: string;
  contextLimit: number;
  providerName?: string;
  locale?: "zh" | "en";
  now?: Date;
  extraConfig?: Record<string, any>;
}): Promise<LLMMessage[]> {
  const now = params.now ?? new Date();
  const contextLimit = Math.max(4, params.contextLimit);
  const history = await db.getMessagesByPersonaId(params.persona.id, params.userId, 200);

  const scene = params.persona.activeSceneId
    ? await db.getSceneById(params.persona.activeSceneId, params.userId)
    : null;

  const retrieved = await retrieveMemories({
    personaId: params.persona.id,
    userId: params.userId,
    userMessage: params.userMessage,
    topK: params.extraConfig?.retrievalK,
    now: now.getTime(),
  });
  const anchors = retrieved.filter((m) => m.category === "anchor");
  const ordinary = retrieved.filter((m) => m.category !== "anchor");

  const summarySection = await maybeCompactHistory({
    persona: params.persona,
    userId: params.userId,
    history: history as any,
    keepCount: contextLimit - 1,
    providerName: params.providerName,
    now,
  });

  const systemPrompt = buildSystemPrompt(params.persona, {
    sceneOverlay: scene?.systemPromptOverlay ?? null,
    memorySection: formatMemoriesForPrompt(ordinary),
    anchorSection: formatAnchorsForPrompt(anchors),
    summarySection: summarySection ? `【以往对话摘要】\n${summarySection}` : "",
    realismLevel: params.extraConfig?.realismLevel,
    locale: params.locale,
    now,
  });

  const recent = history.slice(-(contextLimit - 1)).map((m) => toLLMMessage(m));

  return [{ role: "system", content: systemPrompt }, ...recent];
}

/**
 * Runs the full conversation pipeline.
 *
 * Yields `ChatEvent`s. In `"once"` mode exactly one `done` event is produced
 * (plus optional `emotion`); in `"stream"` mode the reply text is emitted as
 * `delta` events as it arrives.
 */
export async function* runConversation(
  options: ConversationOptions & { mode: ChatMode },
): AsyncGenerator<ChatEvent> {
  const { persona, userId, message } = options;
  const now = options.now ?? new Date();
  const locale = options.locale ?? "zh";

  const defaultConfig = await db.getDefaultLlmConfig(userId);
  const extraConfig = (defaultConfig?.extraConfig as any) ?? {};
  const contextLimit = extraConfig.contextLimit || 20;

  // The last activity has to be read *before* this turn is stored: afterwards
  // the newest message is the turn itself and the session duration is always
  // zero, which would make the long-conversation signal impossible to fire.
  const lastActivityAt = (await db.getLastMessageAt(persona.id, userId)) ?? null;

  // The user's turn is stored first so the history and any summarisation see it.
  if (!options.alreadyPersisted) {
    await db.createMessage({
      personaId: persona.id,
      userId,
      role: "user",
      content: message,
      emotionalState: persona.emotionalState,
      channel: options.channel ?? "web",
      messageType: options.media?.type ?? "text",
      mediaUrl: options.media?.url ?? null,
    });
  }

  // Crisis handling short-circuits the model entirely.
  const crisis = detectCrisis(message);
  if (crisis.crisis) {
    const replyText = buildCrisisResponse(persona.name, locale);
    const messageId = await db.createMessage({
      personaId: persona.id,
      userId,
      role: "assistant",
      content: replyText,
      emotionalState: persona.emotionalState,
      channel: options.channel ?? "web",
    });
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: "crisis",
      severity: "critical",
      excerpt: crisis.matched.join(", "),
    }).catch((e) => console.warn("[Safety] Failed to record crisis event:", e));

    yield { type: "delta", text: replyText };
    yield {
      type: "done",
      messageId,
      emotionalState: persona.emotionalState,
      graduationSuggested: false,
      careNote: null,
      crisis: true,
    };
    return;
  }

  // A weak signal is ordinary distress, not a crisis: the persona still
  // answers normally and checks in afterwards.
  const gentleCheckIn = crisis.weakSignal ? buildGentleCheckIn(persona.name, locale) : null;

  const llmMessages = await composeMessages({
    persona,
    userId,
    userMessage: message,
    contextLimit,
    providerName: options.providerName,
    locale,
    now,
    extraConfig,
  });

  const provider = await resolveProviderForUser({
    userId,
    providerName: options.providerName,
  });
  if (!provider) {
    throw new Error(
      `No LLM provider available${options.providerName ? ` (requested: ${options.providerName})` : ""}. Configure at least one provider in .env`,
    );
  }

  let replyText = "";
  let failed = false;
  let failureMessage = "";

  try {
    if (options.mode === "stream" && provider.stream && provider.capabilities.streaming) {
      for await (const chunk of llmService.streamWithProvider(provider, {
        messages: llmMessages,
        options: {
          provider: options.providerName,
          temperature: extraConfig.temperature,
          maxTokens: extraConfig.maxTokens,
          signal: options.signal,
        },
      })) {
        replyText += chunk.text;
        yield { type: "delta", text: chunk.text };
      }
    } else {
      replyText = await llmService.invokeWithProvider(provider, {
        messages: llmMessages,
        options: {
          provider: options.providerName,
          temperature: extraConfig.temperature,
          maxTokens: extraConfig.maxTokens,
          signal: options.signal,
        },
      });
      replyText = replyText || "（沉默）";
      yield { type: "delta", text: replyText };
    }
  } catch (e) {
    failed = true;
    failureMessage = (e as Error).message;
    console.error("[Chat] LLM call failed:", e);
    yield { type: "error", message: failureMessage, partial: replyText.length > 0 };
  }

  // The care note is decided before the reply is stored, so it can be part
  // of what the persona actually says — the plan asks for the persona itself
  // to say the caring words, not for a separate system notice.
  const signals = await evaluateUsage({
    userId,
    personaId: persona.id,
    now: now.getTime(),
    lastActivityAt,
  });
  const careNote = pickCareNote(signals, locale);
  if (careNote) {
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: careNote.kind === "dependency" ? "dependency" : "usage",
      severity: careNote.showBanner ? "warning" : "info",
    }).catch((e) => console.warn("[Safety] Failed to record usage event:", e));
  }

  // Even a partial answer is kept — half a sentence is still worth more than
  // nothing when the user is waiting.
  const baseText = replyText || "（沉默）";
  const appended = [gentleCheckIn, careNote?.text].filter((part): part is string => !!part);
  const finalText = appended.length > 0 ? `${baseText}\n\n${appended.join("\n\n")}` : baseText;

  const messageId = await db.createMessage({
    personaId: persona.id,
    userId,
    role: "assistant",
    content: finalText,
    emotionalState: persona.emotionalState,
    channel: options.channel ?? "web",
  });

  const emotion = await inferEmotionalState({
    userMessage: message,
    assistantReply: finalText,
    currentState: persona.emotionalState,
    provider: options.providerName,
    // The classifier has to run on the same credentials as the reply —
    // otherwise a user who configured their own key silently falls back to
    // the environment one.
    providerInstance: provider,
    locale,
  });
  const newEmotionalState = emotion.state;
  yield { type: "emotion", state: newEmotionalState, reason: emotion.reason };

  await db.updatePersona(persona.id, userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newEmotionalState as any,
  });

  const todayStr = now.toISOString().slice(0, 10);
  const existing = await db.getTodaySnapshot(persona.id, userId);
  if (!existing) {
    await db.createEmotionSnapshot({
      personaId: persona.id,
      userId,
      emotionalState: newEmotionalState,
      messageCount: 1,
      date: todayStr,
    });
  }

  const intimacyData = await db.getIntimacyData(persona.id, userId);
  const intimacy = computeIntimacy(intimacyData);
  await db.updateIntimacy(persona.id, userId, intimacy.score, intimacy.level);

  // The trajectory has to be assessed before the graduation check, which
  // reads the stored assessment — otherwise the early-graduation branch never
  // sees a trajectory at all.
  await maybeAssessTrajectory({
    personaId: persona.id,
    userId,
    providerName: options.providerName,
    providerInstance: provider,
    now,
  });

  const graduationSuggested = await evaluateGraduation({
    persona,
    userId,
    intimacyLevel: intimacy.level,
    chatCount: (persona.chatCount || 0) + 1,
  });

  // The streaming path already emitted the reply text; the check-in and the
  // care note have to be pushed as well so the user sees the same thing
  // either way.
  if (gentleCheckIn) {
    yield { type: "delta", text: `\n\n${gentleCheckIn}` };
  }
  if (careNote) {
    yield { type: "delta", text: `\n\n${careNote.text}` };
  }

  yield {
    type: "done",
    messageId,
    emotionalState: newEmotionalState,
    graduationSuggested,
    careNote,
    crisis: false,
  };
}

/**
 * Assesses the emotional trajectory, at most once a day per persona.
 *
 * The assessment is a model call over a month of messages, so running it on
 * every turn would be expensive; the stored assessment says whether it is
 * time again. A failure is never fatal — the turn goes on without a fresh
 * trajectory.
 */
async function maybeAssessTrajectory(params: {
  personaId: number;
  userId: number;
  providerName?: string;
  providerInstance?: LLMProvider;
  now: Date;
}): Promise<void> {
  try {
    const latest = await db.getLatestGraduationAssessment(params.personaId, params.userId);
    if (latest) {
      const age = params.now.getTime() - new Date(latest.createdAt).getTime();
      if (age < TRAJECTORY_INTERVAL_MS) return;
    }

    await assessTrajectory({
      userId: params.userId,
      personaId: params.personaId,
      provider: params.providerName,
      providerInstance: params.providerInstance,
      now: params.now.getTime(),
    });
  } catch (e) {
    console.warn("[Safety] Trajectory assessment failed:", (e as Error).message);
  }
}

/**
 * Decides whether to suggest graduation.
 *
 * The hard thresholds decide; the emotional trajectory can make the app
 * mention it earlier, as a gentle nudge rather than a decision.
 */
async function evaluateGraduation(params: {
  persona: Persona;
  userId: number;
  intimacyLevel: string;
  chatCount: number;
}): Promise<boolean> {
  const { persona, userId } = params;
  if (persona.graduationStatus) return false;

  const recentEmotions = await db.getRecentEmotionTrend(persona.id, userId, 14);
  const recentFreq = await db.getMessageCountInRange(persona.id, userId, 7, 0);
  const prevFreq = await db.getMessageCountInRange(persona.id, userId, 14, 7);

  const eligibility = checkGraduationEligibility({
    intimacyLevel: params.intimacyLevel,
    recentEmotions,
    chatCount: params.chatCount,
    recentChatFrequency: recentFreq,
    previousChatFrequency: prevFreq,
  });

  if (eligibility.eligible) {
    await db.setGraduationStatus(persona.id, userId, "suggested");
    return true;
  }

  // A clearly improving trajectory is worth surfacing even below the hard
  // thresholds.
  const trajectory = await getStoredTrajectory(persona.id, userId);
  if (trajectory?.trajectory === "improving" && params.chatCount >= 20) {
    await db.createSafetyEvent({
      userId,
      personaId: persona.id,
      type: "graduation_trajectory",
      severity: "info",
    }).catch(() => undefined);
    return true;
  }

  return false;
}
