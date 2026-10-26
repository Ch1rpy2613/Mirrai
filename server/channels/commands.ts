/**
 * Slash commands shared by every conversation channel.
 *
 * Commands are intercepted before the message reaches the LLM, so they cost no
 * model calls. The active persona chosen with `/使用` lives in the session
 * (process memory) rather than the database: it is a temporary override that
 * falls back to the account's default persona after a restart.
 *
 * The session key is the conversation identifier of whichever channel the
 * message arrived on, so `/使用` behaves the same in WeChat and in Feishu.
 */
import { checkGraduationEligibility } from "../_core/persona-utils";
import { getEffectiveGraduationMode, canOfferGraduation, getEffectivePresence } from "../_core/graduation";
import { getMessageCountInRange, getPersonasByUserId, getRecentEmotionTrend, setGraduationStatus, getUserTimezone } from "../db";
import { writeFarewellLetter } from "../chat/farewell";
import type { Persona } from "../../drizzle/schema";
import type { ChannelId } from "./types";
import { mayReachOut } from "@shared/graduation-mode";
import { copy, detectLocale, type Locale } from "@shared/copy";
import { CHANNEL_COMMANDS } from "@shared/copy/channels";

/**
 * Session-scoped persona overrides.
 *
 * Keyed by the user as well as the conversation. They were keyed by the
 * conversation alone, and the conversation id is the counterpart's id on
 * the channel — so two users whose ids collided shared an override.
 * The downstream ownership check stops the data leak, but the state was
 * still one user's.
 *
 * The map is also bounded: an entry was added for every conversation
 * that ever used the command, and it was only ever removed by the
 * command that set it, so it grew for the life of the process.
 */
const activePersonaOverrides = new Map<string, number>();

/** How many overrides are kept. */
const MAX_ACTIVE_OVERRIDES = 500;

/** The key an override is held under. */
function overrideKey(userId: number, conversationKey: string): string {
  return `${userId}:${conversationKey}`;
}

/** Returns the persona id currently in effect for a conversation. */
export function getActivePersonaId(
  conversationKey: string,
  defaultPersonaId: number,
  userId?: number,
): number {
  if (userId === undefined) {
    // A caller that does not know whose conversation it is.
    for (const [key, value] of activePersonaOverrides) {
      if (key.endsWith(`:${conversationKey}`)) return value;
    }
    return defaultPersonaId;
  }
  return activePersonaOverrides.get(overrideKey(userId, conversationKey)) ?? defaultPersonaId;
}

/** Clears any session-scoped override for a conversation. */
export function clearActivePersona(conversationKey: string, userId?: number): void {
  if (userId === undefined) {
    for (const key of Array.from(activePersonaOverrides.keys())) {
      if (key.endsWith(`:${conversationKey}`)) activePersonaOverrides.delete(key);
    }
    return;
  }
  activePersonaOverrides.delete(overrideKey(userId, conversationKey));
}

/** Clears every session-scoped override (used on account disconnect). */
export function clearAllActivePersonas(userId?: number): void {
  if (userId === undefined) {
    activePersonaOverrides.clear();
    return;
  }
  for (const key of Array.from(activePersonaOverrides.keys())) {
    if (key.startsWith(`${userId}:`)) activePersonaOverrides.delete(key);
  }
}

export type CommandResult = {
  /** True when the command was recognised and handled. */
  handled: boolean;
  /** Reply text to send back to the user. */
  reply?: string;
};

/**
 * The help text, in the language the person is writing in.
 *
 * The command they typed is the only thing that says which language they
 * want, so that is what it decides.
 */
function commandHelp(locale: Locale): string {
  return copy(locale, "channels.commandHelp");
}

/**
 * Resolves a persona by name.
 *
 * Matching is tried in order: exact name, unique substring, unique prefix.
 * Ambiguity is reported rather than guessed.
 */
export function matchPersonaByName(
  personas: Array<Pick<Persona, "id" | "name">>,
  query: string,
): { kind: "exact" | "contains" | "prefix"; persona?: Persona; candidates?: string[] } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { kind: "exact" };

  const exact = personas.find((p) => p.name.toLowerCase() === needle);
  if (exact) return { kind: "exact", persona: exact as Persona };

  const contains = personas.filter((p) => p.name.toLowerCase().includes(needle));
  if (contains.length === 1) return { kind: "contains", persona: contains[0] as Persona };
  if (contains.length > 1) {
    return { kind: "contains", candidates: contains.map((p) => p.name) };
  }

  const prefixed = personas.filter((p) => p.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return { kind: "prefix", persona: prefixed[0] as Persona };
  if (prefixed.length > 1) {
    return { kind: "prefix", candidates: prefixed.map((p) => p.name) };
  }

  return { kind: "exact" };
}

