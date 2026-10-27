/**
 * The scheduler.
 *
 * Mirrai normally runs as a single process, so a plain interval is enough.
 * When a second copy runs, though, both of them would sweep the same
 * reminders, both answer the same letters, and both deliver the same
 * proactive message — the user would get it twice, and the second one
 * would arrive after they had already answered it.
 *
 * So the tick takes a lock before it does anything. The lock lives in
 * the shared store, so it is held by one copy of the app and not the
 * other. Without a shared store there is no lock to take and the
 * behaviour is what it always was: one process, one sweep.
 */
import { runReminderSweep } from "./reminders";
import { answerDueLetters } from "../chat/letters";
import { runProactiveSweep } from "../chat/proactive-sweep";
import { connectRedis, withRedisLock, isRedisUsable } from "../_core/redis";

const TICK_INTERVAL_MS = 60_000;

/**
 * How long the lock is held.
 *
 * It has to outlive the work, so that a copy of the app that dies
 * mid-sweep does not block the next one for long.
 */
const LOCK_TTL_MS = 120_000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Whether a sweep is running.
 *
 * The interval does not wait for the previous tick, and a sweep makes
 * model calls — for the reminders, for the letters, for the personas
 * that speak first — so it can easily take longer than the interval. Two
 * overlapping sweeps deliver the same reminder twice and the same
 * proactive message twice, and the second one arrives after the user
 * has already answered.
 *
 * The shared lock stops a *second copy* of the app from doing the same
 * work. It does nothing about this process overlapping itself, which is
 * what this is for.
 */
let sweeping = false;

/** The first sweep, ten seconds after the scheduler starts. */
let firstSweep: NodeJS.Timeout | null = null;

/**
 * Runs everything the scheduler is responsible for.
 *
 * The three sweeps used to run one after the other — so a slow one held
 * the others up: a reminder for an anniversary could go out late
 * because a proactive message was taking a long time, and a letter's
 * answer waited for both.
 *
 * They run together now, and one that fails does not stop the others.
 */
async function tick(): Promise<void> {
  const results = await Promise.allSettled([
    runReminderSweep(),
    // The letters that were delivered and are now due for an answer.
    answerDueLetters(),
    // The personas that are due to speak first.
    runProactiveSweep(),
  ]);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `[Scheduler] The ${["reminder", "letter", "proactive"][index]} sweep failed:`,
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    }
  });
}

/**
 * Runs the tick, once.
 *
 * With a shared store, the lock decides which copy of the app sweeps: the
 * other one is turned away, and the reminders go out once.
 *
 * Without one there is nothing to lock against, and the sweep still has to
 * happen — a person waiting for an anniversary reminder does not care
 * whether there is a Redis behind it. The lock is there to stop two copies
 * from doing the same work twice; with one copy there is no second copy to
 * stop, so the tick simply runs.
 */
export async function runSchedulerTick(): Promise<void> {
  if (sweeping) {
    console.warn("[Scheduler] The previous sweep is still running — this tick is skipped.");
    return;
  }
  sweeping = true;
  try {
    const shared = await connectRedis().catch(() => null);
    if (!shared || !isRedisUsable(shared)) {
      await tick();
      return;
    }
    /**
     * The store can die between the check above and the command.
     *
     * It used to kill the whole tick when it did: the lock could not be
     * taken, the error went up, and the reminders, the letters and the
     * proactive messages were all skipped — for as long as the store
     * was down, which is exactly as long as somebody was waiting for
     * an anniversary.
     *
     * So the lock is not the only way in. If it could not be taken and
     * the store is gone, the sweep runs anyway: there is no second copy
     * of the app to stop.
     */
    const ran = await withRedisLock("scheduler", LOCK_TTL_MS, tick);
    if (ran === null && !isRedisUsable(shared)) {
      console.warn(
        "[Scheduler] The shared store went away — sweeping without the lock.",
      );
      await tick();
    }
  } finally {
    sweeping = false;
  }
}

/**
 * Starts the scheduler.
 *
 * The first sweep runs after a short delay so the server has finished
 * starting up before the first pass.
 */
export function startScheduler(): void {
  if (timer) return;

  timer = setInterval(() => {
    runSchedulerTick().catch((e) => console.warn("[Scheduler] The tick failed:", e));
  }, TICK_INTERVAL_MS);

  // Do not hold the process open just for the scheduler.
  timer.unref?.();

  firstSweep = setTimeout(() => {
    firstSweep = null;
    runSchedulerTick().catch((e) => console.warn("[Scheduler] The first sweep failed:", e));
  }, 10_000);
  firstSweep.unref?.();

  console.log("[Scheduler] Started");
}

/** Stops the scheduler. */
export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  /**
   * The first sweep is cleared too.
   *
   * The interval was cleared and the ten-second timeout was not — so a
   * scheduler that had been stopped still ran one tick, ten seconds
   * after it was told to stop.
   */
  if (firstSweep) {
    clearTimeout(firstSweep);
    firstSweep = null;
  }
}
