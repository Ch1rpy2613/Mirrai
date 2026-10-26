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
import { computeIntimacy, getEmotionalStateDesc } from "../_core/persona-utils";
import { inferEmotionalState, isEmotionalState } from "../_core/emotion";
import { retrieveMemories } from "./retrieval";
import { buildCrisisResponse, buildGentleCheckIn, detectCrisis } from "../safety/crisis";
import { evaluateUsage, pickCareNote, type CareNote } from "../safety/usage-monitor";
import { assessTrajectory, getStoredTrajectory } from "../safety/trajectory";
import { checkGraduationEligibility } from "../_core/persona-utils";
import { getEffectiveGraduationMode, canOfferGraduation, getEffectivePresence } from "../_core/graduation";
import { mayReachOut } from "@shared/graduation-mode";
import { copy, localizeScene } from "@shared/copy";
import { buildPromptForPersona } from "./prompt";
import { dayShiftMinutes, localDateKey, zonedDateKey } from "@shared/timezone";
import { extractMemories, isExtractionDue } from "./memory-extract";
import { storageToDataUrl } from "../storage";

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
      /** The memories that were injected into this turn. */
      recalled?: Array<{ id: number; title: string; subject: string }>;
      emotionalState: string;
      graduationSuggested: boolean;
      careNote: CareNote | null;
      crisis: boolean;
    }
  | { type: "error"; message: string; partial: boolean };

/**
 * The persona has said goodbye and is asleep.
 *
 * It is a notice and not a failure: the message it carries is what the
 * user is meant to read. It used to be a plain `Error`, so the channel
 * entry points — which only logged what they were given — could not
 * tell it apart from a provider that had fallen over, and the user's
 * message on WeChat or Feishu sat there unanswered for ever.
 */
export class PersonaAsleepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaAsleepError";
  }
}

/**
 * The number of messages of history a turn carries.
 *
 * Bounded on both sides: a number that is not a number is the default,
 * and the ceiling is the whole history — the most the app ever sent
 * before the setting was broken.
 */
export function clampContextLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(200, Math.max(4, Math.round(n)));
}

/**
 * How creative the model is allowed to be.
 *
 * Between 0 and 2, and a number. The setting was stored as it arrived,
 * so a value that was not a number reached the provider as `NaN`.
 */
export function clampTemperature(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.8;
  return Math.min(2, Math.max(0, n));
}

/**
 * How long the model's answer may be.
 *
 * A number, and not more than the ceiling — a value that was not a
 * number reached the provider as `NaN`, which it read as "no limit".
 */
export function clampMaxTokens(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2000;
  return Math.min(128_000, Math.max(16, Math.round(n)));
}