/** Parses a command line into its command name and arguments. */
export function parseCommandLine(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const command = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  return { command, args };
}

/**
 * Handles a slash command.
 *
 * `defaultPersonaId` is the account's bound default persona; the session
 * override takes precedence when present.
 */
export async function handleCommand(params: {
  userId: number;
  /** Conversation identifier — the counterpart id on the channel. */
  conversationKey: string;
  text: string;
  defaultPersonaId: number;
  /**
   * Which channel the command arrived on.
   *
   * The wording of the messages names the channel, so the WeChat copy has
   * to stay exactly as it was before the channels were unified.
   */
  channel?: ChannelId;
  /** Sends the graduation letter to the user; resolves false on failure. */
  sendLetter?: (letter: string) => Promise<boolean>;
}): Promise<CommandResult> {
  const parsed = parseCommandLine(params.text);
  if (!parsed) return { handled: false };

  const { command, args } = parsed;

  // The language the person is writing in is the language they should be
  // answered in.
  const locale = detectLocale(params.text);

  switch (command) {
    case CHANNEL_COMMANDS.use.zh:
    case CHANNEL_COMMANDS.use.en: {
      if (!args) {
        return {
          handled: true,
          reply: copy(locale, "channels.useUsage", { help: commandHelp(locale) }),
        };
      }

      const all = await getPersonasByUserId(params.userId);
      const ready = all.filter((p) => p.analysisStatus === "ready");
      if (ready.length === 0) {
        return { handled: true, reply: copy(locale, "channels.noReadyPersona") };
      }

      const match = matchPersonaByName(ready, args);
      if (!match.persona) {
        if (match.candidates && match.candidates.length > 0) {
          return {
            handled: true,
            reply: copy(locale, "channels.ambiguousPersona", {
              query: args,
              candidates: match.candidates.join(locale === "en" ? ", " : "、"),
            }),
          };
        }
        return {
          handled: true,
          reply: copy(locale, "channels.personaNotFound", {
            query: args,
            available: ready.map((p) => p.name).join(locale === "en" ? ", " : "、"),
          }),
        };
      }

      const key = overrideKey(params.userId, params.conversationKey);
      // The oldest entry is let go when the map is full: an override
      // that has not been touched in a long time is not worth keeping
      // for ever.
      if (activePersonaOverrides.size >= MAX_ACTIVE_OVERRIDES && !activePersonaOverrides.has(key)) {
        const oldest = activePersonaOverrides.keys().next();
        if (!oldest.done) activePersonaOverrides.delete(oldest.value);
      }
      activePersonaOverrides.set(key, match.persona.id);
      return { handled: true, reply: copy(locale, "channels.switchedPersona", { name: match.persona.name }) };
    }

    case CHANNEL_COMMANDS.personas.zh:
    case CHANNEL_COMMANDS.personas.en: {
      const all = await getPersonasByUserId(params.userId);
      if (all.length === 0) {
        return { handled: true, reply: copy(locale, "channels.noPersonas") };
      }
      const activeId = getActivePersonaId(params.conversationKey, params.defaultPersonaId, params.userId);
      const lines = all.map((p) => {
        const marker = p.id === activeId ? copy(locale, "channels.personaListCurrent") : "";
        const ready = p.analysisStatus === "ready" ? "" : copy(locale, "channels.personaListAnalysing");
        return `- ${p.name}${ready}${marker}`;
      });
      return { handled: true, reply: [copy(locale, "channels.personaListHeading"), ...lines].join("\n") };
    }

    case CHANNEL_COMMANDS.current.zh:
    case CHANNEL_COMMANDS.current.en: {
      const all = await getPersonasByUserId(params.userId);
      const activeId = getActivePersonaId(params.conversationKey, params.defaultPersonaId, params.userId);
      const persona = all.find((p) => p.id === activeId);
      return {
        handled: true,
        reply: persona
          ? copy(locale, "channels.currentPersona", { name: persona.name })
          : copy(locale, "channels.noBoundPersona"),
      };
    }

    case CHANNEL_COMMANDS.graduate.zh:
    case CHANNEL_COMMANDS.graduate.en:
      return await handleGraduationCommand(params, locale);

    case CHANNEL_COMMANDS.help.zh:
    case CHANNEL_COMMANDS.help.en:
      return { handled: true, reply: commandHelp(locale) };

    default:
      // Unknown commands fall through to the normal conversation.
      return { handled: false };
  }
}

/**
 * Generates the farewell letter and completes the graduation.
 *
 * The letter is delivered over the channel when possible; if delivery fails
 * the user is told to read it on the web, where it is always persisted.
 */
