/**
 * The persona's own timing, measured from the record and kept.
 *
 * The app used to decide when a persona answers and when it speaks first
 * by rule: a fixed window, a fixed count. Those rules belong to the app.
 * A person who answers in twenty seconds and a person who answers after
 * an evening are given the same schedule, and both of them are wrong.
 *
 * So the timing is measured instead of assumed. This module is the
 * server-side half of that: it turns the collected records into
 * observations, fits the persona's distribution, and keeps it on the
 * persona row. Nothing here is required. A persona without a measured
 * profile keeps the behaviour it always had — which is the whole point,
 * because a change nobody asked for must be invisible to the people who
 * have not measured anything yet.
 */
import {
  fitBehaviorProfile,
  ksStatistic,
  normalizeBehaviorProfile,
  sampleReplyDelayMs,
  type BehaviorProfile,
  type BehaviorSample,
} from "@shared/behavior-profile";
import { zonedHour } from "@shared/timezone";
import * as db from "../db";

/**
 * One observed exchange, as the record shows it.
 *
 * The gap is measured in the persona's own day: somebody who is awake at
 * three in the afternoon is not awake at three in the afternoon of the
 * server's clock, and a profile fitted against the wrong clock is a
 * profile of nobody.
 */
export interface RecordExchange {
  /** The user's message time. */
  userAt: Date;
  /** The persona's reply time. */
  personaAt: Date;
  /** How many messages the persona sent in that reply. */
  burstSize: number;
  /** The hour of day (0-23) the persona replied at, in the persona's own timezone. */
  hour: number;
  /** Whether the persona spoke first after this silence. */
  personaSpokeFirst: boolean;
}

/**
 * Turns raw collected messages into exchanges.
 *
 * A persona's reply is paired with the user message that most recently
 * preceded it, and a run of consecutive persona messages is one reply —
 * one exchange with a burst size, rather than several exchanges that all
 * look like the same reply. Rows without a timestamp are dropped: a gap
 * that was never recorded is not a gap of zero, it is a gap nobody knows.
 *
 * The order of the rows is not trusted either. The collectors store what
 * they found, and what they found is not always in order, so the rows are
 * sorted by the time they claim before anything is measured.
 */
