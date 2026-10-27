import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The tick, and the shared lock.
 *
 * The lock is there to stop a second copy of the app from doing the same
 * sweep. It is not there to decide whether the sweep happens — the
 * module's own comment says a person waiting for an anniversary
 * reminder does not care whether there is a Redis behind it.
 *
 * It used to decide it: a shared store that was present but dead made
 * the lock throw, and the throw went all the way up, so the reminders,
 * the letters and the proactive messages were all skipped for as long
 * as the store was down.
 */

const connectRedis = vi.fn();
const withRedisLock = vi.fn();
const isRedisUsable = vi.fn();

vi.mock("../_core/redis", () => ({
  connectRedis: (...a: unknown[]) => connectRedis(...a),
  withRedisLock: (...a: unknown[]) => withRedisLock(...a),
  isRedisUsable: (...a: unknown[]) => isRedisUsable(...a),
}));

const runReminderSweep = vi.fn();
const answerDueLetters = vi.fn();
const runProactiveSweep = vi.fn();

vi.mock("./reminders", () => ({
  runReminderSweep: (...a: unknown[]) => runReminderSweep(...a),
}));
vi.mock("../chat/letters", () => ({
  answerDueLetters: (...a: unknown[]) => answerDueLetters(...a),
}));
vi.mock("../chat/proactive-sweep", () => ({
  runProactiveSweep: (...a: unknown[]) => runProactiveSweep(...a),
}));

import { runSchedulerTick } from "./index";

const handle = { url: "redis://127.0.0.1:6379", client: {}, managed: false };

describe("the scheduler tick", () => {
  beforeEach(() => {
    for (const fn of [
      connectRedis, withRedisLock, isRedisUsable,
      runReminderSweep, answerDueLetters, runProactiveSweep,
    ]) {
      fn.mockReset();
    }
    runReminderSweep.mockResolvedValue([]);
    answerDueLetters.mockResolvedValue([]);
    runProactiveSweep.mockResolvedValue([]);
  });

  it("sweeps when there is no shared store", async () => {
    connectRedis.mockResolvedValue(null);

    await runSchedulerTick();

    expect(runReminderSweep).toHaveBeenCalled();
    expect(answerDueLetters).toHaveBeenCalled();
    expect(runProactiveSweep).toHaveBeenCalled();
  });

  it("sweeps when the shared store is there but dead", async () => {
    connectRedis.mockResolvedValue(handle);
    isRedisUsable.mockReturnValue(false);

    await runSchedulerTick();

    expect(withRedisLock).not.toHaveBeenCalled();
    expect(runReminderSweep).toHaveBeenCalled();
    expect(answerDueLetters).toHaveBeenCalled();
    expect(runProactiveSweep).toHaveBeenCalled();
  });

  it("sweeps when the store dies between the check and the lock", async () => {
    connectRedis.mockResolvedValue(handle);
    // Alive when the tick looks, gone by the time the lock is taken.
    isRedisUsable.mockReturnValueOnce(true).mockReturnValue(false);
    withRedisLock.mockResolvedValue(null);

    await runSchedulerTick();

    expect(withRedisLock).toHaveBeenCalled();
    expect(runReminderSweep).toHaveBeenCalled();
    expect(answerDueLetters).toHaveBeenCalled();
    expect(runProactiveSweep).toHaveBeenCalled();
  });

  it("does not sweep when another copy of the app holds the lock", async () => {
    connectRedis.mockResolvedValue(handle);
    isRedisUsable.mockReturnValue(true);
    withRedisLock.mockResolvedValue(null);

    await runSchedulerTick();

    expect(withRedisLock).toHaveBeenCalled();
    expect(runReminderSweep).not.toHaveBeenCalled();
    expect(answerDueLetters).not.toHaveBeenCalled();
    expect(runProactiveSweep).not.toHaveBeenCalled();
  });

  it("sweeps under the lock when the lock is taken", async () => {
    connectRedis.mockResolvedValue(handle);
    isRedisUsable.mockReturnValue(true);
    withRedisLock.mockImplementation(async (_name: unknown, _ttl: unknown, fn: () => Promise<void>) => {
      await fn();
      return undefined;
    });

    await runSchedulerTick();

    expect(runReminderSweep).toHaveBeenCalled();
    expect(answerDueLetters).toHaveBeenCalled();
    expect(runProactiveSweep).toHaveBeenCalled();
  });
});
