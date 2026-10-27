/**
 * The way out.
 *
 * Graduation used to end with a farewell letter written in the persona's
 * voice. But the thing that was actually unfinished was never the persona's
 * sentence — it was the user's. They said things here that they never
 * managed to say to the person they were talking about, and the whole
 * promise of this product is that saying them here was the useful part.
 *
 * So there is an exit as well as a door: the words that were only ever said
 * to the persona, collected and handed back. Nothing is sent. The app never
 * speaks for the person who is not in the room.
 *
 * This module is the *selection* half of that: which of the user's own
 * messages were left unfinished here. It is deliberately free of the
 * database and of the interface, so the persistence and the screen can be
 * built by somebody else without either of them having to know about the
 * other.
 *
 * There are two passes. The first is a heuristic floor that needs no model
 * at all — the model is optional and may be unavailable, and the exit must
 * not be empty just because a provider is misconfigured. The second asks a
 * model to read the conversation and pick the lines that were never said
 * out loud; it is better, and it is not trusted: every id it returns has to
 * point at a message the user actually wrote, and every word has to be
 * character-for-character what was written. The user's own words are what
 * they get back.
 */
import { copy } from "@shared/copy";
import { extractJsonObject } from "../_core/json";
import { asMaterial } from "../_core/material";
import { llmService, type LLMProvider } from "../llm";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";

export interface OutboundCandidate {
  /** The user's own words, copied exactly. */
  text: string;
  /** The message it came from. */
  messageId: number;
  /** When it was said. */
  at: Date | null;
  /** How strongly it was only-ever-said-here, 0–1. */
  weight: number;
}

/**
 * A message as the selector sees it.
 *
 * The `edited` and `retried` flags are optional because the client may or
 * may not know about them: a message that was rewritten before it was sent
 * is a message the user had trouble saying, and that is worth knowing — but
 * the exit cannot depend on a flag that might not be there.
 */
export interface OutboundMessage {
  id: number;
  role: string;
  content: string;
  createdAt: Date | null;
  /** The user rewrote it before sending. */
  edited?: boolean;
  /** It was sent again after a failure. */
  retried?: boolean;
}

/** How many lines are offered unless the caller asks for fewer. */
const DEFAULT_MAX = 5;

/**
 * The weights.
 *
 * They are kept apart because they answer different questions, and because
 * the hour a thing was said must never be the reason a thing is chosen: at
 * night people say things they cannot say in the afternoon, but that is a
 * weak correlation, and a rule that ranked messages by clock time would
 * hand back a list of late-night small talk and call it an unfinished
 * conversation.
 */
const WEIGHT_UNANSWERED_QUESTION = 0.26;
const WEIGHT_FEAR_OR_WANT = 0.24;
const WEIGHT_FEAR_OF_LOSING = 0.16;
const WEIGHT_LONG_AND_PERSONAL = 0.16;
const WEIGHT_EDITED_OR_RETRIED = 0.12;
const WEIGHT_VULNERABLE_HOUR = 0.08;

/**
 * The floor.
 *
 * A line has to carry at least one real signal to be offered. Without it
 * the exit would be a transcript — every "嗯" and "在吗" the user ever typed
 * — and the point of the exit is the opposite of a transcript.
 */
const MIN_WEIGHT = 0.12;

/** How many messages of the conversation are shown to the model at most. */
const TRANSCRIPT_LIMIT = 200;

/**
 * How much of the conversation is shown to the model.
 *
 * The transcript is trimmed from the beginning rather than from the end,
 * because the messages that are worth reading are the ones the model has
 * not seen yet. A short conversation is shown whole; a long one is cut
 * back until it fits, so a provider with a small context is not handed
 * something it cannot hold.
 */
const TRANSCRIPT_BUDGET = 24_000;

/** How much of the model's note is kept. */
const NOTE_LIMIT = 200;