export function exchangesFromRecords(
  rows: Array<{ role: string; content: string; timestamp: Date | null }>,
  options?: { personaTimezone?: string | null },
): RecordExchange[] {
  const timezone = options?.personaTimezone ?? null;

  const usable = rows
    .filter((row) => row.timestamp instanceof Date && !Number.isNaN(row.timestamp.getTime()))
    .map((row) => ({
      role: row.role,
      at: row.timestamp as Date,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const exchanges: RecordExchange[] = [];
  let lastUserAt: Date | null = null;
  let burst: { at: Date; count: number } | null = null;

  const flush = (): void => {
    if (!burst) return;
    const personaAt = burst.at;
    exchanges.push({
      // A persona that spoke first has no user message to be measured
      // against, so the two times are the same and the gap carries no
      // information — which is exactly what the fit needs to know.
      userAt: lastUserAt ?? personaAt,
      personaAt,
      burstSize: burst.count,
      hour: zonedHour(personaAt, timezone),
      personaSpokeFirst: lastUserAt === null,
    });
    burst = null;
  };

  for (const row of usable) {
    const isUser = row.role === "user";
    if (isUser) {
      // The user spoke again, so the previous run of messages is over.
      flush();
      lastUserAt = row.at;
      continue;
    }
    if (burst) burst.count += 1;
    else burst = { at: row.at, count: 1 };
  }
  flush();

  return exchanges;
}

/**
 * Fits the persona's distribution from the observed exchanges.
 *
 * Returns null when there is not enough to go on. A profile fitted from
 * three exchanges is a rumour, and a rumour used as a schedule is worse
 * than the fixed rule it replaced.
 */
export function measureBehaviorProfile(params: {
  exchanges: RecordExchange[];
  now?: Date;
}): BehaviorProfile | null {
  const now = params.now ?? new Date();

  const samples: BehaviorSample[] = params.exchanges.map((exchange) => ({
    gapSeconds: exchange.personaSpokeFirst
      ? 0
      : Math.max(0, (exchange.personaAt.getTime() - exchange.userAt.getTime()) / 1000),
    burstSize: exchange.burstSize,
    hour: exchange.hour,
    personaSpokeFirst: exchange.personaSpokeFirst,
  }));

  return fitBehaviorProfile(samples, now);
}

/**
 * The persona's stored distribution, if it has one that can be used.
 *
 * A persona with no profile — or with a profile that was written by an
 * older version and no longer means anything — keeps the old behaviour
 * rather than a broken one.
 */
export function loadBehaviorProfile(persona: { behaviorProfile?: unknown }): BehaviorProfile | null {
  if (!persona || typeof persona !== "object") return null;
  return normalizeBehaviorProfile((persona as { behaviorProfile?: unknown }).behaviorProfile);
}

/**
 * Keeps the measured distribution on the persona.
 *
 * Passing null clears it: the persona goes back to the fixed behaviour,
 * which is the honest state for a persona whose record no longer says
 * anything.
 */
export async function saveBehaviorProfile(
  personaId: number,
  userId: number,
  profile: BehaviorProfile | null,
): Promise<void> {
  await db.setPersonaBehaviorProfile(personaId, userId, profile ?? null);
}

/**
 * Measures the persona from its collected records and keeps the result.
 *
 * The collected records are the person's own messages, and they are the
 * only honest source: the messages in the app are the replica's own, and
 * a profile fitted on them would only measure the app talking to itself.
 *
 * When there is not enough material the stored profile is left alone.
 * Throwing away a measurement because the records happen to be thin right
 * now would be worse than keeping the one that was already measured.
 */
export async function measureAndSaveBehaviorProfile(params: {
  personaId: number;
  userId: number;
  personaTimezone?: string | null;
}): Promise<BehaviorProfile | null> {
  const rows = await db
    .getCollectedMessagesForPersona(params.personaId, params.userId)
    .catch(() => []);

  const exchanges = exchangesFromRecords(rows, {
    personaTimezone: params.personaTimezone ?? null,
  });
  const profile = measureBehaviorProfile({ exchanges });
  if (!profile) return null;

  await saveBehaviorProfile(params.personaId, params.userId, profile);
  return profile;
}

/**
 * The gap the product used to have.
 *
 * Before the persona had a distribution of its own, it answered on a
 * fixed delay — the same half-minute for everybody, whatever the person
 * was like. It is kept here as the baseline the new timing is measured
 * against.
 */
export const OLD_FIXED_REPLY_GAP_SEC = 30;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * How far the current behaviour is from the real record.
 *
 * This is the ruler D4 asks for: the Kolmogorov–Smirnov distance between
 * the gaps the person really took and the gaps the app would produce
 * now. With a measured profile the app samples, so the comparison is
 * against the persona's own distribution; without one the app still
 * answers on the old fixed delay, and the comparison is against that —
 * which is the number the change is supposed to bring down.
 *
 * The sampling is seeded, because a baseline number that changes every
 * time it is measured is not a baseline.
 */
export function compareTimingToRecord(
  profile: BehaviorProfile | null,
  actualGapsSeconds: number[],
): { ks: number; recordMedian: number; profileMedian: number } {
  // A gap of zero is not a gap — it is the persona answering at the
  // same instant, which the record does not say — and a gap that is not
  // a number is not a gap at all. Left in the set they poison the
  // comparison: the walk between two distributions picks the smaller of
  // the two next values, and a NaN there makes every comparison false,
  // so the walk never moves and never ends.
  const record = actualGapsSeconds.filter((g) => Number.isFinite(g) && g > 0);

  // One generator for the whole set: a fresh generator per draw would
  // give the same number every time and hide the spread of the very
  // distribution that is being measured.
  const rng = seededRandom(`baseline:${profile?.replyGapMedianSec ?? OLD_FIXED_REPLY_GAP_SEC}`);
  const productGaps = profile
    ? record.map(() => sampleReplyDelayMs(profile, rng) / 1000)
    : record.map(() => OLD_FIXED_REPLY_GAP_SEC);

  return {
    ks: ksStatistic(record, productGaps),
    recordMedian: median(record),
    profileMedian: profile ? profile.replyGapMedianSec : OLD_FIXED_REPLY_GAP_SEC,
  };
}

/**
 * A random source that always draws the same sequence for the same seed.
 *
 * The deadline of a silence episode has to survive a restart: if the
 * process dies halfway through a wait and comes back with a different
 * plan, the persona changed its mind for no reason at all. Seeding the
 * draw with the silence itself makes the plan a property of the silence
 * rather than of the process that happened to be running.
 */
export function seededRandom(seed: string): () => number {
  // FNV-1a, then mulberry32 — small, fast and good enough to spread the
  // draws of a log-normal over the range it needs.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
