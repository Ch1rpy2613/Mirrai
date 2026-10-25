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
import { resolveProviderForUser } from "../llm/user-provider";
import { llmService } from "../llm";
import {
  buildLetterReplyInstruction,
  resolveReplyAt,
  earliestAnswerAt,
  REPLY_DELAY_HOURS,
} from "@shared/letters";
import { buildUserContextBlock } from "@shared/user-side";

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
  const letter = await db.createLetter({
    userId: params.userId,
    personaId: params.persona.id,
    body: params.body,
    kind: params.kind ?? "letter",
    mood: params.mood ?? null,
    status: "waiting",
    replyAt,
  });

  // Handing the letter over means it enters the conversation.
  //
  // It used to live only in the letters table, so a day later the reply
  // arrived in the thread with nothing before it — a response to
  // something the user could not see. A letter you sent is part of the
  // conversation you sent it in.
  await db.createMessage({
    personaId: params.persona.id,
    userId: params.userId,
    role: "user",
    content: params.body,
    emotionalState: null,
    channel: "web",
    origin: "letter",
  });

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

      // The gap between two answers is enforced here, not when the letter
      // was written: a letter written an hour after another one is not due
      // until the hour after *that* letter's answer.
      const lastReplyAt = await db.getLastLetterReplyAt(persona.id, letter.userId);
      const earliest = earliestAnswerAt(lastReplyAt, now);
      if (earliest) {
        await db.deferLetter(letter.id, letter.userId, earliest);
        continue;
      }

      const replyText = await composeLetterReply({
        persona,
        letterBody: letter.body,
        locale: "zh",
      });
      if (!replyText) {
        await db.markLetterUnanswered(letter.id, letter.userId);
        continue;
      }

      await db.answerLetter(letter.id, letter.userId, replyText, now);

      // The answer belongs in the conversation. A reply that lives only
      // in a list is a notification; one that lands in the thread is a
      // reply.
      await db.createMessage({
        personaId: persona.id,
        userId: letter.userId,
        role: "assistant",
        content: replyText,
        emotionalState: persona.emotionalState,
        channel: "web",
        // It is the answer to a letter. Without the marker it was just
        // another message, and the connection to the letter was gone.
        origin: "letter",
      });

      answered += 1;
    } catch (e) {
      console.warn("[Letters] Could not answer a letter:", (e as Error).message);
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
}): Promise<string> {
  const { persona } = params;
  const locale = params.locale ?? "zh";

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
    { locale },
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

  try {
    const provider = await resolveProviderForUser({
      userId: (persona as any).userId,
      providerName: (persona as any).llmProvider ?? undefined,
    });
    if (provider) {
      const response = await provider.invoke(messages);
      if (response?.trim()) return response.trim();
    }
  } catch (e) {
    console.warn("[Letters] The user's provider could not answer:", (e as Error).message);
  }

  try {
    const response = await llmService.invoke({ messages });
    if (response?.trim()) return response.trim();
  } catch (e) {
    console.warn("[Letters] No provider could answer the letter:", (e as Error).message);
  }

  return "";
}

export { REPLY_DELAY_HOURS };