export interface ConversationOptions {
  persona: Persona;
  userId: number;
  /** The user's message. */
  message: string;
  /**
   * The message this turn is replying to.
   *
   * It is quoted in the prompt, so the persona answers the thing that
   * was actually said rather than whatever happened to come last.
   */
  replyToId?: number | null;
  /** Explicit provider override (from `persona.llmProvider`). */
  providerName?: string;
  /** Channel the message arrived on. */
  channel?: "web" | "wechat" | "feishu";
  /** Whether the user message has already been stored. */
  /**
   * Whether the user's message is already stored.
   *
   * It was never set by any caller — so the message was always stored
   * here. It stays, because it is the flag that says what the code
   * means; but nothing claims it is in use.
   */
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
  locale?: "zh" | "en";
  now: Date;
}): Promise<string> {
  const locale = params.locale ?? "zh";
  const evicted = params.history.slice(0, Math.max(0, params.history.length - params.keepCount));
  if (evicted.length < 10) return "";

  const latest = await db.getLatestChatSummary(params.persona.id, params.userId);

  /**
   * The part of the conversation the previous summary has not seen.
   *
   * The summary is rebuilt from the sliding window alone — so the
   * oldest summarised content was dropped for ever: the new summary
   * covered only the last hundred and eighty messages, and the first
   * sixty turns of the relationship were in no summary at all. The
   * persona forgot the beginning of the story, two messages at a time.
   *
   * So the previous summary stands in for everything it covered, and
   * only the messages that have fallen out of the window since are
   * added to it.
   */
  const covered = latest?.toMessageId ?? 0;
  const fresh = evicted.filter((m) => m.id > covered);

  if (latest) {
    const age = params.now.getTime() - new Date(latest.createdAt).getTime();
    /**
     * The throttle.
     *
     * It used to count the messages after the summary's last message —
     * but the summary only covers the *evicted* slice, so the
     * twenty-odd newest messages were counted as well. The count was
     * therefore always over the threshold, and the throttle never
     * fired: a long conversation paid for a fresh summarisation on
     * every single turn.
     *
     * What matters is how much has fallen out of the window since —
     * that is what the new summary would add.
     */
    if (age < SUMMARY_MAX_AGE_MS && fresh.length < SUMMARY_MIN_NEW_MESSAGES) {
      // Summarised recently — do not pay for another LLM call.
      return latest.summary;
    }
    if (fresh.length === 0) {
      // Nothing new to say — the summary still stands.
      return latest.summary;
    }
  }

  // The transcript is read by the model, so the names in it are in the
  // language the persona is speaking.
  const transcript = [
    latest?.summary ?? "",
    ...fresh.map((m) => {
      const speaker = m.role === "user"
        ? copy(locale, "prompt.speakerUser")
        : copy(locale, "prompt.speakerPersona");
      return `${speaker}${m.content}`;
    }),
  ]
    .filter((part) => part.trim())
    .join("\n");

  try {
    const provider = await resolveProviderForUser({
      userId: params.userId,
      providerName: params.providerName,
    });
    if (!provider) {
      // No provider at all. The turn says so in words, rather than
      // throwing a TypeError from inside the service.
      throw new Error(
        `No LLM provider available${params.providerName ? ` (requested: ${params.providerName})` : ""}. Configure at least one provider in .env`,
      );
    }
    const summary = await llmService.invokeWithProvider(provider, {
      messages: [
        {
          role: "system",
          content: copy(locale, "prompts.historySummary"),
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
      // The range grows: the new summary covers everything the old one
      // covered, and everything that arrived since.
      fromMessageId: latest?.fromMessageId ?? evicted[0]?.id ?? null,
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
async function toLLMMessage(
  message: {
    role: string;
    content: string;
    messageType?: string | null;
    mediaUrl?: string | null;
  },
  locale: "zh" | "en",
): Promise<LLMMessage> {
  const role = message.role as "user" | "assistant";
  if (message.messageType === "image" && message.mediaUrl) {
    /**
     * The picture itself, not a path to it.
     *
     * The stored URL is `/uploads/chat/1/2/x.png` — a path, with no
     * host. A model cannot fetch that: the API answered "Invalid image
     * URL" and the turn failed, and against a local model the picture
     * was dropped and the persona answered as if it had seen nothing.
     *
     * So the bytes are read back and inlined. If they cannot be read,
     * the model is told the picture is there but could not be opened —
     * a missing picture is better than a turn that fails outright.
     */
    const inlined = await storageToDataUrl(message.mediaUrl).catch(() => null);
    if (inlined) {
      return {
        role,
        content: [
          { type: "text", text: message.content },
          { type: "image_url", url: inlined },
        ],
      };
    }
    return {
      role,
      content: [
        { type: "text", text: `${message.content}\n${copy(locale, "prompt.imageUnreadable")}` },
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
  /** The message this turn replies to. */
  replyToId?: number | null;
}): Promise<{
  messages: LLMMessage[];
  recalled: Array<{ id: number; title: string; subject: string }>;
}> {
  const now = params.now ?? new Date();
  const locale = params.locale ?? "zh";
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
    locale,
    now: now.getTime(),
  });
  // The message being replied to. Without it, every reply is a reply to
  // "whatever came last".
  let quotedSection = "";
  if (params.replyToId) {
    /**
     * The quoted message, from this conversation.
     *
     * It was found by the user alone, so a reply could quote a message
     * of another persona of the same user — the wrong conversation
     * entirely.
     */
    const quoted = await db
      .getMessageById(params.replyToId, params.userId, params.persona.id)
      .catch(() => null);
    if (quoted) {
      const who = quoted.role === "user" ? copy(locale, "prompt.roleUser") : params.persona.name;
      quotedSection = copy(locale, "prompt.quotedSection", { who, content: quoted.content });
    }
  }

  const summarySection = await maybeCompactHistory({
    persona: params.persona,
    userId: params.userId,
    history: history as any,
    keepCount: contextLimit - 1,
    providerName: params.providerName,
    locale,
    now,
  });

  // The prompt is built in one place, so the one the user inspects is
  // the one the model works from. It carries everything the app knows:
  // who the persona is, who it is talking to, what has been happening
  // between them, and what the persona remembers.
  const systemPrompt = await buildPromptForPersona({
    persona: params.persona,
    userId: params.userId,
    userMessage: params.userMessage,
    locale: params.locale,
    now,
    // The scene's own wording goes into the prompt, so it has to be in
    // the language the persona is speaking.
    sceneOverlay: scene
      ? (localizeScene(scene as any, params.locale ?? "zh") as any).systemPromptOverlay ?? null
      : null,
    // A scene carries the mood it is meant to be set in. It is a
    // presentation override, not a state change: the persona's own state
    // machine keeps running in the database, so leaving the scene puts the
    // persona back where it was.
    emotionalDesc: scene?.emotionalState && isEmotionalState(scene.emotionalState)
      ? getEmotionalStateDesc(scene.emotionalState, params.locale ?? "zh")
      : undefined,
    // The state the prompt describes. A scene can set the mood, and the
    // imperfection has to follow the mood the prompt states rather than
    // the one the persona happens to be stored in.
    emotionalState: scene?.emotionalState && isEmotionalState(scene.emotionalState)
      ? scene.emotionalState
      : null,
    summarySection: summarySection
      ? `${copy(locale, "prompt.summarySectionHeading")}\n${summarySection}`
      : "",
    memories: retrieved as any,
    quotedSection,
  });

  const recent = await Promise.all(
    history.slice(-(contextLimit - 1)).map((m) => toLLMMessage(m, locale)),
  );

  return {
    messages: [{ role: "system", content: systemPrompt }, ...recent],
    /**
     * The memories that went into this turn.
     *
     * The retrieval used to be entirely invisible: the persona would
     * bring up something from three months ago and the user had no way
     * to know it had been pulled from the store rather than invented —
     * which is exactly the question worth being able to ask.
     */
    recalled: retrieved.map((m) => ({
      id: m.id,
      title: m.title,
      subject: (m as any).subject ?? "them",
    })),
  };
}

/**
 * Runs the full conversation pipeline.
 *
 * Yields `ChatEvent`s. In `"once"` mode exactly one `done` event is produced
 * (plus optional `emotion`); in `"stream"` mode the reply text is emitted as
 * `delta` events as it arrives.
 */
/**
 * The turns of one persona, one after the other.
 *
 * Two turns for the same persona could run at once: the web interface
 * and a chat window on WeChat, or two tabs, or a turn overlapping with
 * the proactive sweep.
 *
 * They both read the same history, so the transcript ended up as "user
 * A, user B, reply A, reply B" — the reply to A was written without
 * seeing B's message, and B's message was answered by a reply that
 * knew nothing about it.
 */
const personaQueues = new Map<number, Promise<void>>();

/**
 * Waits for the persona's turn, and takes the next one.
 *
 * Returns the function that gives the turn back.
 */
async function takeTurn(personaId: number): Promise<() => void> {
  const previous = personaQueues.get(personaId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate);
  personaQueues.set(personaId, chain);
  await previous;
  return () => {
    release();
    // Nothing is waiting any more: the queue is free.
    if (personaQueues.get(personaId) === chain) personaQueues.delete(personaId);
  };
}

/**
 * Runs something while the persona's turn is held.
 *
 * The queue is what keeps two turns of one persona from interleaving.
 * A regenerate *replaces* a turn, so its destructive part — taking the
 * old turn away — has to happen under the same lock as the new one:
 * otherwise it can take away the message of a turn that is in flight
 * right now, and leave an answer with nothing above it.
 */
export async function withPersonaTurn<T>(
  personaId: number,
  work: () => Promise<T>,
): Promise<T> {
  const release = await takeTurn(personaId);
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * A conversation with a persona.
 *
 * The turns of one persona are one after the other.
 *
 * `turnHeld` says the caller already holds the turn — so the
 * conversation does not wait for a turn that is already its own. The
 * queue is not re-entrant: taking it twice would wait for ever.
 */
export async function* runConversation(
  options: ConversationOptions & { mode: ChatMode; turnHeld?: boolean },
): AsyncGenerator<ChatEvent> {
  const release = options.turnHeld ? () => undefined : await takeTurn(options.persona.id);
  try {
    for await (const event of runConversationTurn(options)) {
      yield event;
    }
  } finally {
    release();
  }
}

/**
 * One turn: the user's message, the persona's answer, and everything
 * that is written down around it.
 */
async function* runConversationTurn(
  options: ConversationOptions & { mode: ChatMode },
): AsyncGenerator<ChatEvent> {
  const { persona, userId, message } = options;
  const now = options.now ?? new Date();
  const locale = options.locale ?? "zh";

  /**
   * The user's midnight.
   *
   * The safety events are filed under the user's own day, so "already
   * said today" means "since the user's midnight" — not the server's.
   */
  const dayStart = new Date(now.getTime());
  {
    const shift = dayShiftMinutes(await db.getUserTimezone(userId), now);
    dayStart.setMinutes(dayStart.getMinutes() + shift);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setMinutes(dayStart.getMinutes() - shift);
  }

  // A persona that has said goodbye is asleep. It used to stay perfectly
  // chatable, which meant the "graduation" was only a badge: the app
  // announced the anniversary of a relationship the user had ended and
  // still let them talk to it. Waking the persona is the way back.
  const presence = getEffectivePresence({
    personaPresence: persona.presence,
    graduationStatus: persona.graduationStatus,
  });
  if (presence === "asleep") {
    throw new PersonaAsleepError(
      copy(locale, "prompt.graduatedNotice", { name: persona.name }),
    );
  }

  const defaultConfig = await db.getDefaultLlmConfig(userId);
  const extraConfig = (defaultConfig?.extraConfig as any) ?? {};
  /**
   * How many messages of history the turn carries.
   *
   * The number is read from the user's own settings, and the settings
   * accept any shape — so a value that is not a number made the limit
   * NaN, and `history.slice(-(NaN - 1))` is `slice(NaN)`, which is the
   * whole history. Every turn then sent two hundred messages to the
   * provider, the provider answered "context length exceeded", and the
   * bill went up on every turn.
   *
   * The settings are checked when they are written, but a row written
   * before that — or one written by hand — is checked here too.
   */
  const contextLimit = clampContextLimit(extraConfig.contextLimit);

  /**
   * The message this turn is answering.
   *
   * The client says which one, and the id is stored as it arrived — so
   * it could point at a message of another persona, or at one that is
   * not there at all. The *quote* in the prompt was looked up properly;
   * the column was not.
   */
  let replyToId = options.replyToId ?? null;
  if (replyToId) {
    const quoted = await db
      .getMessageById(replyToId, userId, persona.id)
      .catch(() => null);
    if (!quoted) replyToId = null;
  }

  // The user's turn is stored first so the history and any summarisation see it.
  let storedUserMessageId: number | null = null;
  if (!options.alreadyPersisted) {
    storedUserMessageId = await db.createMessage({
      personaId: persona.id,
      userId,
      role: "user",
      content: message,
      emotionalState: persona.emotionalState,
      channel: options.channel ?? "web",
      messageType: options.media?.type ?? "text",
      mediaUrl: options.media?.url ?? null,
      replyToId,
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

  /**
   * The distress is written down.
   *
   * It changes what the persona says — but nothing was recorded, so the
   * panel that says "what the app noticed" did not show it. The app
   * knew the user was worn out and kept it to itself.
   *
   * Once a day: the wording of a message says the person is worn out
   * for as long as they are, and a row for every one of them would be
   * its own kind of noise.
   */
  if (gentleCheckIn) {
    const alreadyToday = await db
      .hasSafetyEventSince({
        userId,
        personaId: persona.id,
        type: "distress",
        since: dayStart,
      })
      .catch(() => false);
    if (!alreadyToday) {
      await db.createSafetyEvent({
        userId,
        personaId: persona.id,
        type: "distress",
        severity: "info",
      }).catch((e) => console.warn("[Safety] Failed to record the distress event:", e));
    }
  }

  const { messages: llmMessages, recalled } = await composeMessages({
    persona,
    userId,
    userMessage: message,
    contextLimit,
    providerName: options.providerName,
    locale,
    now,
    replyToId: options.replyToId,
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
      replyText = replyText || copy(locale, "prompt.silence");
      yield { type: "delta", text: replyText };
    }
  } catch (e) {
    failed = true;
    failureMessage = (e as Error).message;
    // A cancelled reply is not a failed reply: the user asked for it to
    // stop, so nothing is stored and nothing is counted. Storing a
    // "（沉默）" in its place would put a message in the transcript that
    // the person never received and never asked for.
    if (options.signal?.aborted) {
      /**
       * A message with nothing under it.
       *
       * The turn was cut short — a closed tab, a network blip — so
       * nothing was stored as the answer. The user's own message was
       * stored already, and it would sit in the transcript for ever
       * with nothing under it.
       *
       * The client takes its bubble away when a send fails, so the
       * transcript says the same thing: the message is taken away too.
       *
       * A half-answer is different: the client keeps that, and so does
       * the transcript.
       */
      /**
       * The half-answer is kept.
       *
       * The client keeps it — it says so, and it shows it on screen —
       * but the transcript did not have it. So the next poll wiped it
       * off the screen: the user pressed stop, saw their question and
       * half an answer, and twenty seconds later both were gone.
       *
       * And the user's own message stays: they stopped the *answer*,
       * not their own words.
       */
      if (replyText) {
        const messageId = await db.createMessage({
          personaId: persona.id,
          userId,
          role: "assistant",
          content: replyText,
          emotionalState: persona.emotionalState,
          channel: options.channel ?? "web",
        });
        yield {
          type: "done",
          messageId,
          emotionalState: persona.emotionalState,
          graduationSuggested: false,
          careNote: null,
          crisis: false,
        };
        return;
      }
      if (storedUserMessageId) {
        await db
          .deleteMessage(storedUserMessageId, userId, persona.id)
          .catch(() => false);
      }
      yield { type: "error", message: "aborted", partial: false };
      return;
    }
    console.error("[Chat] LLM call failed:", e);
    yield { type: "error", message: failureMessage, partial: replyText.length > 0 };
    // A turn that failed is not a turn.
    //
    // It used to carry on: the reply was stored as "（沉默）", the
    // message count went up, the intimacy score went up, and two more
    // model calls were made to work out the emotional state of a
    // conversation that never happened. The message count is one of the
    // gates on the graduation, so a provider that was having a bad day
    // could walk the user towards the ritual.
    //
    // The half that did arrive is a different matter: the user saw it,
    // so the transcript has to have it too — or the next poll would
    // wipe it off the screen.
    if (failed) {
      if (replyText) {
        const messageId = await db.createMessage({
          personaId: persona.id,
          userId,
          role: "assistant",
          content: replyText,
          emotionalState: persona.emotionalState,
          channel: options.channel ?? "web",
        });
        yield {
          type: "done",
          messageId,
          emotionalState: persona.emotionalState,
          graduationSuggested: false,
          careNote: null,
          crisis: false,
          recalled,
        };
      }
      return;
    }
  }

  /**
   * The user's own time zone.
   *
   * The limits are the user's: "five messages a day" means five messages
   * in the user's day, not in the server's.
   */
  const usageTimezone = await db.getUserTimezone(userId);

  // The care note is decided before the reply is stored, so it can be part
  // of what the persona actually says — the plan asks for the persona itself
  // to say the caring words, not for a separate system notice.
  /**
   * The signals.
   *
   * The evaluation was not guarded — and it runs *after* the reply has
   * been produced and *before* it is stored. So a transient database
   * error in the safety layer turned a reply that had already been
   * written into a failure: the user's message was stored, the reply
   * was not, and the transcript kept their words with nothing under
   * them.
   *
   * A safety layer that cannot answer is a safety layer that says
   * nothing — it must not take the conversation down with it.
   */
  let signals: Awaited<ReturnType<typeof evaluateUsage>> | undefined;
  try {
    signals = await evaluateUsage({
      userId,
      personaId: persona.id,
      now: now.getTime(),
      timezone: usageTimezone,
    });
  } catch (e) {
    console.warn("[Safety] Could not evaluate the usage:", e);
  }
  const pickedNote = signals ? pickCareNote(signals, locale) : null;

  /**
   * The note is said once a day.
   *
   * The safety layer's own conditions stay true all day: "more than
   * five messages" is true for the sixth message *and every message
   * after it*, and a long session stays long. So without this, every
   * message of the day carried another copy of the same caring words,
   * and every one of them recorded another event — so the
   * transparency panel, which shows the newest twenty, filled up with
   * twenty identical rows and pushed the one real record off the end.
   *
   * The banner goes with it: the user does not need to be told fifteen
   * times an evening.
   */
  let careNote = pickedNote;
  if (pickedNote) {
    const eventType = pickedNote.kind === "dependency" ? "dependency" : "usage";
    const alreadyToday = await db
      .hasSafetyEventSince({
        userId,
        personaId: persona.id,
        type: eventType,
        since: dayStart,
      })
      .catch((e) => {
        console.warn("[Safety] Could not read the usage events:", e);
        return false;
      });
    if (alreadyToday) {
      careNote = { ...pickedNote, text: "", showBanner: false };
    } else {
      await db.createSafetyEvent({
        userId,
        personaId: persona.id,
        type: eventType,
        severity: pickedNote.showBanner ? "warning" : "info",
      }).catch((e) => console.warn("[Safety] Failed to record usage event:", e));
    }
  }

  // The trajectory is assessed here, before the reply is composed, so that
  // a user whose emotional direction has turned can be noticed in the same
  // breath. It used to be assessed afterwards, and only its "improving"
  // half was ever read.
  const trajectory = await maybeAssessTrajectory({
    personaId: persona.id,
    userId,
    providerName: options.providerName,
    providerInstance: provider,
    locale,
    now,
  });
  const worsening = trajectory === "worsening";
  if (worsening) {
    /**
     * Once a day as well.
     *
     * The trajectory stays "worsening" for as long as it does — so
     * every message of the day recorded another row, and the panel
     * showed twenty of them.
     */
    const alreadyToday = await db
      .hasSafetyEventSince({
        userId,
        personaId: persona.id,
        type: "graduation_trajectory",
        since: dayStart,
      })
      .catch(() => false);
    if (!alreadyToday) {
      await db.createSafetyEvent({
        userId,
        personaId: persona.id,
        type: "graduation_trajectory",
        severity: "info",
      }).catch((e) => console.warn("[Safety] Failed to record the trajectory event:", e));
    }
  }

  // Even a partial answer is kept — half a sentence is still worth more than
  // nothing when the user is waiting.
  const baseText = replyText || copy(locale, "prompt.silence");
  const appended = [gentleCheckIn, careNote?.text].filter((part): part is string => !!part);
  // A worsening trajectory is only worth mentioning when the persona is not
  // already saying something caring — two notes in one reply is a lecture.
  if (worsening && !careNote) {
    appended.push(worseningTrajectoryNote(locale));
  }
  const finalText = appended.length > 0 ? `${baseText}\n\n${appended.join("\n\n")}` : baseText;

  // The emotional state is inferred *before* the reply is stored. It used
  // to be stored with the persona's previous state and inferred
  // afterwards, so the message showed the new mood live and the old one
  // after a reload — the same conversation, two different emotions.
  const emotion = await inferEmotionalState({
    userMessage: message,
    /**
     * The persona's own words.
     *
     * The classifier is asked to judge the persona's tone, so it is
     * given the persona's words and not the app's: the gentle check-in,
     * the care note and the trajectory note are the app's, and they
     * are all written in a caring, deliberate tone — so reading them
     * as the persona's words could put the persona in a state it was
     * not in.
     */
    assistantReply: baseText,
    currentState: persona.emotionalState,
    provider: options.providerName,
    // The classifier has to run on the same credentials as the reply —
    // otherwise a user who configured their own key silently falls back to
    // the environment one.
    providerInstance: provider,
    locale,
  });
  const newEmotionalState = emotion.state;

  const messageId = await db.createMessage({
    personaId: persona.id,
    userId,
    role: "assistant",
    content: finalText,
    emotionalState: newEmotionalState,
    channel: options.channel ?? "web",
    // Which memories went into this turn, so the answer to "did it
    // recall that, or invent it?" survives a reload.
    recalledMemoryIds: recalled.length > 0 ? JSON.stringify(recalled.map((m) => m.id)) : null,
  });

  yield { type: "emotion", state: newEmotionalState, reason: emotion.reason };

  /**
   * The count goes up by one.
   *
   * It used to be read at the start of the turn and written back as an
   * absolute number — so two turns that overlapped both read N and both
   * wrote N+1, and one turn was never counted. The count is a gate on
   * the graduation.
   */
  const chatCount = await db.incrementChatCount(persona.id, userId);
  await db.updatePersona(persona.id, userId, {
    /**
     * The moment of the turn.
     *
     * It used to be the wall clock, while the rest of the turn — the
     * timestamps on the messages, the quiet hours, the day the turn
     * belongs to — uses the moment the caller passed in. So a turn
     * that was given a time of its own was still recorded as having
     * happened now, and the silence the persona keeps was measured
     * from the wrong moment.
     */
    lastChatAt: now,
    /**
     * The moment the user spoke.
     *
     * It is its own column because "the last time anything was
     * written" and "the last time the *user* spoke" are two different
     * questions — and the app's own nightly message answered the second
     * one too. So "you have not spoken for N days" read 0 while the
     * user had not spoken for a week.
     */
    lastUserMessageAt: now,
    emotionalState: newEmotionalState as any,
  });

  /**
   * The day, in the server's own calendar.
   *
   * It was the UTC day, while the daily-activity chart computes the
   * *user's* day — so the emotion timeline and the message-volume chart
   * disagreed about which day a message belonged to.
   */
  /**
   * The day the snapshot belongs to.
   *
   * It was the server's own calendar. The snapshot is the persona's
   * emotional state "on a day", and the chart of that day is drawn
   * beside the chart of the messages — which is in the user's calendar.
   * So one page showed the same conversation on two different days.
   *
   * The user's day is used, and the snapshot is written under it.
   */
  const timezone = usageTimezone;
  const todayStr = zonedDateKey(now, timezone) || localDateKey(now);
  // The lookup has to be under the same day the snapshot is written
  // under, or the "one a day" guard fires against the wrong row.
  const existing = await db.getTodaySnapshot(persona.id, userId, todayStr);
  /**
   * The count is the number of messages that actually happened today.
   *
   * It used to be written as 1, which meant the "message count" in the
   * emotion report was really "the number of days with a snapshot" —
   * and every day had exactly one. And it was written once, when the
   * first message of the day arrived, and never touched again — so a
   * user who sent one message in the morning and nine more at night
   * showed a count of one.
   */
  /**
   * The count is the number of messages of the *user's* day.
   *
   * The window was the server's midnight — so for anybody not on the
   * server's clock the count attached to a day was off by a day's
   * boundary: the first hours of the user's day were counted as the
   * day before, and the last hours of the day before were counted as
   * this one.
   */
  const messageCount = await db.getUserMessageCountForPersonaSince(
    persona.id,
    userId,
    dayStart,
  );
  if (!existing) {
    await db.createEmotionSnapshot({
      personaId: persona.id,
      userId,
      emotionalState: newEmotionalState,
      messageCount,
      date: todayStr,
    });
  } else {
    // The day's snapshot is brought up to date, so the count is the
    // count of the day and not the count of its first minute.
    await db.updateEmotionSnapshot(existing.id, userId, {
      emotionalState: newEmotionalState,
      messageCount,
    });
  }

  const intimacyData = await db.getIntimacyData(persona.id, userId);
  const intimacy = computeIntimacy(intimacyData);
  await db.updateIntimacy(persona.id, userId, intimacy.score, intimacy.level);

  // The graduation check reads the stored trajectory, and the trajectory
  // was already assessed earlier in this turn — before the reply was
  // composed, so that a user whose direction has turned could be noticed in
  // the same breath.
  const graduationSuggested = await evaluateGraduation({
    persona,
    userId,
    intimacyLevel: intimacy.level,
    chatCount,
    // The reason is written in the reader's language.
    locale,
    // And it is measured on the clock the rest of the turn uses.
    now,
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
  if (worsening && !careNote) {
    yield { type: "delta", text: `\n\n${worseningTrajectoryNote(locale)}` };
  }

  // The memories are extracted on their own, at most once a day, and
  // only when there is enough new conversation to be worth extracting.
  // It runs in the background: the reply is already written, and nobody
  // should wait for it.
  maybeExtractMemories(persona, userId, locale, now).catch((e) =>
    console.warn("[Chat] The memory extraction failed:", e.message));

  yield {
    type: "done",
    messageId,
    emotionalState: newEmotionalState,
    graduationSuggested,
    careNote,
    crisis: false,
    recalled,
  };
}

/**
 * Runs the extraction when it is due.
 *
 * The cost of a model call is real, so this is throttled hard: once a
 * day, and only when there are enough new messages to extract from.
 */
/**
 * How long there is between two extraction runs.
 */
const EXTRACTION_INTERVAL_MS = 24 * 3_600_000;

async function maybeExtractMemories(
  persona: Persona,
  userId: number,
  locale: "zh" | "en" = "zh",
  now = new Date(),
): Promise<void> {
  /**
   * The interval comes first.
   *
   * A count is a query, and the answer is "not yet" for a whole day
   * after every run. So the count is only asked for when the interval
   * has passed — the turn itself does not pay for it.
   *
   * And the interval is measured from the last *attempt*, not the last
   * success: an extraction whose answer could not be read used to leave
   * the mark where it was, so every turn after it paid for another
   * model call.
   */
  const lastAttempt = await db.getLastExtractionAttemptAt(persona.id, userId);
  if (
    lastAttempt &&
    now.getTime() - new Date(lastAttempt).getTime() < EXTRACTION_INTERVAL_MS
  ) {
    return;
  }
  /**
   * The messages the extraction would read.
   *
   * The count used to be taken from the last *day* — so a person who
   * sends three or four messages a day never reached the ten that
   * justify a run, in any twenty-four-hour window. The extraction log
   * stayed empty and the persona never learned anything from talking to
   * them.
   *
   * The window is the one the extraction itself reads: everything since
   * the last run, and everything there is for the first one.
   */
  /**
   * The window.
   *
   * It is the last *successful* extraction — the one whose window was
   * read. The attempt is a different thing: it is when the extraction
   * last tried, and it is what the interval is measured from.
   */
  const lastExtracted = await db.getLastExtractionAt(persona.id, userId);
  const newMessages = await db.getUserMessageCountForPersonaSince(
    persona.id,
    userId,
    lastExtracted ?? new Date(0),
  );
  if (!isExtractionDue({
    lastExtractedAt: lastExtracted,
    newMessageCount: newMessages,
    now,
  })) {
    return;
  }
  await extractMemories({ persona, userId, locale, now });
}

/**
 * Assesses the emotional trajectory, at most once a day per persona.
 *
 * The assessment is a model call over a month of messages, so running it on
 * every turn would be expensive; the stored assessment says whether it is
 * time again. A failure is never fatal — the turn goes on without a fresh
 * trajectory.
 *
 * The result is returned so the reply can react to it. A trajectory that is
 * getting worse used to be computed, stored, and then ignored: the safety
 * layer only ever noticed the user getting better, which is the one
 * direction that does not need watching.
 */
async function maybeAssessTrajectory(params: {
  personaId: number;
  userId: number;
  providerName?: string;
  providerInstance?: LLMProvider;
  locale?: "zh" | "en";
  now: Date;
}): Promise<"improving" | "stable" | "worsening" | null> {
  try {
    if (!(await isTrajectoryAssessmentAllowed(params.userId))) return null;
  } catch (e) {
    console.warn("[Safety] Could not read the trajectory setting:", (e as Error).message);
  }

  try {
    const latest = await db.getLatestGraduationAssessment(params.personaId, params.userId);
    if (latest) {
      const age = params.now.getTime() - new Date(latest.createdAt).getTime();
      if (age < TRAJECTORY_INTERVAL_MS) return latest.trajectory as any;
    }

    const assessment = await assessTrajectory({
      userId: params.userId,
      personaId: params.personaId,
      provider: params.providerName,
      providerInstance: params.providerInstance,
      locale: params.locale,
      now: params.now.getTime(),
    });
    return (assessment?.trajectory as any) ?? null;
  } catch (e) {
    console.warn("[Safety] Trajectory assessment failed:", (e as Error).message);
    return null;
  }
}

/**
 * Whether the app may read the user's own messages to assess their
 * trajectory.
 *
 * The trajectory is the one place where a month of raw private
 * conversation goes to the model. It is also what lets the app notice a
 * user who is getting better — which is the whole point of the product —
 * so "auto" runs it when the graduation mechanism is in its suggesting
 * mode, and leaves it to the user otherwise.
 */
async function isTrajectoryAssessmentAllowed(userId: number): Promise<boolean> {
  const user = await db.getUserById(userId);
  if (!user) return true;
  const setting = (user as any).trajectoryAssessment ?? "auto";
  if (setting === "off") return false;
  if (setting === "on") return true;
  const mode = await getEffectiveGraduationMode({
    personaMode: null,
    userId,
  });
  return mode === "suggest";
}

/**
 * The line appended when the emotional trajectory is getting worse.
 *
 * It is deliberately not a lecture and not a suggestion to let go. The
 * user is not being asked to change anything — they are being told that
 * the app noticed, which is the part that was missing.
 */
function worseningTrajectoryNote(locale: "zh" | "en"): string {
  return copy(locale, "prompt.worseningTrajectoryNote");
}

/**
 * Decides whether to suggest graduation.
 *
 * The hard thresholds decide; the emotional trajectory can make the app
 * mention it earlier, as a gentle nudge rather than a decision.
 *
 * Whether the app may mention it at all is the user's choice: only the
 * "suggest" mode lets the app raise the topic by itself. The other two
 * modes are silence here — the user still keeps every entry point of their
 * own.
 *
 * It is exported so the gate can be tested on its own; the conversation
 * pipeline is the only caller.
 */
export async function evaluateGraduation(params: {
  persona: Persona;
  userId: number;
  intimacyLevel: string;
  chatCount: number;
  /** The language the reason is written in. */
  locale?: "zh" | "en";
  now?: Date;
}): Promise<boolean> {
  const { persona, userId } = params;
  const now = params.now ?? new Date();
  const locale = params.locale ?? "zh";

  // A persona that has graduated is final; nothing may re-open it.
  // An offer that was made — or declined — puts the persona in a cooldown,
  // so the suggestion arrives occasionally instead of on every turn.
  const offer = canOfferGraduation({
    status: persona.graduationStatus,
    suggestedAt: persona.graduationSuggestedAt,
    declinedAt: persona.graduationDeclinedAt,
    now,
  });
  if (!offer.allowed) return false;

  // A persona the user asked to be left alone is not one to raise a
  // farewell with.
  const presence = getEffectivePresence({
    personaPresence: persona.presence,
    graduationStatus: persona.graduationStatus,
  });
  if (!mayReachOut(presence)) return false;

  const mode = await getEffectiveGraduationMode({
    personaMode: persona.graduationMode,
    userId,
  });
  if (mode !== "suggest") return false;

  const timezone = await db.getUserTimezone(userId);
  const recentEmotions = await db.getRecentEmotionTrend(persona.id, userId, 14, timezone);
  const recentFreq = await db.getMessageCountInRange(persona.id, userId, 7, 0, timezone);
  const prevFreq = await db.getMessageCountInRange(persona.id, userId, 14, 7, timezone);

  const eligibility = checkGraduationEligibility({
    intimacyLevel: params.intimacyLevel,
    recentEmotions,
    chatCount: params.chatCount,
    recentChatFrequency: recentFreq,
    previousChatFrequency: prevFreq,
    /**
     * The reason is read by a person, in a chat window, at the moment
     * they are deciding whether to say goodbye. It has to be in their
     * language.
     */
    locale,
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
    // The offer has to be recorded, or it is made again on the next turn —
    // and an offer that repeats itself is nagging, not a suggestion.
    await db.setGraduationStatus(persona.id, userId, "suggested");
    return true;
  }

  return false;
}