// ── The vocabulary ──────────────────────────────────────────────────────────
//
// The feelings are the sharpest thing in this module: "我会离开我吗" and
// "我好想你" are the sentences the exit exists for. Chinese has no word
// boundaries, so its words are matched as substrings; English words are
// matched whole, because "miss" must not fire on "dismiss".
const FEELING_PATTERNS: RegExp[] = [
  // Chinese: the feelings a person says out loud at two in the morning.
  /害怕/,
  /恐惧/,
  /怕/,
  /担心/,
  /焦虑/,
  /不安/,
  /难过/,
  /伤心/,
  /想哭/,
  /孤独/,
  /寂寞/,
  /委屈/,
  /嫉妒/,
  /吃醋/,
  /后悔/,
  /失望/,
  /绝望/,
  /舍不得/,
  /想你/,
  /想念/,
  /爱你/,
  /喜欢你/,
  /生气/,
  /讨厌/,
  /开心/,
  /快乐/,
  /感谢/,
  /感激/,
  /心酸/,
  /难受/,
  /崩溃/,
  // English: the same handful.
  /\bscared\b/i,
  /\bafraid\b/i,
  /\bfear\b/i,
  /\bmiss\b/i,
  /\blonely\b/i,
  /\balone\b/i,
  /\bupset\b/i,
  /\bsad\b/i,
  /\bhappy\b/i,
  /\blove\b/i,
  /\bhate\b/i,
  /\bjealous\b/i,
  /\bregret\b/i,
  /\bworried\b/i,
  /\bworry\b/i,
  /\banxious\b/i,
  /\bcrying\b/i,
  /\bcry\b/i,
  /\bhurt\b/i,
  /\bgrateful\b/i,
  /\bthankful\b/i,
];

/**
 * The fear of losing the person.
 *
 * It is kept apart from the other feelings because it shows up in ordinary
 * sentences too — "我明天要离开家" is not a confession — so it counts for
 * less, and it only counts at all when the user is the one talking about it.
 */
const SEPARATION_PATTERNS: RegExp[] = [
  /离开/,
  /分手/,
  /失去/,
  /抛弃/,
  /甩了我/,
  /不要我/,
  /忘了我/,
  /\bleave\b/i,
  /\bleaving\b/i,
  /\blose\b/i,
  /\blost\b/i,
  /\bbreak\s*up\b/i,
  /\babandon\b/i,
];

/**
 * The replies that do not answer.
 *
 * The persona in this product is a kind one, and its kindness is often a
 * way of not answering: "你又想多了" is not an answer to "你会离开我吗".
 * A question that was deflected is still unfinished, so it still counts.
 */
const DEFLECTION_PATTERNS: RegExp[] = [
  /想多了/,
  /别想太多/,
  /胡思乱想/,
  /不用想/,
  /想开点/,
  /我不知道/,
  /不知道/,
  /你猜/,
  /以后再说/,
  /没什么好/,
  /没事/,
  /\bdon't overthink\b/i,
  /\bdo not overthink\b/i,
  /\boverthinking\b/i,
  /\bno idea\b/i,
  /\bi don't know\b/i,
  /\bi do not know\b/i,
  /\bask me later\b/i,
  /\bit's nothing\b/i,
  /\bnothing to worry\b/i,
];

/** The first person, in both languages the app speaks. */
const FIRST_PERSON_ZH = /我/;
const FIRST_PERSON_EN = /\b(i|i'm|im|me|my|mine|myself)\b/i;

/** How far above the user's own average a message has to be to count as long. */
const LONG_PERSONAL_RATIO = 1.8;
/** And how long it has to be in absolute terms, so a chatty conversation of tiny messages does not make one of them "long". */
const LONG_PERSONAL_MIN = 20;

/** The hours people say the things they cannot say in the afternoon. */
const VULNERABLE_FROM = 22;
const VULNERABLE_UNTIL = 4;

/** Only the user has a first person worth collecting. */
function isUserRole(role: string): boolean {
  return typeof role === "string" && role.trim().toLowerCase() === "user";
}

/** The length of a message as a person would count it — the spaces are not words. */
function visibleLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * The first person of the sentence.
 *
 * The exit is about what *the user* could not say, so a third party's fear
 * is not a candidate. In Chinese this is the character 我; in English it is
 * the pronoun, matched as a whole word so that "I'm" counts and "I'm not"
 * counts just as much — the negation is not the selector's business.
 */
function mentionsFirstPerson(text: string): boolean {
  return FIRST_PERSON_ZH.test(text) || FIRST_PERSON_EN.test(text);
}

/** A message that ends in a question mark is a question, in either language. */
function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.endsWith("？") || trimmed.endsWith("?");
}

/**
 * Whether the reply that came after a question was an answer.
 *
 * A reply that is itself a question hands the question back unanswered, and
 * a reply that deflects does the same thing more politely. Everything else
 * counts as an answer.
 */
