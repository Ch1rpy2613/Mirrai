/**
 * The persona reaching out first.
 *
 * The replica never spoke on its own. The user always had to open the
 * app and start — which means the reason to open it was the user
 * feeling like it, not the other person. For anybody whose partner is
 * away, that is the whole difference: the reason you open the app is to
 * see whether they would have said something.
 *
 * So the persona now speaks first, sometimes. What it says is grounded
 * in what it actually knows — the memories, the two clocks, how long it
 * has been, how the user has been doing — and it is delivered as a real
 * message in the conversation, because a message is what a person sends
 * and a notification is what a machine sends.
 *
 * The frequency is the user's, and zero is a real value. The product's
 * goal is to help the user finish a relationship, so an app that speaks
 * first is something they have to buy, not something they get.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { llmService, type LLMProvider } from "../llm";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import { buildUserContextBlock, isUserMood } from "@shared/user-side";
import { zonedHour, zonedOffsetHours } from "@shared/timezone";
import { mayReachOut, type Presence } from "@shared/graduation-mode";
import { sampleProactiveDelayMs, type BehaviorProfile } from "@shared/behavior-profile";
import { seededRandom } from "../_core/behavior-profile";
import { copy } from "@shared/copy";

/**
 * The longest a proactive message may be. A first word is not a letter.
 *
 * It is a message the persona opens with, not a paragraph: it has to
 * read like the first thing somebody says.
 */
const MAX_PROACTIVE_LENGTH = 120;

export interface ProactiveContext {
  /** How long since the last message, in days. */
  daysSinceLastChat: number;
  /** The time on the user's side. */
  userHour: number;
  /** The time on the persona's side. */
  personaHour: number;
  /**
   * How many hours the persona's clock is ahead of the user's.
   *
   * "They are six hours ahead of you" is a thing a person can act on.
   * "They are in another timezone" is not — it is the reason a message
   * lands at three in the morning.
   */
  hoursApart: number | null;
  /** The user's own recent state, if they said. */
  userMood: string | null;
  /** Whether the relationship has ended. */
  relationshipEnded: boolean;
}

/**
 * Collects what the persona knows about right now.
 */
export async function collectProactiveContext(params: {
  persona: Persona;
  userId: number;
  now?: Date;
}): Promise<ProactiveContext> {
  const now = params.now ?? new Date();
  const user = await db.getUserById(params.userId).catch(() => null);
  /**
   * The user's silence.
   *
   * It used to be measured from the last message of any kind — and
   * after the app has spoken first, that is the app's own message. So
   * the persona said "ten days without a word from you" once, and every
   * message after that said "zero days", while the user had still not
   * said a word at all.
   */
  const lastUserMessage = await db.getLastUserMessageAt(params.persona.id, params.userId);
  const daysSinceLastChat = lastUserMessage
    ? Math.floor((now.getTime() - new Date(lastUserMessage).getTime()) / 86_400_000)
    : 0;
  const mood = await db.getRecentUserMood(params.userId).catch(() => null);

  const userZone = user?.timezone ?? null;
  const personaZone = (params.persona as any).timezone ?? null;

  return {
    daysSinceLastChat,
    userHour: zonedHour(now, userZone),
    personaHour: zonedHour(now, personaZone),
    hoursApart: personaZone
      ? zonedOffsetHours(now, personaZone) - zonedOffsetHours(now, userZone)
      : null,
    userMood: mood && isUserMood(mood.mood) ? mood.mood : null,
    relationshipEnded: Boolean((params.persona as any).togetherTo?.trim()),
  };
}

/**
 * The instruction that makes it a first word rather than a reply.
 *
 * Every sentence is one fact, and the fact is only there when it is true:
 * the app knows how long it has been, how far apart the two clocks are, how
 * the user has been, and whether it is still a relationship — and it tells
 * the persona the ones that apply.
 */
