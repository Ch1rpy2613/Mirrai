/**
 * The farewell letter.
 *
 * The letter is the one artefact the graduation mechanism produces, and it
 * used to be written by a persona that had forgotten everything: the prompt
 * was assembled from the persona's identity alone — no memories, no
 * anchors, no summary — so every farewell came out in the same words. It
 * was also written with the *server's* provider, so a user who configured
 * their own key got an error at the one moment the product exists for.
 *
 * Both are fixed here: the letter is written with the user's provider and
 * with the same context the conversation would have had.
 */
import type { Persona } from "../../drizzle/schema";
import { buildSystemPrompt } from "../_core/persona-utils";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { resolveProviderForUser } from "../llm/user-provider";
import { llmService } from "../llm";
import * as db from "../db";
import { copy } from "@shared/copy";

export interface FarewellPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** How many memories the letter was written from. */
  memoryCount: number;
}

/**
 * Assembles the prompt for a farewell letter.
 *
 * The letter is about what actually happened between the two of them, so
 * the material is pulled in the same way the conversation pulls it in. The
 * milestone memories are asked for by name, because a letter that only
 * mentions the persona's catchphrases is not a letter.
 */
export async function buildFarewellPrompt(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  now?: Date;
}): Promise<FarewellPrompt> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";

  // The milestones are what a goodbye is made of, so they are named in the
  // query — otherwise a farewell is written from whatever happened to be
  // lexically close to the persona's name.
  const milestones = await db
    .getMemoriesByPersonaId(persona.id, userId)
    .catch(() => []);
  const milestoneText = milestones
    .filter((m) => m.category === "milestone" || m.category === "anniversary")
    .map((m) => `${m.title} ${m.description ?? ""}`)
    .join(" ");
  const query = `${persona.name} ${milestoneText}`.trim();

  const memories = await retrieveMemories({
    personaId: persona.id,
    userId,
    userMessage: query,
    locale,
  }).catch(() => []);

  const summary = await db.getLatestChatSummary(persona.id, userId).catch(() => null);
  const summaryText = summary?.summary ?? "";

  const systemPrompt = buildSystemPrompt(persona, {
    anchorSection: formatAnchorsForPrompt(memories, locale),
    memorySection: formatMemoriesForPrompt(memories, locale),
    summarySection: summaryText
      ? `${copy(locale, "prompt.summarySectionHeading")}\n${summaryText}`
      : "",
    locale,
    now: params.now ?? new Date(),
  });

  const userPrompt = copy(locale, "prompts.farewellLetter", { name: persona.name });

  return { systemPrompt, userPrompt, memoryCount: memories.length };
}

/**
 * The letter used when the model could not be reached.
 *
 * It is written in the persona's voice rather than as a system notice, so
 * the user is not handed an error page at the moment they said goodbye.
 */
export function fallbackFarewellLetter(persona: Persona, locale: "zh" | "en" = "zh"): string {
  return copy(locale, "prompts.farewellFallback", { name: persona.name });
}

/**
 * Writes the farewell letter.
 *
 * The provider is chosen in this order: the user's own provider first, then
 * the server's default. The old code went straight to the server's, so a
 * user who had configured a key — and only there — got an error at the one
 * moment the product exists for.
 *
 * Whatever happens, the user gets a letter. The ritual does not fail
 * because a provider is misconfigured.
 */
export async function writeFarewellLetter(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
}): Promise<string> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";

  let systemPrompt: string;
  let userPrompt: string;
  try {
    const prompt = await buildFarewellPrompt({ persona, userId, locale });
    systemPrompt = prompt.systemPrompt;
    userPrompt = prompt.userPrompt;
  } catch (e) {
    console.warn("[Graduation] Could not assemble the farewell context:", e);
    systemPrompt = buildSystemPrompt(persona);
    userPrompt = copy(locale, "prompts.farewellLetterShort", { name: persona.name });
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  // The user's own provider.
  try {
    const provider = await resolveProviderForUser({
      userId,
      providerName: persona.llmProvider ?? undefined,
    });
    if (provider) {
      const response = await provider.invoke(messages);
      if (response?.trim()) return response.trim();
    }
  } catch (e) {
    console.warn("[Graduation] The user's provider could not write the letter:", e);
  }

  // The server's default provider.
  try {
    const response = await llmService.invoke({ messages });
    if (response?.trim()) return response.trim();
  } catch (e) {
    console.warn("[Graduation] No provider could write the letter:", e);
  }

  return fallbackFarewellLetter(persona, locale);
}