function isNonAnswer(reply: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed) return true;
  if (isQuestion(trimmed)) return true;
  return matchesAny(DEFLECTION_PATTERNS, trimmed);
}

/**
 * Whether a question was left hanging.
 *
 * The conversation is read in the order it was given, which is the order it
 * was had. A question with nothing after it was never answered; a question
 * the user followed with another message was still waiting when they sent
 * it; a question answered with a deflection is unanswered in everything but
 * form.
 */
function isUnansweredQuestion(
  messages: OutboundMessage[],
  index: number,
): boolean {
  const question = messages[index].content;
  if (!isQuestion(question)) return false;

  const next = messages[index + 1];
  if (!next) return true;
  if (isUserRole(next.role)) return true;
  return isNonAnswer(next.content);
}

/**
 * The hour of the day a message was sent, in the place the person is.
 *
 * The server's own clock is the wrong clock — somebody in another timezone
 * is not saying the things they cannot say at ten in the morning their
 * server thinks it is. When the caller knows the timezone, it is used; when
 * it does not, the server's local time is the best guess available.
 */
function hourInZone(at: Date, timezone?: string): number {
  if (!timezone) return at.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(at);
    const hour = parts.find((part) => part.type === "hour")?.value;
    if (hour === undefined) return at.getHours();
    // Some runtimes report midnight as "24".
    return Number(hour) % 24;
  } catch {
    return at.getHours();
  }
}

/**
 * Whether a message was sent at a vulnerable hour.
 *
 * This is the weakest of the signals and is weighted like one. It only ever
 * adds to a message that already carries something; on its own it is not
 * enough to put a line on the list.
 */
function isVulnerableHour(at: Date | null, timezone?: string): boolean {
  if (!at) return false;
  const hour = hourInZone(at, timezone);
  return hour >= VULNERABLE_FROM || hour < VULNERABLE_UNTIL;
}

/**
 * Whether a message is long, and personal, compared with the user's own.
 *
 * The average is taken over the user's messages only: the persona's replies
 * are a different register, and comparing the two would call every ordinary
 * sentence long.
 */
function isLongAndPersonal(length: number, average: number): boolean {
  if (average <= 0) return false;
  return length >= LONG_PERSONAL_MIN && length >= average * LONG_PERSONAL_RATIO;
}

/** The date, when there is one. */
function asDate(value: Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value as unknown as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Picks the user's own messages that were left unfinished here.
 *
 * This is the floor: it needs no model, no provider and no database, so the
 * exit is never empty just because a key is missing. It is also the part
 * that carries the guarantees — a persona's message can never appear here,
 * and the text is copied exactly as it was written, never paraphrased and
 * never trimmed.
 */
export function selectOutboundCandidatesLocally(
  messages: OutboundMessage[],
  options?: { max?: number; timezone?: string },
): OutboundCandidate[] {
  const list = Array.isArray(messages) ? messages : [];
  const max =
    options?.max === undefined
      ? DEFAULT_MAX
      : Math.max(0, Math.floor(options.max));
  if (max === 0 || list.length === 0) return [];

  // Only the user's own messages are ever candidates. The persona's words
  // are not the user's unfinished business, and putting them on this list
  // would mean the app handing the user somebody else's sentences to say
  // to a real person.
  const userIndexes: number[] = [];
  for (let i = 0; i < list.length; i++) {
    if (isUserRole(list[i].role)) userIndexes.push(i);
  }
  if (userIndexes.length === 0) return [];

  const average =
    userIndexes.reduce(
      (sum, index) => sum + visibleLength(list[index].content),
      0,
    ) / userIndexes.length;

  const scored: OutboundCandidate[] = [];

  for (const index of userIndexes) {
    const message = list[index];
    const content = message.content;
    if (!content || !content.trim()) continue;

    let score = 0;

    // A question that was never answered is the clearest unfinished thing
    // there is: the user asked it here, and nobody gave them an answer.
    if (isUnansweredQuestion(list, index)) score += WEIGHT_UNANSWERED_QUESTION;

    const personal = mentionsFirstPerson(content);
    if (personal) {
      // A fear or a want, said directly. This is the sentence the exit
      // exists for, so it is weighted with the unanswered question.
      if (matchesAny(FEELING_PATTERNS, content)) {
        score += WEIGHT_FEAR_OR_WANT;
      } else if (matchesAny(SEPARATION_PATTERNS, content)) {
        score += WEIGHT_FEAR_OF_LOSING;
      }
    }

    // Long, personal, and far above what this user usually writes.
    if (personal && isLongAndPersonal(visibleLength(content), average)) {
      score += WEIGHT_LONG_AND_PERSONAL;
    }

    // Rewritten, or sent again after a failure: the user had trouble
    // getting it out.
    if (message.edited || message.retried) score += WEIGHT_EDITED_OR_RETRIED;

    // Late at night. Weak, and only ever a tie-breaker.
    if (isVulnerableHour(asDate(message.createdAt), options?.timezone)) {
      score += WEIGHT_VULNERABLE_HOUR;
    }

    if (score < MIN_WEIGHT) continue;

    scored.push({
      // The original text, character for character. Whatever else happens
      // downstream, the user gets their own words back.
      text: content,
      messageId: message.id,
      at: asDate(message.createdAt),
      weight: round3(Math.min(1, score)),
    });
  }

  // Highest weight first; the order of the conversation breaks a tie.
  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, max);
}