export function buildProactiveInstruction(
  context: ProactiveContext,
  locale: "zh" | "en" = "zh",
): string {
  const parts: string[] = [];

  parts.push(copy(locale, "prompts.proactiveOpening"));
  if (context.daysSinceLastChat >= 3) {
    parts.push(copy(locale, "prompts.proactiveDaysSince", { days: context.daysSinceLastChat }));
  }
  if (context.hoursApart !== null && Math.abs(context.hoursApart) >= 1) {
    const hours = Math.abs(Math.round(context.hoursApart));
    parts.push(
      copy(locale, "prompts.proactiveClock", {
        direction: copy(locale, context.hoursApart > 0 ? "prompts.clockAhead" : "prompts.clockBehind"),
        hours: copy(locale, hours === 1 ? "prompts.hourUnit" : "prompts.hourUnits", { hours }),
      }),
    );
  }
  if (context.userMood) {
    parts.push(copy(locale, "prompts.proactiveMood"));
  }
  if (context.relationshipEnded) {
    parts.push(copy(locale, "prompts.proactiveEnded"));
  }
  parts.push(copy(locale, "prompts.proactiveLength"));
  return parts.join("\n");
}

/**
 * Writes a message the persona starts.
 */
export async function composeProactiveMessage(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  now?: Date;
}): Promise<string | null> {
  const { persona } = params;
  const locale = params.locale ?? "zh";
  const now = params.now ?? new Date();

  const context = await collectProactiveContext({
    persona,
    userId: params.userId,
    now,
  });

  const memories = await retrieveMemories({
    personaId: persona.id,
    userId: params.userId,
    userMessage: buildProactiveInstruction(context, locale),
    locale,
  }).catch(() => []);
  const anchors = memories.filter((m) => m.category === "anchor");
  const ordinary = memories.filter((m) => m.category !== "anchor");

  const user = await db.getUserById(params.userId).catch(() => null);
  const userContext = buildUserContextBlock(
    {
      name: user?.name,
      addressStyle: user?.addressStyle,
      boundaries: user?.boundaries,
      /**
       * Where the user is.
       *
       * The block about the user carries the time zone now, and this
       * path did not pass it — so the same persona was told the user's
       * time zone in a reply and not in a proactive message.
       */
      timezone: user?.timezone ?? null,
    },
    { locale, mood: context.userMood as any },
  );

  const systemPrompt = buildSystemPrompt(persona, {
    anchorSection: formatAnchorsForPrompt(anchors, locale),
    memorySection: formatMemoriesForPrompt(ordinary, locale),
    userContext,
    locale,
    now,
  });

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: buildProactiveInstruction(context, locale) },
  ];

  let text = "";
  /**
   * The user's own provider.
   *
   * The server's default is used only when the user has no provider of
   * their own: their conversation must not end up on the operator's
   * account because their provider had a bad minute.
   */
  let provider: LLMProvider | undefined;
  let mayUseServerProvider = false;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId: params.userId,
      providerName: (persona as any).llmProvider ?? undefined,
    });
    provider = resolved.provider;
    mayUseServerProvider = !resolved.owned;
  } catch (e) {
    console.warn("[Proactive] The provider could not be resolved:", (e as Error).message);
  }
  if (provider) {
    try {
      // Through the service, so the deadline and the retry policy apply.
      text = await llmService.invokeWithProvider(provider, { messages });
    } catch (e) {
      console.warn("[Proactive] The user's provider failed:", (e as Error).message);
    }
  }

  if (!text?.trim() && mayUseServerProvider) {
    try {
      text = await llmService.invoke({ messages });
    } catch (e) {
      console.warn("[Proactive] No provider could write the message:", (e as Error).message);
    }
  }

  const trimmed = text?.trim();
  if (!trimmed) return null;
  // It used to be cut at four times the length, so a proactive message
  // could be four times longer than the limit it was given — and the
  // prompt asks for twenty to eighty characters.
  return trimmed.slice(0, MAX_PROACTIVE_LENGTH);
}

/**
 * When the persona will speak first in this silence.
 *
 * Two moments, and the difference between them is the whole change. The
 * first is the end of the window the user bought — the app may not
 * speak first more often than that, and that rule has not moved. The
 * second is when it actually will, and for a persona whose timing has
 * been measured that moment is drawn from its own distribution instead
 * of being the same clock tick for everybody.
 */
export interface ProactiveDeadline {
  /** The end of the window the user bought. */
  eligibleAt: Date;
  /** When the persona will actually speak first. */
  at: Date;
  /** Whether the extra wait came from the persona's own distribution. */
  sampled: boolean;
}

/**
 * The deadlines that have been drawn, one per silence.
 *
 * The key is the silence itself — the persona and the moment the
 * silence began — so a new silence is a new plan and the same silence
 * is always the same plan. The draw is seeded from that key as well,
 * which means a restart does not change what the persona had decided:
 * the deadline is a property of the silence, not of the process that
 * happened to be running when the silence started.
 */
