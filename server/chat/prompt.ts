/**
 * The prompt a persona is given.
 *
 * There has to be exactly one way to build it. The conversation builds
 * it in one place and the "what does the system think" query built it
 * in another — so the prompt a user inspected was not the prompt the
 * model was working from.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { buildUserContextBlock, buildRelationshipSection, resolveRelationshipPhase, isUserMood } from "@shared/user-side";
import { copy } from "@shared/copy";
import type { MicroRule } from "@shared/micro-rules";
import type { ImperfectionEntry } from "@shared/imperfection";

export interface PromptContext {
  persona: Persona;
  userId: number;
  userMessage?: string;
  locale?: "zh" | "en";
  now?: Date;
  /** The scene overlay, when a scene is active. */
  sceneOverlay?: string | null;
  /**
   * The state the prompt is describing.
   *
   * It is not always the persona's stored state: a scene can set the
   * mood the persona speaks in. The imperfection follows whatever mood
   * the prompt *states* — a prompt that says "you are distant" and then
   * applies the deviations of "happy" is telling the model two different
   * things at once.
   */
  emotionalState?: string | null;
  emotionalDesc?: string;
  /** A summary the caller already computed. */
  summarySection?: string;
  /** Memories the caller already retrieved. */
  memories?: Parameters<typeof formatAnchorsForPrompt>[0];
  /**
   * Whether the retrieved memories are marked as recalled.
   *
   * A read — looking at the prompt — is not a conversation. Marking the
   * memories as recalled halves their weight for a day, so a preview
   * used to take the user's own pinned memories and anchors down to
   * half their weight every time they opened it.
   */
  markRecalled?: boolean;
  /** The message the user is replying to. */
  quotedSection?: string | null;
  /**
   * The rules the persona discriminates by.
   *
   * `null` turns them off for this prompt without touching the persona.
   * The evaluation harness needs that: the same persona, measured with
   * and without its rules, against the same held-out lines.
   */
  microRules?: MicroRule[] | null;
  /**
   * The per-state imperfection.
   *
   * `null` turns it off, the same way the rules do.
   */
  imperfectionProfile?: ImperfectionEntry[] | null;
}

/**
 * Assembles the full system prompt.
 */
export async function buildPromptForPersona(
  context: PromptContext,
): Promise<string> {
  const { persona, userId } = context;
  const locale = context.locale ?? "zh";
  const now = context.now ?? new Date();

  const memories = context.memories ?? await retrieveMemories({
    personaId: persona.id,
    userId,
    userMessage: context.userMessage ?? "",
    /**
     * Whether the memories are marked as recalled.
     *
     * Looking at the prompt is a read, not a conversation. It used to
     * mark the memories as recalled — and a memory that has just been
     * recalled has its weight halved for a day — so the user's own
     * pinned memories and anchors lost half their weight every time
     * they opened the prompt.
     */
    markRecalled: context.markRecalled,
  }).catch(() => []);
  const anchors = memories.filter((m) => m.category === "anchor");
  const ordinary = memories.filter((m) => m.category !== "anchor");

  const summary = context.summarySection !== undefined
    ? null
    : await db.getLatestChatSummary(persona.id, userId).catch(() => null);
  const user = await db.getUserById(userId).catch(() => null);
  const recentMood = await db.getRecentUserMood(userId).catch(() => null);
  const events = await db.getRelationshipEvents(persona.id, userId, 20).catch(() => []);
  const phase = resolveRelationshipPhase(events as any);

  const userContext = buildUserContextBlock(
    {
      name: user?.name,
      addressStyle: user?.addressStyle,
      boundaries: user?.boundaries,
      timezone: user?.timezone,
    },
    {
      locale,
      mood: isUserMood(recentMood?.mood) ? recentMood.mood : null,
    },
  );

  return buildSystemPrompt(persona, {
    sceneOverlay: context.sceneOverlay ?? null,
    emotionalDesc: context.emotionalDesc,
    emotionalState: context.emotionalState ?? null,
    anchorSection: formatAnchorsForPrompt(anchors, locale),
    memorySection: formatMemoriesForPrompt(ordinary, locale),
    summarySection:
      context.summarySection ??
      (summary?.summary ? `${copy(locale, "prompt.summarySectionHeading")}\n${summary.summary}` : ""),
    realismLevel: (persona.personaData as any)?.realismLevel,
    timeZone: (persona as any).timezone ?? (await db.getUserTimezone(userId)),
    userContext,
    quotedSection: context.quotedSection ?? null,
    /**
     * The turn's own time.
     *
     * The section is given the time the turn happened at — so the
     * relative dates it writes ("three days ago") and the rule that a
     * trigger stops being a trigger after three days are measured
     * against the same clock as everything else in the prompt.
     *
     * It was given the wall clock instead, so the two could disagree:
     * a prompt built for a turn that happened at 23:59 said a trigger
     * from four days ago was two days old.
     */
    relationshipEvents: buildRelationshipSection(events as any, phase, locale, now),
    relationshipPhase: phase,
    reachability: (persona as any).reachability ?? "reachable",
    microRules: context.microRules,
    imperfectionProfile: context.imperfectionProfile,
    locale,
    now,
  });
}