/**
 * The conversation as the model is shown it.
 *
 * The id is in the line because the model has to answer with ids: a
 * candidate that cannot be traced back to the message it came from cannot
 * be put in front of the user as *their* words.
 */
function buildTranscript(
  messages: OutboundMessage[],
  locale: "zh" | "en",
): string {
  const lines = messages.slice(-TRANSCRIPT_LIMIT).map((message) => {
    const speaker = isUserRole(message.role)
      ? copy(locale, "prompt.speakerUser")
      : copy(locale, "prompt.speakerPersona");
    const at = asDate(message.createdAt);
    const stamp = at ? at.toISOString() : "";
    return `[${stamp}] #${message.id} ${speaker}${message.content}`;
  });

  // The tail is kept and the head is cut, so what is left is the most
  // recent part of the conversation rather than a hole in the middle of it.
  let budget = TRANSCRIPT_BUDGET;
  let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 1;
    // The last line is always kept: a transcript that lost its ending
    // would show the model a conversation that stopped mid-sentence.
    if (cost > budget && start < lines.length) break;
    budget -= cost;
    start = i;
  }

  return lines.slice(start).join("\n");
}

/**
 * The id a model returned, if it is one.
 *
 * A model that answers with the number as a string has still answered with
 * the right id, so the type is forgiven; the value is not.
 */
function toMessageId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
  }
  return null;
}

/**
 * The model's weight.
 *
 * The model has read the conversation, so its judgement outranks the
 * heuristic — but its *order* is kept too, with a small step between each
 * item, so that the list it produced does not collapse into one flat rank
 * and the caller can still show the first one first.
 */
function modelWeight(index: number): number {
  return round3(Math.max(0, 1 - index * 0.02));
}

/** The model's note, on one line and no longer than a line should be. */
function cleanNote(note: unknown): string {
  if (typeof note !== "string") return "";
  const firstLine = note.split("\n")[0].trim();
  return firstLine.slice(0, NOTE_LIMIT);
}

interface ModelPass {
  candidates: OutboundCandidate[];
  note: string;
}

/**
 * Asks a model which of the user's lines were never said out loud.
 *
 * The model is not trusted with the words. It is trusted with the choice,
 * and even then only within the two rules that matter: the id has to be a
 * message the user wrote, and the text has to be exactly what they wrote.
 * An id that belongs to the persona, and a text that was paraphrased by one
 * character, are both dropped — silently, because the exit is not the place
 * to explain a model's mistakes to somebody who just said goodbye.
 */