const sampledDeadlines = new Map<string, number>();

/** How many deadlines are kept before the old ones are let go. */
const MAX_KEPT_DEADLINES = 500;

/**
 * Forgets the deadlines of silences that are long over.
 *
 * The map is a cache, not a ledger: a silence that ended is a silence
 * that will not be asked about again.
 */
function pruneDeadlines(): void {
  if (sampledDeadlines.size <= MAX_KEPT_DEADLINES) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, at] of sampledDeadlines) {
    if (at < cutoff) sampledDeadlines.delete(key);
  }
}

/**
 * Forgets every drawn deadline.
 *
 * Only the tests need this; the deadlines are keyed by the silence, so
 * in use they cannot be stale.
 */
export function clearProactiveDeadlines(): void {
  sampledDeadlines.clear();
}

/**
 * When the persona will speak first, and how that was decided.
 *
 * For a persona whose timing has been measured, the wait is drawn from
 * its own distribution and added to the window the user bought: the
 * purchase says how often, the persona's own history says when. The
 * draw happens once per silence — the same silence always yields the
 * same deadline, so the plan survives a restart.
 *
 * For a persona with no measurement, the deadline is the end of the
 * bought window, exactly as it always was.
 */
export function resolveProactiveDeadline(params: {
  personaId: number;
  frequencyHours: number;
  lastChatAt: Date | null;
  behaviorProfile?: BehaviorProfile | null;
}): ProactiveDeadline | null {
  if (!params.lastChatAt || !params.frequencyHours || params.frequencyHours <= 0) {
    return null;
  }

  const silenceStart = new Date(params.lastChatAt).getTime();
  if (Number.isNaN(silenceStart)) return null;

  const windowMs = params.frequencyHours * 3_600_000;
  const eligibleAt = silenceStart + windowMs;
  const profile = params.behaviorProfile ?? null;

  if (!profile) {
    return { eligibleAt: new Date(eligibleAt), at: new Date(eligibleAt), sampled: false };
  }

  const key = `${params.personaId}:${silenceStart}`;
  const drawn = sampledDeadlines.get(key);
  if (drawn !== undefined) {
    return { eligibleAt: new Date(eligibleAt), at: new Date(drawn), sampled: true };
  }

  // The silence the draw is made against is the silence at the moment
  // the persona became allowed to speak — which is the bought window
  // itself, and is the same number every time the silence is asked
  // about. That is what makes the deadline reproducible.
  const waitMs = sampleProactiveDelayMs(
    profile,
    windowMs,
    seededRandom(`${key}:${profile.replyGapMedianSec}:${profile.replyGapLogSigma}`),
  );
  const at = eligibleAt + waitMs;

  sampledDeadlines.set(key, at);
  pruneDeadlines();

  return { eligibleAt: new Date(eligibleAt), at: new Date(at), sampled: true };
}

/**
 * Whether a persona is due to speak first.
 *
 * Three conditions, and all three have to hold: the user asked for it
 * (the frequency is not zero), enough time has passed, and the persona
 * is actually around. A persona the user has put to sleep, or asked to
 * be left alone, does not come back on its own.
 *
 * For a persona whose timing has been measured, "enough time has
 * passed" is measured against the deadline that was drawn for this
 * silence rather than against the bought window alone — otherwise the
 * wait would be recomputed as a constant on every tick and the persona
 * would never reach it.
 */
export function isProactiveDue(params: {
  frequencyHours: number;
  lastChatAt: Date | null;
  presence: string;
  now?: Date;
  /** The persona's own timing, when it has been measured. */
  behaviorProfile?: BehaviorProfile | null;
  /** Which persona it is — part of the seed of the draw. */
  personaId?: number;
}): boolean {
  const now = params.now ?? new Date();
  if (!params.frequencyHours || params.frequencyHours <= 0) return false;
  if (!mayReachOut(params.presence as Presence)) return false;
  if (!params.lastChatAt) return true;

  const deadline = resolveProactiveDeadline({
    personaId: params.personaId ?? 0,
    frequencyHours: params.frequencyHours,
    lastChatAt: params.lastChatAt,
    behaviorProfile: params.behaviorProfile ?? null,
  });
  if (!deadline) return false;

  return now.getTime() >= deadline.at.getTime();
}
