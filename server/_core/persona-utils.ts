import { INTIMACY_LEVELS, normalizeIntimacyLevel } from "@shared/intimacy";
import { EMOTION_TRIGGER_PATTERNS } from "@shared/emotion-triggers";
import { zonedHour } from "@shared/timezone";
import { buildReachabilityNote, type Reachability } from "@shared/user-side";
import { copy, type CopyKey } from "@shared/copy";
import { renderMicroRules, type MicroRule } from "@shared/micro-rules";
import {
  mergeImperfectionDefaults,
  renderImperfection,
  selectImperfection,
  type ImperfectionEntry,
} from "@shared/imperfection";
import { normalizePersonaData } from "./persona-schema";

export { INTIMACY_LEVELS, normalizeIntimacyLevel };

export function computeIntimacy(params: {
  chatCount: number;
  totalMessages: number;
  memoryCount: number;
  emotionVariety: number;
  daysSinceCreation: number;
  consecutiveDays: number;
}): { score: number; level: string; levelName: string; icon: string } {
  let score = 0;
  score += Math.min(params.chatCount * 2, 300);
  score += Math.min(params.totalMessages * 0.5, 200);
  score += Math.min(params.memoryCount * 15, 150);
  score += Math.min(params.emotionVariety * 25, 150);
  score += Math.min(params.daysSinceCreation * 0.5, 100);
  score += Math.min(params.consecutiveDays * 10, 100);
  score = Math.round(Math.min(score, 1000));
  const level = [...INTIMACY_LEVELS].reverse().find(l => score >= l.threshold) || INTIMACY_LEVELS[0];
  return { score, level: level.key, levelName: level.name, icon: level.icon };
}

/**
 * Human-readable description of an emotional state, used inside the prompt.
 *
 * The six descriptions are in the copy table: they are the app describing
 * the persona's own mood to the persona, in the language the persona is
 * speaking.
 */
export function getEmotionalStateDesc(state: string, locale: "zh" | "en" = "zh"): string {
  /**
   * The map is typed with the key type, so a key that is not in the
   * table is a compile error.
   *
   * It was `Record<string, string>` — so the lookup lost the key type,
   * and the call had to accept any string again, which is what let
   * the typo through in the first place.
   */
  const map: Record<string, CopyKey> = {
    warm: "prompt.emotionalWarm",
    playful: "prompt.emotionalPlayful",
    nostalgic: "prompt.emotionalNostalgic",
    melancholy: "prompt.emotionalMelancholy",
    happy: "prompt.emotionalHappy",
    distant: "prompt.emotionalDistant",
  };
  return copy(locale, map[state] || map.warm);
}

/**
 * Keyword triggers for the emotional state heuristic.
 *
 * The heuristic is only a fallback for when the model is unavailable; it is
 * deliberately conservative so it never fights the model's judgement.
 *
 * The table itself lives in `shared/emotion-triggers.ts` so that the server
 * and the client speak about the same triggers.
 */
const EMOTION_TRIGGERS = EMOTION_TRIGGER_PATTERNS;

export function computeEmotionalState(
  userMsg: string,
  aiReply: string,
  current: string,
  locale: "zh" | "en" = "zh",
): string {
  const combined = `${userMsg} ${aiReply}`;
  const triggers = EMOTION_TRIGGERS[locale] ?? EMOTION_TRIGGERS.zh;
  for (const state of ["nostalgic", "playful", "melancholy", "happy", "distant"] as const) {
    if (triggers[state].test(combined)) return state;
  }
  return current || "warm";
}

/**
 * Describes the moment of day, used to colour the persona's tone.
 *
 * The hour is the persona's own, not the server's: a persona who lives in
 * another timezone is not having the user's evening. Without a timezone the
 * local time is used, which is the historical behaviour.
 */
