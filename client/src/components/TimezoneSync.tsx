import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * Keeps the server's idea of the user's clock in step with the browser's.
 *
 * The app used the server's clock, so a user in Shanghai was told it was
 * the middle of the night at three in the afternoon. The browser already
 * knows the answer; this sends it once, and only when it differs.
 *
 * It renders nothing.
 */

/** How long to wait before the next attempt. */
const RETRY_DELAY_MS = 20;

/** How many attempts to make in all. */
const MAX_ATTEMPTS = 3;

export default function TimezoneSync() {
  const { user, isAuthenticated } = useAuth();
  const updateProfile = trpc.user.updateProfile.useMutation();
  const sent = useRef(false);
  const attempts = useRef(0);
  /** The retry that is waiting. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The attempt itself, so the timer can make it. */
  const attempt = useRef<(() => void) | null>(null);

  /**
   * The mutation's `mutate` is stable; the mutation *object* is not.
   *
   * The effect depended on the object, which is a new one on every
   * render — so the effect body ran after every render. It was normally
   * harmless, because the `sent` flag stopped it. But the failure
   * handler cleared that flag, so a rejected request produced: error →
   * re-render → effect → the same failing request again → error → …
   * one failing request per render, for as long as the page was open.
   *
   * The server rejects a zone it does not know, so a browser whose zone
   * name the server's ICU cannot place was enough.
   */
  const mutate = updateProfile.mutate;

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (sent.current) return;
    if (user.timezone) return;
    if (typeof Intl === "undefined") return;

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;

    attempt.current = () => {
      if (sent.current) return;
      sent.current = true;
      mutate(
        { timezone: zone },
        {
          onError: () => {
            /**
             * A failed sync is not worth a message; the user can still
             * set the zone by hand in the settings. It is tried a few
             * times and then left alone.
             *
             * It was not tried again at all: the flag was set the other
             * way round, so the *first* failure stopped the retries —
             * and nothing re-ran the effect either, because the
             * mutation's `mutate` is stable and the user object had not
             * changed. So the user was left with the server's clock —
             * the midnight problem this component exists to solve —
             * and no second attempt.
             *
             * The retry is on a timer, so it does not depend on
             * something else re-rendering the app.
             */
            attempts.current += 1;
            if (attempts.current >= MAX_ATTEMPTS) {
              sent.current = true;
              return;
            }
            sent.current = false;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => attempt.current?.(), RETRY_DELAY_MS);
          },
        },
      );
    };

    attempt.current();
  }, [isAuthenticated, user, mutate]);

  /**
   * The pending retry, when the page goes away.
   *
   * The cleanup is on its own effect on purpose: the effect above runs
   * again on every render, and a cleanup there would cancel a retry
   * that was waiting.
   */
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return null;
}
