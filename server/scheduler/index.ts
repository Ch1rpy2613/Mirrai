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
import { connectRedis, withRedisLock } from "../_core/redis";

const TICK_INTERVAL_MS = 60_000;

/**
 * How long the lock is held.
 *
 * It has to outlive the work, so that a copy of the app that dies
 * mid-sweep does not block the next one for long.
 */
const LOCK_TTL_MS = 120_000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Runs everything the scheduler is responsible for. */
async function tick(): Promise<void> {
  await runReminderSweep();
  // The letters that were delivered and are now due for an answer.
  await answerDueLetters();
  // The personas that are due to speak first.
  await runProactiveSweep();
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
async function runTick(): Promise<void> {
  const shared = await connectRedis().catch(() => null);
  if (!shared) {
    await tick();
    return;
  }
  await withRedisLock("scheduler", LOCK_TTL_MS, tick);
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
    runTick().catch((e) => console.warn("[Scheduler] The tick failed:", e));
  }, TICK_INTERVAL_MS);

  // Do not hold the process open just for the scheduler.
  timer.unref?.();

  setTimeout(() => {
    runTick().catch((e) => console.warn("[Scheduler] The first sweep failed:", e));
  }, 10_000).unref?.();

  console.log("[Scheduler] Started");
}

/** Stops the scheduler. */
export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