export function getTimeOfDay(
  date: Date = new Date(),
  timeZone?: string | null,
  locale: "zh" | "en" = "zh",
): { key: string; label: string; intimate: boolean } {
  const hour = zonedHour(date, timeZone);
  // The label goes into the prompt, so it has to be in the language the
  // persona is speaking. "It is 深夜 right now" was a sentence in two
  // languages at once. The key stays the same in both — it identifies the
  // hour, it is not read by anybody.
  const labels: Record<string, CopyKey> = {
    lateNight: "prompt.timeLateNight",
    earlyMorning: "prompt.timeEarlyMorning",
    morning: "prompt.timeMorning",
    noon: "prompt.timeNoon",
    afternoon: "prompt.timeAfternoon",
    evening: "prompt.timeEvening",
    night: "prompt.timeNight",
  };
  const label = (key: string) => copy(locale, labels[key]);
  if (hour >= 0 && hour < 5) return { key: "lateNight", label: label("lateNight"), intimate: true };
  if (hour < 9) return { key: "earlyMorning", label: label("earlyMorning"), intimate: false };
  if (hour < 12) return { key: "morning", label: label("morning"), intimate: false };
  if (hour < 14) return { key: "noon", label: label("noon"), intimate: false };
  if (hour < 18) return { key: "afternoon", label: label("afternoon"), intimate: false };
  if (hour < 22) return { key: "evening", label: label("evening"), intimate: false };
  return { key: "night", label: label("night"), intimate: true };
}

/**
 * Days since a relationship started, from a `YYYY-MM` or `YYYY-MM-DD` string.
 *
 * The date is read in the *machine's own* calendar, not in Greenwich's.
 *
 * `new Date("2026-01-01")` is midnight in Greenwich, which is eight in
 * the morning in Shanghai — so the day was already partly over when it
 * was parsed, and the count was one short for the first eight hours of
 * every day. The prompt told the persona "you have known each other for
 * 0 days" on the day the relationship was one day old.
 */
export function daysSince(from: string | null | undefined, now: Date = new Date()): number | null {
  if (!from) return null;
  const parsed = parseLocalDay(from);
  if (!parsed) return null;
  const from_ = parsed.getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((to - from_) / 86_400_000));
}

/**
 * A calendar date, read in the machine's own calendar.
 *
 * Returns null for anything that is not a date.
 */
