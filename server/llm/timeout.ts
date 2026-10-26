/**
 * A deadline for a call that may never come back.
 *
 * A provider that accepts the request and then goes quiet must not hang
 * whatever called it. It hung the proactive sweep and the
 * letter-answering sweep for minutes, and the scheduler's lock expires
 * while the work is still running — so a second instance starts the
 * same sweep, and the user gets the same message twice.
 *
 * It lives in its own module because the code that uses it is often
 * tested with the `llm` module mocked, and a mocked module has no
 * timeout in it.
 */

/** How long a provider may take before the caller gives up on it. */
export const PROVIDER_TIMEOUT_MS = 120_000;

/**
 * Runs a promise with a deadline.
 *
 * The promise itself is not cancelled — the provider may keep working
 * and the bill may keep growing — but the caller stops waiting for it.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number = PROVIDER_TIMEOUT_MS,
  label = "The provider",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not answer within ${Math.round(ms / 1000)}s`)),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
