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
export default function TimezoneSync() {
  const { user, isAuthenticated } = useAuth();
  const updateProfile = trpc.user.updateProfile.useMutation();
  const sent = useRef(false);
  const attempts = useRef(0);

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

    sent.current = true;
    mutate(
      { timezone: zone },
      {
        onError: () => {
          // A failed sync is not worth a message; the user can still set
          // the zone by hand in the settings. It is tried a few times
          // and then left alone.
          attempts.current += 1;
          sent.current = attempts.current < 3;
        },
      },
    );
  }, [isAuthenticated, user, mutate]);

  return null;
}
