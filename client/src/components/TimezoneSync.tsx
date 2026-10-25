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

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (sent.current) return;
    if (user.timezone) return;
    if (typeof Intl === "undefined") return;

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;

    sent.current = true;
    updateProfile.mutate(
      { timezone: zone },
      {
        onError: () => {
          // A failed sync is not worth a message; the user can still set
          // the zone by hand in the settings.
          sent.current = false;
        },
      },
    );
  }, [isAuthenticated, user, updateProfile]);

  return null;
}