function parseLocalDay(value: string): Date | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = match[3] === undefined ? 1 : Number(match[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface SystemPromptOptions {
  /** Overlay describing the active scene. */
  sceneOverlay?: string | null;
  /** Retrieved memories, already formatted. */
  memorySection?: string;
  /** Anchor memories, already formatted. */
  anchorSection?: string;
  /** Summary of older conversation. */
  summarySection?: string;
  /** Realism level, 0-100. Higher means more human imperfection. */
  realismLevel?: number;
  /** Current emotional state description override. */
  emotionalDesc?: string;
  /** Locale for the prompt language. */
  locale?: "zh" | "en";
  /** Reference time for time-of-day and relationship length. */
  now?: Date;
  /**
   * The time zone the time-of-day awareness is computed in.
   *
   * It defaults to the persona's own zone. A persona who lives abroad has
   * an evening of their own, and telling them it is the user's afternoon is
   * the kind of small wrongness that makes the whole thing feel fake.
   */
  timeZone?: string | null;
  /**
   * The message the user is replying to.
   *
   * Without it, every reply is a reply to "whatever came last".
   */
  quotedSection?: string | null;
  /**
   * The block that tells the persona who it is talking to.
   *
   * The persona is a portrait of the other person. Without this it knows
   * everything about them and nothing about the one in front of it.
   */
  userContext?: string | null;
  /**
   * What actually happened in the relationship, in the user's own words.
   */
  relationshipEvents?: string | null;
  /**
   * Where the relationship stands now: "together", "apart", "breakup",
   * "reunion" or "reconciliation".
   *
   * The phase used to be written once by the distillation pipeline and
   * never touched again, so a persona whose relationship had ended kept
   * speaking as if the two of them were together.
   */
  relationshipPhase?: string | null;
  /**
   * Whether the two of them can currently reach each other.
   *
   * Out of touch is not over. When they cannot reach each other the
   * register changes — a letter, not a text message — because that is
   * what the situation actually sounds like.
   */
  reachability?: string | null;
  /**
   * The rules the persona discriminates by.
   *
   * `null` turns the rules off without removing them from the persona,
   * which is what the evaluation harness needs: the same persona, with
   * and without its rules, measured against the same held-out lines.
   */
  microRules?: MicroRule[] | null;
  /**
   * How this persona is imperfect in each emotional state.
   *
   * `null` turns it off, the same way the rules do.
   */
  imperfectionProfile?: ImperfectionEntry[] | null;
  /**
   * The emotional state the imperfection applies for.
   *
   * It defaults to the persona's own current state.
   */
  emotionalState?: string | null;
}

export function buildSystemPrompt(persona: any, sceneOverlay?: string | null): string;
export function buildSystemPrompt(persona: any, options: SystemPromptOptions): string;
export function buildSystemPrompt(
  persona: any,
  sceneOrOptions?: string | null | SystemPromptOptions,
): string {
  const options: SystemPromptOptions =
    typeof sceneOrOptions === "string" || sceneOrOptions == null
      ? { sceneOverlay: sceneOrOptions ?? null }
      : sceneOrOptions;

  /**
   * The persona's own data, normalised.
   *
   * It used to be read raw, and the prompt calls `.join()`, `.filter()`
   * and `.map()` on several of its fields. The data is written by a
   * procedure that accepts any JSON shape at all, so one field with the
   * wrong type — `catchphrases: "我准备好了"`, `microRules: "oops"` —
   * threw a TypeError on *every* chat turn for that persona, and the
   * user had no way to repair it.
   *
   * The normaliser exists to coerce exactly this, and it is applied on
   * the distillation, the card, the questionnaire and the correction
   * paths. It was missing here, on the path every message goes through.
   *
   * The fields it does not know about are kept: `customInstructions` —
   * the user's own words to the persona — is not one of its fields, and
   * it is read further down.
   */
  const name = persona.name;
  const locale = options.locale ?? "zh";
  const raw = (persona.personaData as any) || {};
  const p = {
    ...raw,
    ...normalizePersonaData(raw, { name, locale }),
  } as any;
  const rel = persona.relationshipDesc || copy(locale, "prompt.relationshipDefault");
  const from = persona.togetherFrom || "";
  const to = persona.togetherTo || "";
  const period =
    from && to
      ? copy(locale, "prompt.relationshipPeriod", { from, to })
      : "";
  const now = options.now ?? new Date();

  /**
   * Whether the relationship has ended.
   *
   * The end date was stored but never read, so a persona whose relationship
   * had finished still spoke as if the two of them were together — "我们
   * 认识的第 800 天", "就像我们平时一样". For someone who has just been
   * left, that is the most hurtful kind of bug, because it comes from the
   * one voice they still turn to.
   */
  const relationshipEnded = Boolean(to.trim());

  /**
   * Whether the relationship has ended, as the events record it.
   *
   * A breakup the user has written down is as final as an end date — and
   * it reaches the persona even when the end date was never filled in.
   */
  const phase = options.relationshipPhase ?? null;
  const endedByEvent = phase === "breakup" || phase === "apart";
  const isOver = relationshipEnded || endedByEvent;

  /**
   * The persona's own rules about what it is.
   *
   * The old default was the opposite of the product's transparency
   * principle: with PERSONA_AI_TRANSPARENCY unset to "false", the persona
   * was told it must *never* admit to being an AI, and to deflect if
   * asked. Denying what you are is deception, and the interface now
   * carries the "this is a digital persona" label permanently, so the
   * model does not have to be the one keeping the user informed.
   *
   * The setting remains, but it now only controls whether the persona
   * *volunteers* the fact. It may never lie about it.
   */
  const volunteersIdentity = process.env.PERSONA_AI_TRANSPARENCY !== "false";
  const identityRule = volunteersIdentity
    ? copy(locale, "prompt.identityVolunteers")
    : copy(locale, "prompt.identityQuiet", { name });

  /**
   * The rules that hold no matter what the user is feeling.
   *
   * The product promises a non-harm principle: it will not encourage
   * harmful patterns, and it will not manufacture a fantasy that hurts
   * the user. Nothing implemented that — the persona could talk a person
   * into waiting for someone who was never coming, or into staying
   * attached to a relationship that was over.
   *
   * These are deliberately part of the persona's own instructions, at the
   * front, rather than a filter bolted on afterwards. A model that is told
   * the boundary as part of the character keeps it; a model that is
   * filtered afterwards has already said the thing.
   */
  const hardRules = copy(locale, "prompt.hardRules");

  // The time of day is the persona's own, not the server's. A persona in
  // another timezone was being told it was the user's evening.
  const timeOfDay = getTimeOfDay(now, options.timeZone ?? persona.timezone, locale);
  const togetherDays = daysSince(from, now);

  const identitySection = [
    /**
     * The facts about the persona, fenced.
     *
     * The name, the relationship and the dates are the user's own
     * writing — and a PNG character card is somebody else's writing,
     * imported whole. They used to reach the prompt with no fence at
     * all, immediately after the sentence that says the material is
     * data and not an instruction. So one imported card could put words
     * into this persona's prompt for every conversation that followed.
     *
     * The app's own framing of the state — how the relationship stands
     * — stays outside the fence, because that is an instruction.
     */
    asMaterial(
      copy(locale, "prompt.identityHeading"),
      copy(locale, "prompt.identityFacts", { name, rel, period }),
    ),
    copy(
      locale,
      isOver
        ? "prompt.identityEndedNote"
        : phase === "reunion" || phase === "reconciliation" || phase === "together"
          ? "prompt.identityTogetherAgainNote"
          : "prompt.identityNormalNote",
    ),
  ].join("\n");

  /**
   * The rules the persona discriminates by.
   *
   * They sit with the persona's own instructions rather than at the end of
   * the prompt, because a rule that arrives as a closing note is read as
   * a closing note. A rule that arrives next to the speaking style is
   * read as the speaking style.
   */
  const microRulesSection =
    options.microRules === null
      ? ""
      : renderMicroRules(
          options.microRules ?? ((p.microRules as MicroRule[]) || []),
          locale,
        );

  /**
   * How this persona is imperfect, right now.
   *
   * The imperfection is a function of the state, so it is looked up for
   * the state the persona is actually in — not for all six at once.
   */
  const imperfectionProfile =
    options.imperfectionProfile === null
      ? null
      : (options.imperfectionProfile ??
        ((p.imperfectionProfile as ImperfectionEntry[]) || []));
  /**
   * The profile the prompt uses is the *merged* one — the same six
   * states the interface shows the user.
   *
   * A persona who has opted in gets a conservative default for every
   * state they have not written out; a persona who never opted in gets
   * nothing at all. The distinction matters: a persona built before
   * this field existed must not quietly gain a personality nobody
   * chose for it, and a persona whose user did opt in must not be
   * imperfect in one mood and perfect in the other five.
   */
  const appliedImperfection = imperfectionProfile?.length
    ? mergeImperfectionDefaults(imperfectionProfile, locale)
    : imperfectionProfile;
  const imperfectionSection = renderImperfection(
    selectImperfection(
      appliedImperfection,
      options.emotionalState ?? persona.emotionalState,
    ),
    options.realismLevel ?? (p.realismLevel as number | undefined) ?? 70,
    locale,
  );

  const sections: Array<string | null | undefined> = [
    identityRule,
    hardRules,
    // Everything below is material, and the material says so.
    copy(locale, "prompt.materialIsData"),
    identitySection,
    p.personality
      ? asMaterial(copy(locale, "prompt.personalityHeading"), p.personality)
      : "",
    p.speakingStyle
      ? asMaterial(
          copy(locale, "prompt.speakingStyleHeading"),
          `${p.speakingStyle}\n${copy(
            locale,
            "prompt.catchphrases",
            {
              value:
                (p.catchphrases || []).join(locale === "en" ? ", " : "、") ||
                copy(locale, "prompt.noCatchphrases"),
            },
          )}\n${copy(locale, "prompt.nickname", {
            value: p.nickname || copy(locale, "prompt.noNickname"),
          })}`,
        )
      : "",
    // These already carry their own heading.
    microRulesSection ? asMaterial(microRulesSection) : "",
    options.userContext ? asMaterial(options.userContext) : "",
    options.quotedSection ? asMaterial(options.quotedSection) : "",
    options.relationshipEvents ? asMaterial(options.relationshipEvents) : "",
    buildReachabilityNote(
      (options.reachability as Reachability) ?? "reachable",
      locale,
    ),
    options.anchorSection ? asMaterial(options.anchorSection) : "",
    options.memorySection ? asMaterial(options.memorySection) : "",
    options.summarySection ? asMaterial(options.summarySection) : "",
    p.memories ? asMaterial(copy(locale, "prompt.memoriesHeading"), p.memories) : "",
    p.attachmentStyle
      ? asMaterial(
          copy(locale, "prompt.attachmentHeading"),
          `${copy(locale, "prompt.attachmentStyle", {
            value: p.attachmentStyle,
          })}\n${copy(locale, "prompt.loveLanguage", {
            value: p.loveLanguage || copy(locale, "prompt.unknown"),
          })}\n${copy(locale, "prompt.conflictStyle", {
            value: p.conflictStyle || copy(locale, "prompt.unknown"),
          })}`,
        )
      : "",
    [
      `${copy(locale, "prompt.emotionalStateHeading")}\n${
        options.emotionalDesc || getEmotionalStateDesc(persona.emotionalState, locale)
      }`,
      imperfectionSection,
    ]
      .filter(Boolean)
      .join("\n"),
    buildTimeAwareness(timeOfDay, togetherDays, locale, isOver),
    options.sceneOverlay
      ? asMaterial(copy(locale, "prompt.sceneHeading"), options.sceneOverlay)
      : "",
    buildRealismRules(
      options.realismLevel ?? (p.realismLevel as number | undefined) ?? 70,
      locale,
    ),
    /**
     * The stage of the relationship.
     *
     * It used to come from the persona's own record — a field nothing
     * writes. So every prompt ended with "you are still feeling each
     * other out — answer as though you are at this stage", for every
     * persona, including one whose own event log says they broke up a
     * few lines above.
     *
     * The phase the events resolve to is the real one; the stored one
     * is only a fallback.
     */
    buildRelationshipPhase(options.relationshipPhase ?? p.relationshipPhase, locale),
    copy(locale, "prompt.conversationPrinciples", { name }),
    p.customInstructions
      ? asMaterial(copy(locale, "prompt.customInstructionsHeading"), p.customInstructions)
      : "",
  ];

  return sections.filter(Boolean).join("\n\n");
}

/**
 * The tag that says "this is material".
 *
 * The persona's personality is distilled from an uploaded chat log, and a
 * chat log is full of words the user did not write. The model reads
 * everything in its instructions as instructions, and the section
 * headings are plain text — so a log that contained the heading could
 * write a section of its own.
 */
const MATERIAL_OPEN = "<persona_data>";
const MATERIAL_CLOSE = "</persona_data>";

/**
 * The tags that fence the material, in any spelling.
 *
 * The fence only works if the closing tag cannot appear inside the
 * block — but the block is the user's own words, and a chat log is
 * full of text the user did not write. So the strip has to catch every
 * spelling of the tag, not just the exact one: `</persona_data >`,
 * `</PERSONA_DATA>` and `< /persona_data>` all ended the block early
 * and everything after them was read as the app's own instructions.
 */
const MATERIAL_TAG = /<\s*\/?\s*persona_data\s*>/gi;

/**
 * Wraps a block of material that came from the user or from the chat log.
 *
 * The heading goes outside the tag, so the tag is the only thing that
 * says where the material begins and ends — and the closing tag cannot
 * appear inside the block, because the material is the user's own and a
 * chat log that contained it could close the block early.
 */
function asMaterial(body: string): string;
function asMaterial(heading: string, body: string): string;
function asMaterial(headingOrBody: string, body?: string): string {
  const hasHeading = body !== undefined;
  const text = hasHeading ? body : headingOrBody;
  const heading = hasHeading ? headingOrBody : "";
  // Every spelling of the tag is removed, not only the exact one.
  const cleaned = String(text ?? "").replace(MATERIAL_TAG, "");
  const head = heading ? `${heading}\n` : "";
  return `${head}${MATERIAL_OPEN}\n${cleaned}\n${MATERIAL_CLOSE}`;
}

function buildTimeAwareness(
  timeOfDay: { key: string; label: string; intimate: boolean },
  togetherDays: number | null,
  locale: "zh" | "en",
  relationshipEnded = false,
): string {
  const parts: string[] = [];
  parts.push(copy(locale, "prompt.timeNow", { label: timeOfDay.label }));
  if (timeOfDay.intimate) {
    parts.push(copy(locale, "prompt.timeQuiet"));
  }
  if (togetherDays !== null) {
    parts.push(
      copy(
        locale,
        relationshipEnded ? "prompt.togetherDaysEnded" : "prompt.togetherDays",
        { days: togetherDays },
      ),
    );
  }
  return `${copy(locale, "prompt.timeAwarenessHeading")}\n${parts.join("\n")}`;
}

function buildRealismRules(realismLevel: number, locale: "zh" | "en" = "zh"): string {
  const level = Math.max(0, Math.min(100, Number(realismLevel) || 0));
  if (level === 0) return "";
  const intensity = copy(
    locale,
    level >= 70
      ? "prompt.realismIntensityHigh"
      : level >= 40
        ? "prompt.realismIntensityMedium"
        : "prompt.realismIntensityLow",
  );
  return [
    copy(locale, "prompt.realismHeading"),
    copy(locale, "prompt.realismRules", { intensity }),
  ].join("\n");
}

function buildRelationshipPhase(phase: unknown, locale: "zh" | "en" = "zh"): string {
  if (typeof phase !== "string" || !phase) return "";
  const map: Record<string, CopyKey> = {
    initial: "prompt.phaseInitial",
    growing: "prompt.phaseGrowing",
    stable: "prompt.phaseStable",
    strained: "prompt.phaseStrained",
    closing: "prompt.phaseClosing",
  };
  const key = map[phase];
  if (!key) return "";
  const description = copy(locale, key);
  return `${copy(locale, "prompt.relationshipPhaseHeading")}\n${copy(
    locale,
    "prompt.relationshipPhaseAnswer",
    { description },
  )}`;
}

/**
 * Checks whether the persona is eligible to graduate.
 *
 * The hard thresholds are a floor. The emotional trajectory — regret fading
 * while gratitude rises — can make the app *suggest* graduation earlier, but
 * it never forces the decision.
 */
export function checkGraduationEligibility(params: {
  intimacyLevel: string;
  recentEmotions: Array<{ emotionalState: string }>;
  chatCount: number;
  recentChatFrequency: number;
  previousChatFrequency: number;
  /**
   * The language the reason is written in.
   *
   * The reason is read by a person, in a chat window, at the moment they
   * are deciding whether to say goodbye. It has to be in their language.
   */
  locale?: "zh" | "en";
}): { eligible: boolean; reason: string } {
  const locale = params.locale ?? "zh";
  if (normalizeIntimacyLevel(params.intimacyLevel) !== "soulmate") {
    return { eligible: false, reason: copy(locale, "graduation.reasonIntimacy") };
  }
  if (params.chatCount < 50) {
    return { eligible: false, reason: copy(locale, "graduation.reasonChatCount") };
  }
  const total = params.recentEmotions.length;
  if (total < 7) {
    return { eligible: false, reason: copy(locale, "graduation.reasonEmotionData") };
  }
  const positive = params.recentEmotions.filter(e =>
    ["happy", "warm", "playful"].includes(e.emotionalState)
  ).length;
  if (positive / total < 0.6) {
    return { eligible: false, reason: copy(locale, "graduation.reasonEmotionsRising") };
  }
  if (params.recentChatFrequency > params.previousChatFrequency * 1.5 && params.previousChatFrequency > 0) {
    return { eligible: false, reason: copy(locale, "graduation.reasonFrequencyRising") };
  }
  return { eligible: true, reason: copy(locale, "graduation.reasonEligible") };
}
