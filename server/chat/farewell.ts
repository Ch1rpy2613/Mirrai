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
 *
 * On top of that the letter is now written in two passes — the sentences
 * first, on their own, and then the subtraction. See
 * `./farewell-candidates.ts` for why, and for the budget that keeps the
 * two passes from holding the goodbye hostage.
 */
import type { Persona } from "../../drizzle/schema";
import { buildSystemPrompt } from "../_core/persona-utils";
import { llmService, type LLMProvider } from "../llm";
import { withTimeout } from "../llm/timeout";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import { copy } from "@shared/copy";
import * as db from "../db";
import {
  buildRelationshipSection,
  resolveRelationshipPhase,
} from "@shared/user-side";
import {
  assembleFarewellContext,
  writeFarewellLetterInTwoPasses,
  type FarewellFallbackReason,
} from "./farewell-candidates";

export { FAREWELL_TWO_PASS_TIMEOUT_MS } from "./farewell-candidates";

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

  const context = await assembleFarewellContext({
    persona,
    userId,
    locale,
    now: params.now,
  });

  /**
   * Where the relationship actually stands.
   *
   * The conversation resolves this from the relationship events and
   * hands it to the prompt. The letter did not — so the prompt fell
   * back to the default, "you are still feeling each other out" — and
   * the goodbye letter for somebody the user had already broken up
   * with was written in the register of a brand-new relationship.
   */
  const now = params.now ?? new Date();
  const events = await db.getRelationshipEvents(persona.id, userId, 20).catch(() => []);
  const phase = resolveRelationshipPhase(events as any);

  const systemPrompt = buildSystemPrompt(persona, {
    anchorSection: context.anchorSection,
    memorySection: context.memorySection,
    summarySection: context.summarySection,
    locale,
    now,
    relationshipEvents: buildRelationshipSection(events as any, phase, locale, now),
    relationshipPhase: phase,
  });

  const userPrompt = copy(locale, "prompts.farewellLetter", {
    name: persona.name,
  });

  return { systemPrompt, userPrompt, memoryCount: context.memoryCount };
}

/**
 * The letter used when the model could not be reached.
 *
 * It is written in the persona's voice rather than as a system notice, so
 * the user is not handed an error page at the moment they said goodbye.
 */
export function fallbackFarewellLetter(
  persona: Persona,
  locale: "zh" | "en" = "zh",
): string {
  return copy(locale, "prompts.farewellFallback", { name: persona.name });
}

/**
 * Writes the farewell letter.
 *
 * The two passes are tried first: the sentences the persona has never
 * said, and then the subtraction. When they cannot deliver — no
 * candidates, a model that failed, a provider too slow — the ordinary
 * single-pass letter is written instead, which is what the product has
 * always written and is never worse than it was.
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
  const { letter } = await writeFarewellLetterWithStatus(params);
  return letter;
}

/**
 * The letter, and whether it is the full one.
 *
 * `degraded` means the two passes could not deliver, so what the user
 * reads is the older single-pass letter. That is not a failure — it is
 * the same letter as before, written in one go — but the interface has
 * to be able to say so rather than quietly showing a plainer thing at
 * the one moment the product exists for.
 */
export async function writeFarewellLetterWithStatus(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
}): Promise<{
  letter: string;
  degraded: boolean;
  reason?: string;
  /** Which lines survived the second pass, and which it cut. */
  draft?: { kept: string[]; removed: string[] };
}> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";

  // The two-pass letter.
  try {
    const two = await writeFarewellLetterInTwoPasses({
      persona,
      userId,
      locale,
    });
    if (!two.degraded && two.letter.trim()) {
      return {
        letter: two.letter.trim(),
        degraded: false,
        // The subtraction is the interesting half of the writing, so it
        // is kept rather than dropped on the floor.
        draft: two.draft ? { kept: two.draft.kept, removed: two.draft.removed } : undefined,
      };
    }
    logFarewellFallback(two.reason ?? "two-pass-unavailable", persona.id);
    const single = await writeSinglePassLetter({ persona, userId, locale });
    return {
      letter: single,
      degraded: true,
      reason: two.reason ?? "two-pass-unavailable",
    };
  } catch (e) {
    logFarewellFallback("two-pass-unavailable", persona.id);
    console.warn(
      "[Graduation] The two-pass farewell could not be run:",
      (e as Error).message,
    );
  }

  const single = await writeSinglePassLetter({ persona, userId, locale });
  return { letter: single, degraded: true, reason: "two-pass-unavailable" };
}

/**
 * The older, single-pass letter.
 *
 * It is the fallback, and it stays: the two passes are better, but the
 * ritual must never fail because a model was slow or a provider was
 * misconfigured.
 */
async function writeSinglePassLetter(params: {
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
    // The locale matters: without it the prompt is Chinese, and an
    // English user was handed a Chinese system prompt and an English
    // one — a sentence in two languages at once.
    systemPrompt = buildSystemPrompt(persona, { locale });
    userPrompt = copy(locale, "prompts.farewellLetterShort", {
      name: persona.name,
    });
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  /**
   * The user's own provider.
   *
   * The server's default is used only when the user has no provider of
   * their own: the farewell letter is the most private thing the app
   * ever writes, and it must not end up on the operator's account.
   */
  let provider: LLMProvider | undefined;
  let mayUseServerProvider = false;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId,
      providerName: persona.llmProvider ?? undefined,
    });
    provider = resolved.provider;
    mayUseServerProvider = !resolved.owned;
  } catch (e) {
    console.warn("[Graduation] The provider could not be resolved:", e);
  }

  if (provider) {
    try {
      const response = await withTimeout(provider.invoke(messages));
      if (response?.trim()) return response.trim();
    } catch (e) {
      console.warn(
        "[Graduation] The user's provider could not write the letter:",
        e,
      );
    }
  }

  if (mayUseServerProvider) {
    try {
      const response = await llmService.invoke({ messages });
      if (response?.trim()) return response.trim();
    } catch (e) {
      console.warn("[Graduation] No provider could write the letter:", e);
    }
  }

  return fallbackFarewellLetter(persona, locale);
}

/**
 * Writes down that the letter fell back, and why.
 *
 * The fallback is not a failure — it is what keeps the ritual alive when a
 * provider is slow or misconfigured — but its *frequency* is a
 * measurement. If the two-pass path falls back most of the time, the
 * letters are not getting any better, and nothing else in the log would
 * show it. The reason is in the line so the reasons can be counted
 * separately.
 */
function logFarewellFallback(
  reason: FarewellFallbackReason,
  personaId: number,
): void {
  console.warn(
    `[Graduation] Farewell fallback for persona ${personaId}: ${reason}.`,
  );
}