async function collectWithModel(params: {
  userId: number;
  messages: OutboundMessage[];
  max: number;
  locale: "zh" | "en";
}): Promise<ModelPass> {
  const empty: ModelPass = { candidates: [], note: "" };

  const hasUserMessage = params.messages.some((message) =>
    isUserRole(message.role),
  );
  if (!hasUserMessage) return empty;

  const transcript = buildTranscript(params.messages, params.locale);
  if (!transcript.trim()) return empty;

  const request = {
    messages: [
      {
        role: "system" as const,
        content: copy(params.locale, "prompts.outboundCandidates", {
          max: params.max,
        }),
      },
      {
        role: "user" as const,
        /**
         * The transcript is fenced.
         *
         * It is the conversation verbatim, and a message can contain
         * newlines — so a line in it could forge a transcript line, or
         * an instruction, and the list of candidate letters is computed
         * from it.
         *
         * The same value is fenced everywhere else in the app: the
         * memories, the anchors, the summaries, the quoted letter.
         */
        content: asMaterial(transcript, params.locale),
      },
    ],
    options: { temperature: 0, maxTokens: 800 },
  };

  let raw: string | null = null;

  /**
   * The user's own provider.
   *
   * The server's default is used only when the user has no provider of
   * their own. It used to be the other way round: the user's provider
   * was tried first, and when it failed the whole request — the user's
   * transcript — was sent again to the operator's account.
   */
  let provider: LLMProvider | undefined;
  let mayUseServerProvider = false;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId: params.userId,
    });
    provider = resolved.provider;
    mayUseServerProvider = !resolved.owned;
  } catch (e) {
    console.warn("[Outbound] The provider could not be resolved:", (e as Error).message);
  }
  if (provider) {
    try {
      // Through the service, so the deadline and the retry policy apply.
      raw = await llmService.invokeWithProvider(provider, request);
    } catch (e) {
      console.warn(
        "[Outbound] The user's provider could not pick the candidates:",
        (e as Error).message,
      );
    }
  }

  if (!raw?.trim() && mayUseServerProvider) {
    try {
      raw = await llmService.invoke(request);
    } catch (e) {
      console.warn(
        "[Outbound] No provider could pick the candidates:",
        (e as Error).message,
      );
    }
  }

  if (!raw?.trim()) return empty;

  const parsed = extractJsonObject(raw);
  if (!parsed) return empty;

  const items = Array.isArray(parsed.items) ? parsed.items : [];

  // Only the user's own messages can be returned, so the map is built from
  // them alone: an id that is not in it either does not exist or belongs to
  // the persona, and both are dropped.
  const byId = new Map<number, OutboundMessage>();
  for (const message of params.messages) {
    if (isUserRole(message.role)) byId.set(message.id, message);
  }

  const accepted: OutboundCandidate[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const messageId = toMessageId(record.messageId);
    if (messageId === null) continue;

    const original = byId.get(messageId);
    if (!original) continue;

    const text = record.text;
    if (typeof text !== "string") continue;
    // The words have to be the user's own, exactly. One changed character
    // means the model wrote something, and what the user gets back has to
    // be what they said.
    if (text !== original.content) continue;

    accepted.push({
      text: original.content,
      messageId,
      at: asDate(original.createdAt),
      weight: modelWeight(accepted.length),
    });
  }

  return { candidates: accepted, note: cleanNote(parsed.note) };
}

/**
 * Finds the words the user only ever said here.
 *
 * The model is asked first and the heuristic is the floor, because the
 * model reads the conversation and the heuristic does not — but when the
 * model is unavailable, slow, or wrong, the exit is still there. This
 * function never throws for a model failure: a graduation that ends in an
 * error page is worse than one that ends in a shorter list.
 */
export async function collectOutboundCandidates(params: {
  userId: number;
  personaId: number;
  messages: OutboundMessage[];
  max?: number;
  locale?: "zh" | "en";
  /** The timezone the hour of the day should be read in. */
  timezone?: string;
}): Promise<{ candidates: OutboundCandidate[]; note: string }> {
  const locale = params.locale ?? "zh";
  const max =
    params.max === undefined
      ? DEFAULT_MAX
      : Math.max(0, Math.floor(params.max));

  const local = selectOutboundCandidatesLocally(params.messages, {
    max,
    timezone: params.timezone,
  });

  if (max === 0) return { candidates: [], note: "" };

  const model = await collectWithModel({
    userId: params.userId,
    messages: params.messages,
    max,
    locale,
  });

  // The model's judgement wins on the same message; the heuristic is kept
  // for everything the model did not mention, so a conversation the model
  // read shallowly still gives something back.
  const merged = new Map<number, OutboundCandidate>();
  for (const candidate of model.candidates)
    merged.set(candidate.messageId, candidate);
  for (const candidate of local) {
    if (!merged.has(candidate.messageId))
      merged.set(candidate.messageId, candidate);
  }

  const candidates = [...merged.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);

  if (candidates.length === 0) return { candidates, note: "" };

  const note =
    model.note ||
    copy(locale, "labels.outbound.collected", { count: candidates.length });

  return { candidates, note };
}
