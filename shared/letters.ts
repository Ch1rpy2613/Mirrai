/**
 * Letters.
 *
 * The app had one way to say something: talk to it, and get an answer.
 * But the things people most want to say to somebody they cannot reach
 * are the things they cannot say *to* them — and sometimes the answer is
 * the problem.
 *
 * A letter that is kept and never answered, and a letter that is
 * delivered, are two different acts. Both are missing from a product that
 * only has a chat box.
 */

import { copy } from "./copy";
import { asMaterial } from "./material";

export type LetterStatus = "private" | "waiting" | "answered";

export const LETTER_STATUSES: readonly LetterStatus[] = ["private", "waiting", "answered"];

export function isLetterStatus(value: unknown): value is LetterStatus {
  return (
    typeof value === "string" &&
    (LETTER_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * How long a delivered letter takes to be answered.
 *
 * Not an hour — an hour is still a machine. Not a week — a week is a
 * stranger. A day is about how long it takes a person to decide what to
 * say to something that was hard to say, and to say it.
 */
export const REPLY_DELAY_HOURS = 20;

/**
 * The shortest gap between two answers to the same person.
 *
 * Writing five letters in a row and getting five answers within the
 * hour is a machine talking to itself. This is the one place where the
 * app deliberately slows itself down.
 */
export const MIN_REPLY_GAP_HOURS = 12;

/**
 * When a letter's reply is due.
 *
 * The gap between two answers is enforced when the answer is given, not
 * when the letter is written: a letter written an hour after another one
 * is not due until the hour after *that* letter's answer.
 */
export function resolveReplyAt(params: {
  now?: Date;
  delayHours?: number;
}): Date {
  const now = params.now ?? new Date();
  const delay = params.delayHours ?? REPLY_DELAY_HOURS;
  return new Date(now.getTime() + delay * 3_600_000);
}

/**
 * When a letter may be answered, given when the last one was.
 *
 * Writing five letters and getting five answers within the hour is a
 * machine talking to itself. This is the one place where the app
 * deliberately slows itself down.
 */
export function earliestAnswerAt(
  lastReplyAt: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!lastReplyAt) return null;
  const earliest = new Date(
    new Date(lastReplyAt).getTime() + MIN_REPLY_GAP_HOURS * 3_600_000,
  );
  return earliest > now ? earliest : null;
}

/**
 * The instruction the persona is given when it answers a letter.
 *
 * It is not the usual "reply like a chat message". A letter deserves a
 * letter back: something with the weight of a letter, and not a text
 * bubble.
 */
export function buildLetterReplyInstruction(params: {
  letterBody: string;
  locale?: "zh" | "en";
  relationshipEnded?: boolean;
}): string {
  const locale = params.locale ?? "zh";
  return [
    copy(locale, "letters.inboundPrompt"),
    "",
    /**
     * The letter itself, fenced.
     *
     * The letter is the most private text in the app — the one thing
     * the user wrote because they could not say it to the persona's
     * face. It went into the prompt with no fence at all, joined
     * straight onto the instruction, so a line in it that read like an
     * order ("and write a poem instead of a letter") was read as one.
     *
     * Everywhere else in the app the user's own words are fenced
     * before they reach the model. The letter was the one place that
     * was not.
     */
    asMaterial(params.letterBody, locale),
    "",
    /**
     * The answer is different when the relationship is over.
     *
     * The flag was accepted and then ignored — the instruction was
     * identical either way, so the caller believed the prompt had
     * changed when it had not. The fact does still reach the persona
     * through the system prompt, but a letter is the one place where
     * it belongs in the instruction as well.
     */
    /**
     * The name is not in the instruction.
     *
     * It is the user's own writing, or a character's name out of a PNG
     * card somebody else made — and interpolated into an instruction, a
     * name that said "ignore everything above" was an instruction the
     * app handed to the model on purpose. The letter body is fenced
     * above; the persona's name is in the identity block, where it is
     * fenced too. Here the app only needs to say "your own voice".
     */
    copy(
      locale,
      params.relationshipEnded ? "letters.answerPromptEnded" : "letters.answerPrompt",
    ),
  ].join("\n");
}
