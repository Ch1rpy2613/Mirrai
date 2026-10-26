/**
 * The letters.
 *
 * Writing to somebody who cannot be reached, and the answer that comes
 * back a day later rather than in three seconds.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { llmService, type LLMProvider } from "../llm";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import {
  buildLetterReplyInstruction,
  resolveReplyAt,
  earliestAnswerAt,
} from "@shared/letters";
import { buildUserContextBlock, isUserMood } from "@shared/user-side";
import { buildCrisisResponse, detectCrisis } from "../safety/crisis";
import { getEffectivePresence } from "../_core/graduation";

/**
 * How long a letter to a sleeping persona is left alone.
 *
 * An hour: long enough not to crowd the sweep, short enough that a
 * persona which is awakened gets its answer.
 */
const ASLEEP_LETTER_RECHECK_MS = 60 * 60 * 1000;

/**
 * Writes a letter.
 *
 * Delivered or not is the user's decision, and it is the whole point: a
 * letter that is never sent is a different act from one that is.
 */
export async function writeLetter(params: {
  persona: Persona;
  userId: number;
  body: string;
  mood?: string | null;
  /** Whether the persona is allowed to answer it. */
  deliver: boolean;
  /** "letter" is written to the persona; "todo" is kept for later. */
  kind?: "letter" | "todo";
  locale?: "zh" | "en";
  now?: Date;
}) {
  const now = params.now ?? new Date();

  // A note for later is never delivered and never answered. It is a
  // thing to say when the two of them are in touch again.
  if (params.kind === "todo" || !params.deliver) {
    return db.createLetter({
      userId: params.userId,
      personaId: params.persona.id,
      body: params.body,
      kind: params.kind ?? "letter",
      mood: params.mood ?? null,
      status: "private",
      replyAt: null,
    });
  }

  const replyAt = resolveReplyAt({ now });
  /**
   * The letter and the message that carries it, together.
   *
   * Handing the letter over means it enters the conversation. It used
   * to live only in the letters table, so a day later the reply arrived
   * in the thread with nothing before it — a response to something the
   * user could not see. A letter you sent is part of the conversation
   * you sent it in.
   *
   * The two are written in one transaction: they were two writes with
   * nothing between them, so a failure in the middle left the letter
   * delivered with no message in the thread.
   */
  const letter = await db.createLetterWithMessage(
    {
      userId: params.userId,
      personaId: params.persona.id,
      body: params.body,
      kind: params.kind ?? "letter",
      mood: params.mood ?? null,
      status: "waiting",
      replyAt,
    },
    {
      personaId: params.persona.id,
      userId: params.userId,
      content: params.body,
      channel: "web",
      origin: "letter",
    },
  );

  return letter;
}

/**
 * Answers the letters that are due.
 *
 * The answer is written with the same care as the letter, and it is
 * delivered as a message in the conversation — because that is what makes
 * it a reply rather than a notification.
 */
export async function answerDueLetters(now: Date = new Date()): Promise<number> {
  const due = await db.getDueLetters(now);
  let answered = 0;

  for (const letter of due) {
    try {
      const persona = await db.getPersonaById(letter.personaId, letter.userId);
      if (!persona) {
        await db.markLetterUnanswered(letter.id, letter.userId);
        continue;
      }

      /**
       * A persona that has said goodbye does not answer any more.
       *
       * Graduating sets the persona asleep, and the chat path refuses
       * to talk to a sleeping persona. The letter path did not: it
       * fetched the persona, composed a reply and wrote it into the
       * conversation without ever asking whether it was awake.
       *
       * So a letter written before the goodbye was answered a day
       * *after* the goodbye — in the persona's voice, as though it had
       * never left.
       */
      const presence = getEffectivePresence({
        personaPresence: persona.presence,
        graduationStatus: persona.graduationStatus,
      });
      if (presence === "asleep") {
        /**
         * The letter is left where it is: the user wrote it, it was
         * delivered, and it is still theirs. It is simply not answered.
         *
         * It is put back an hour later rather than left due: a persona
         * can be awakened, and then the letter deserves an answer — but
         * a sleeping one is not re-checked every minute for ever.
         */
        await db.deferLetter(
          letter.id,
          letter.userId,
          new Date(now.getTime() + ASLEEP_LETTER_RECHECK_MS),
        );
        continue;
      }

      // The gap between two answers is enforced here, not when the letter
      // was written: a letter written an hour after another one is not due
      // until the hour after *that* letter's answer.
      const lastReplyAt = await db.getLastLetterReplyAt(persona.id, letter.userId);
      const earliest = earliestAnswerAt(lastReplyAt, now);
      if (earliest) {
        await db.deferLetter(letter.id, letter.userId, earliest);
        continue;
      }

      /**
       * The letter is claimed before the answer is written.
       *
       * The answer takes a model call, so the claim has to happen
       * first: two overlapping sweeps would otherwise both write an
       * answer, and the user would get two replies and two messages in
       * the conversation.
       */
      const claimed = await db.claimLetter(letter.id, letter.userId);
      if (!claimed) continue;

      // The answer is written in the language the user reads.
      //
      // It used to be written in Chinese, always: the letter itself may
      // have been written in English, and the answer came back in
      // Chinese with no way for the user to ask for anything else.
      const locale = await db.getUserLocale(letter.userId).catch(() => "zh" as const);

      const replyText = await composeLetterReply({
        persona,
        letterBody: letter.body,
        locale,
        // The mood the user recorded when they wrote it.
        mood: letter.mood,
      });
      if (!replyText) {
        await db.markLetterUnanswered(letter.id, letter.userId);
        continue;
      }

      /**
       * The answer and the message that carries it, together.
       *
       * The answer belongs in the conversation. A reply that lives
       * only in a list is a notification; one that lands in the thread
       * is a reply.
       *
       * They were two writes with nothing between them — so a failure
       * in the middle left the answer in the list and never in the
       * conversation, and the letter was already answered, so it could
       * never be regenerated.
       *
       * If anything goes wrong the claim is given back, so the letter
       * is answered on the next sweep rather than staying claimed —
       * and silently lost — for five minutes.
       */
      try {
        const answered_ = await db.answerLetterWithMessage(
          letter.id,
          letter.userId,
          replyText,
          now,
          {
            personaId: persona.id,
            content: replyText,
            emotionalState: persona.emotionalState,
            channel: "web",
          },
        );
        if (!answered_) continue;
      } catch (e) {
        await db.releaseLetterClaim(letter.id, letter.userId).catch(() => {});
        throw e;
      }

      answered += 1;
    } catch (e) {
      console.warn("[Letters] Could not answer a letter:", (e as Error).message);
      /**
       * The claim is given back.
       *
       * The letter was taken out of the queue before the model was
       * asked, and an answer that could not be written must not leave
       * it out of the queue.
       */
      if (letter) {
        await db.releaseLetterClaim(letter.id, letter.userId).catch(() => {});
      }
    }
  }

  return answered;
}