async function handleGraduationCommand(
  params: {
    userId: number;
    conversationKey: string;
    defaultPersonaId: number;
    channel?: ChannelId;
    sendLetter?: (letter: string) => Promise<boolean>;
  },
  locale: Locale,
): Promise<CommandResult> {
  const personaId = getActivePersonaId(params.conversationKey, params.defaultPersonaId, params.userId);
  const all = await getPersonasByUserId(params.userId);
  const persona = all.find((p) => p.id === personaId);
  if (!persona) {
    return { handled: true, reply: copy(locale, "channels.noBoundPersona") };
  }
  if (persona.analysisStatus !== "ready") {
    return { handled: true, reply: copy(locale, "channels.stillAnalysing", { name: persona.name }) };
  }
  if (persona.graduationStatus === "graduated") {
    return {
      handled: true,
      reply: persona.farewellLetter
        ? copy(locale, "channels.alreadyGraduatedWithLetter", {
            name: persona.name,
            letter: persona.farewellLetter,
          })
        : copy(locale, "channels.alreadyGraduated", { name: persona.name }),
    };
  }
  if (persona.graduationStatus === "declined") {
    // A refusal is not a life sentence. It starts a cooldown, and after the
    // cooldown the user may come back and finish the goodbye — otherwise
    // the channel was a one-way door, with no way back but waking the
    // persona from the web.
    const offer = canOfferGraduation({
      status: persona.graduationStatus,
      suggestedAt: persona.graduationSuggestedAt,
      declinedAt: persona.graduationDeclinedAt,
    });
    if (!offer.allowed) {
      return { handled: true, reply: copy(locale, "channels.graduationPostponed", { name: persona.name }) };
    }
  }

  // Whether the graduation may happen at all is the user's choice.
  const mode = await getEffectiveGraduationMode({
    personaMode: persona.graduationMode,
    userId: params.userId,
  });
  if (mode === "off") {
    return { handled: true, reply: copy(locale, "channels.graduationModeOff", { name: persona.name }) };
  }

  // A persona the user asked to be left alone is not one to say goodbye to
  // just yet.
  const presence = getEffectivePresence({
    personaPresence: persona.presence,
    graduationStatus: persona.graduationStatus,
  });
  if (!mayReachOut(presence)) {
    return { handled: true, reply: copy(locale, "channels.personaIsQuiet", { name: persona.name }) };
  }

  // The thresholds exist to stop the app from deciding too early. In the
  // "manual" mode the user has already decided, so they do not apply.
  if (mode !== "manual") {
    // Re-check eligibility before honouring the request.
    //
    // The calendar is the user's own: the snapshots the emotion trend is
    // read from are filed under the user's day keys, and the web path
    // reads them on the user's clock. The channel path did not — so near
    // a day boundary the channel could say "now is not the time to say
    // goodbye" while the web said the opposite.
    const timezone = await getUserTimezone(params.userId);
    const recentEmotions = await getRecentEmotionTrend(personaId, params.userId, 14, timezone);
    const recentFreq = await getMessageCountInRange(personaId, params.userId, 7, 0, timezone);
    const prevFreq = await getMessageCountInRange(personaId, params.userId, 14, 7, timezone);
    const eligibility = checkGraduationEligibility({
      intimacyLevel: persona.intimacyLevel,
      recentEmotions,
      chatCount: persona.chatCount || 0,
      recentChatFrequency: recentFreq,
      previousChatFrequency: prevFreq,
      locale,
    });

    if (!eligibility.eligible && persona.graduationStatus !== "suggested") {
      return {
        handled: true,
        reply: copy(locale, "channels.notTimeToSayGoodbye", { reason: eligibility.reason }),
      };
    }
  }

  // The letter is written with the user's own provider, from the same
  // material the conversation would have had. Using the server's provider
  // meant a channel user with their own key got an error at the one moment
  // the product exists for. Whatever happens, the user gets a letter.
  const farewellLetter = await writeFarewellLetter({
    persona,
    userId: params.userId,
    locale,
  });

  await setGraduationStatus(personaId, params.userId, "graduated", farewellLetter);

  let delivered = false;
  if (params.sendLetter) {
    try {
      delivered = await params.sendLetter(farewellLetter);
    } catch (e) {
      console.error("[Channel] Failed to deliver farewell letter:", e);
    }
  }

  if (delivered) {
    return { handled: true, reply: farewellLetter };
  }

  // The wording names the channel. The WeChat copy has to stay exactly as it
  // was before the channels were unified.
  const channelName = copy(
    locale,
    params.channel === "wechat" ? "channels.channelNameWechat" : "channels.channelNameDefault",
  );
  return {
    handled: true,
    reply: copy(locale, "channels.letterSavedElsewhere", { letter: farewellLetter, channel: channelName }),
  };
}
