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

export interface PromptContext {
  persona: Persona;
  userId: number;
  userMessage?: string;
  locale?: "zh" | "en";
  now?: Date;
  /** The scene overlay, when a scene is active. */
  sceneOverlay?: string | null;
  emotionalDesc?: string;
  /** A summary the caller already computed. */
  summarySection?: string;
  /** Memories the caller already retrieved. */
  memories?: Parameters<typeof formatAnchorsForPrompt>[0];
  /** The message the user is replying to. */
  quotedSection?: string | null;
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
    anchorSection: formatAnchorsForPrompt(anchors, locale),
    memorySection: formatMemoriesForPrompt(ordinary, locale),
    summarySection:
      context.summarySection ??
      (summary?.summary ? `${copy(locale, "prompt.summarySectionHeading")}\n${summary.summary}` : ""),
    realismLevel: (persona.personaData as any)?.realismLevel,
    timeZone: (persona as any).timezone ?? (await db.getUserTimezone(userId)),
    userContext,
    quotedSection: context.quotedSection ?? null,
    relationshipEvents: buildRelationshipSection(events as any, phase, locale),
    relationshipPhase: phase,
    reachability: (persona as any).reachability ?? "reachable",
    locale,
    now,
  });
}
