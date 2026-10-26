/**
 * The letters the user takes back.
 *
 * The graduation ends with a farewell in the persona's voice. What was
 * actually unfinished was the *user's* — the things they said here that
 * they never managed to say to the person they were talking about.
 *
 * So the goodbye has an exit as well as a door. The app collects those
 * words and hands them back, and it never sends anything. The statuses
 * below are the four endings a sentence can have here, and the fifth one
 * matters most:
 *
 *   "self" — the person is not there any more, and the words are for the
 *   user now. Without it, a letter written to someone who has gone would
 *   sit forever in a list, which is the one outcome this feature exists
 *   to prevent.
 */

/** How a letter the user is taking back stands. */
export type OutboundStatus = "draft" | "ready" | "sent" | "dropped" | "self";

export const OUTBOUND_STATUSES: readonly OutboundStatus[] = [
  "draft",
  "ready",
  "sent",
  "dropped",
  "self",
];

export function isOutboundStatus(value: unknown): value is OutboundStatus {
  return typeof value === "string" && (OUTBOUND_STATUSES as readonly string[]).includes(value);
}

/**
 * How long a letter may wait before it is worth saying something.
 *
 * A letter that has been sitting for a month is not going to be sent by
 * accident. Saying so once is useful; saying it every day is the app
 * nagging, which is the thing this product promises not to do.
 */
export const OUTBOUND_STALE_DAYS = 30;

/** The letter as the interface sees it. */
export interface OutboundLetterView {
  status: string;
  createdAt: Date | string | null;
  sentAt?: Date | string | null;
  droppedAt?: Date | string | null;
}

/**
 * How many days a letter has been waiting to be taken.
 *
 * Only the ones that are still waiting count. A letter that was said, or
 * deliberately left behind, is finished — and a finished letter does not
 * need a nudge.
 */
export function daysWaiting(letter: OutboundLetterView, now: Date = new Date()): number {
  if (!letter.createdAt) return 0;
  if (letter.status !== "draft" && letter.status !== "ready") return 0;
  const created = new Date(letter.createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
}

/**
 * Whether the letter has been waiting long enough to mention.
 *
 * The mention happens once, when it crosses the line — not on every
 * visit afterwards.
 */
export function isStale(letter: OutboundLetterView, now: Date = new Date()): boolean {
  return daysWaiting(letter, now) >= OUTBOUND_STALE_DAYS;
}
