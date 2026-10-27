/**
 * One operation at a time, per key.
 *
 * A read followed by a write is two steps, and two of them running at
 * once is a race: the second one read the state before the first one
 * wrote it, and so its write undoes the first one's work.
 *
 * This is the lock for that. The operations are chained per key, so
 * the second one waits for the first — and the first one's result is
 * not thrown away by the second one's write.
 */

/** The chain of operations waiting for each key. */
const chains = new Map<string, Promise<unknown>>();

/**
 * Runs `work` once no other work for the same key is running.
 *
 * A failure does not break the chain: the next operation runs anyway.
 */
export function withKeyLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  chains.set(key, next);
  /**
   * The chain is forgotten once it is done, so it does not grow for
   * ever.
   *
   * The rejection is swallowed here on purpose. `finally` returns a
   * promise of its own, and it rejects when the work rejects — and
   * nobody was waiting for that copy. So a failed operation was an
   * unhandled rejection, and Node ends the process on an unhandled
   * rejection: every persona the user did not own, every rate limit
   * and every refused write could take the whole server down.
   *
   * The caller still gets the rejection — from the promise that is
   * returned, which is the one that carries the work's own outcome.
   */
  void next
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    })
    .catch(() => undefined);
  return next;
}
