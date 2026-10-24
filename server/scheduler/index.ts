/**
 * The in-process scheduler.
 *
 * Mirai normally runs as a single process, so a plain interval is enough —
 * there is no job queue and nothing to coordinate with other instances.
 */
import { runReminderSweep } from "./reminders";

const TICK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the scheduler.
 *
 * The first sweep runs after a short delay so the server has finished
 * starting up before the first pass.
 */
export function startScheduler(): void {
  if (timer) return;

  timer = setInterval(() => {
    runReminderSweep().catch((e) => console.warn("[Scheduler] The tick failed:", e));
  }, TICK_INTERVAL_MS);

  // Do not hold the process open just for the scheduler.
  timer.unref?.();

  setTimeout(() => {
    runReminderSweep().catch((e) => console.warn("[Scheduler] The first sweep failed:", e));
  }, 10_000).unref?.();

  console.log("[Scheduler] Started");
}

/** Stops the scheduler. */
export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