/**
 * Writes the answer to a letter.
 */
export async function composeLetterReply(params: {
  persona: Persona;
  letterBody: string;
  locale?: "zh" | "en";
  now?: Date;
  /**
   * How the user was feeling when they wrote it.
   *
   * It was captured, stored, and shown in the letter box — and never
   * reached the persona. So a letter written on a bad day was answered
   * in the same register as any other.
   */
  mood?: string | null;
}): Promise<string> {
  const { persona } = params;
  const locale = params.locale ?? "zh";

  /**
   * The safety layer comes first.
   *
   * A letter is the most personal thing the app holds — and the one a
   * person writes when they cannot say it any other way. The chat path
   * has always checked the user's words for crisis language before the
   * model saw them; this path did not, so a user who wrote the same
   * sentence into a letter instead of into the conversation got a warm
   * in-character letter and no support resources at all.
   */
  const crisis = detectCrisis(params.letterBody);
  if (crisis.crisis) {
    await db
      .createSafetyEvent({
        userId: (persona as any).userId,
        personaId: persona.id,
        type: "crisis",
        severity: "critical",
        excerpt: crisis.matched.join(", "),
      })
      .catch((e) => console.warn("[Safety] Failed to record crisis event:", e));
    return buildCrisisResponse(persona.name, locale);
  }

  const memories = await retrieveMemories({
    personaId: persona.id,
    userId: (persona as any).userId,
    userMessage: params.letterBody,
    locale,
  }).catch(() => []);
  const anchors = memories.filter((m) => m.category === "anchor");
  const ordinary = memories.filter((m) => m.category !== "anchor");

  const user = await db.getUserById((persona as any).userId).catch(() => null);
  const userContext = buildUserContextBlock(
    {
      name: user?.name,
      addressStyle: user?.addressStyle,
      boundaries: user?.boundaries,
    },
    {
      locale,
      // The mood the user recorded when they wrote the letter.
      mood: isUserMood(params.mood) ? params.mood : null,
    },
  );

  const systemPrompt = buildSystemPrompt(persona, {
    anchorSection: formatAnchorsForPrompt(anchors, locale),
    memorySection: formatMemoriesForPrompt(ordinary, locale),
    userContext,
    locale,
    now: params.now ?? new Date(),
  });

  const instruction = buildLetterReplyInstruction({
    personaName: persona.name,
    letterBody: params.letterBody,
    locale,
    relationshipEnded: Boolean(persona.togetherTo?.trim()),
  });

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: instruction },
  ];

  /**
   * The user's own provider.
   *
   * The server's default is used only when the user has no provider of
   * their own: their letter is theirs, and it must not end up on the
   * operator's account.
   */
  let provider: LLMProvider | undefined;
  let mayUseServerProvider = false;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId: (persona as any).userId,
      providerName: (persona as any).llmProvider ?? undefined,
    });
    provider = resolved.provider;
    mayUseServerProvider = !resolved.owned;
  } catch (e) {
    console.warn("[Letters] The provider could not be resolved:", (e as Error).message);
  }

  if (provider) {
    try {
      // Through the service, so the deadline and the retry policy apply.
      const response = await llmService.invokeWithProvider(provider, { messages });
      if (response?.trim()) return response.trim();
    } catch (e) {
      console.warn("[Letters] The user's provider could not answer:", (e as Error).message);
    }
  }

  if (mayUseServerProvider) {
    try {
      const response = await llmService.invoke({ messages });
      if (response?.trim()) return response.trim();
    } catch (e) {
      console.warn("[Letters] No provider could answer the letter:", (e as Error).message);
    }
  }

  return "";
}

