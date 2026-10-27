import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { formatInstantInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * What the app noticed.
 *
 * The safety layer recorded every crisis, every dependency signal and
 * every assessment of the user's emotional trajectory — and then showed
 * the user none of it. The app knew things about the user's state that
 * the user could not see, and could not act on.
 *
 * This is the transparency principle made literal: the same data, in the
 * open, with the user in charge of what counts as dealt with.
 */
export default function SafetyTransparency() {
  const { t, locale } = useLocale();
  /**
   * The user's own calendar.
   *
   * The dates on the assessments and on the events were the browser's
   * — so the record of what the safety layer saw was in a different
   * calendar from the rest of the app.
   */
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const utils = trpc.useUtils();

  /**
   * How much of the record is on screen.
   *
   * The panel showed the newest twenty and no way to see the rest —
   * so a user with a year of history saw twenty rows and no sign that
   * there were more.
   */
  const [limit, setLimit] = useState(20);
  /**
   * The most the server will give.
   *
   * The limit went past it — so the request failed its own validation,
   * the list came back empty, and the "show more" button disappeared
   * with it: the user was told their safety record could not be read,
   * and there was no way back but a reload.
   */
  const MAX_LIMIT = 200;
  const { data: eventsData, isLoading, isError } = trpc.safety.events.useQuery({ limit });
  const { data: assessmentsData, isError: assessmentsError } = trpc.safety.assessments.useQuery();

  const resolve = trpc.safety.resolveEvent.useMutation({
    onSuccess: () => utils.safety.events.invalidate(),
    // The failure used to go to the console and nowhere else: the user
    // pressed "got it", the event stayed unhandled, and the only trace
    // was a line in a log they will never read.
    onError: (e: any) => toast.error(e.message),
  });

  const events = eventsData?.events ?? [];
  const assessments = assessmentsData?.assessments ?? [];

  if (events.length === 0 && assessments.length === 0 && !assessmentsError) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        {/* Not "nothing to report" while the record is still being
            fetched — that is a claim about the user's own history, and
            it was made a moment before the truth appeared.

            And not after a failure either: a failed request leaves the
            list empty, so the panel said "nothing recorded yet" — a
            claim about the user's own emotional history that was simply
            false. */}
        {isLoading ? t("common.loading") : isError || assessmentsError ? t("common.error") : t("safetyPanel.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {assessments.length > 0 && (
        <div>
          <p className="text-xs font-medium text-foreground/80 mb-2">
            {t("safetyPanel.assessments")}
          </p>
          <ul className="space-y-2">
            {assessments.map((assessment: any) => (
              <li key={assessment.personaId} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-foreground font-medium">
                    {assessment.personaName}
                  </span>
                  <span className="text-[0.625rem] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                    {t(`safetyPanel.trajectories.${assessment.trajectory}` as any)}
                  </span>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span>{t("safetyPanel.regret")} {assessment.regretRatio}%</span>
                  <span>{t("safetyPanel.gratitude")} {assessment.gratitudeRatio}%</span>
                  {/* The date it was made.
                      The panel showed the events with their dates and
                      the assessments without one — so a reading from
                      six months ago looked exactly like one from this
                      morning. */}
                  {assessment.createdAt && (
                    <span className="text-muted-subtle">
                      {formatInstantInZone(assessment.createdAt, locale, timezone)}
                    </span>
                  )}
                </div>
                {assessment.note && (
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {assessment.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/**
       * The record of what was noticed.
       *
       * The section was rendered only when the list had something in
       * it — so a failed request, with the assessments arriving
       * normally, made the whole section vanish, and the user
       * concluded that nothing had been noticed.
       */}
      {(events.length > 0 || isError) && (
        <div>
          <p className="text-xs font-medium text-foreground/80 mb-2">
            {t("safetyPanel.events")}
          </p>
          {isError && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("safetyPanel.eventsFailed")}
            </p>
          )}
          <ul className="space-y-2">
            {events.map((event: any) => (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="flex-1 min-w-0">
                  <span className="text-xs text-foreground">
                    {t(`safetyPanel.eventTypes.${event.type}` as any)}
                  </span>
                  <span className="text-[0.625rem] text-muted-subtle ml-2">
                    {/* The interface's language, not the browser's.
                        `LetterBox` does it this way, so the same app
                        showed two different date formats depending on
                        which panel you were in. */}
                    {formatInstantInZone(event.createdAt, locale, timezone)}
                  </span>
                </span>
                {event.handled ? (
                  <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted-subtle">
                    <Check className="w-3 h-3" /> {t("safetyPanel.handled")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ id: event.id })}
                    /**
                     * The button waits.
                     *
                     * It used to fire the mutation on every click, so a
                     * double click sent two — and the second one
                     * failed, because the event had already been
                     * marked. The user saw a success message and then
                     * an error, for one press of the button.
                     */
                    disabled={resolve.isPending}
                    className="text-[0.625rem] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-default"
                  >
                    {t("safetyPanel.markHandled")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {/**
           * The rest of the record.
           *
           * The panel showed the newest twenty and stopped — so a user
           * with a year of history saw twenty rows and no sign that
           * there were more.
           */}
          {(eventsData?.total ?? 0) > events.length && limit < MAX_LIMIT && (
            <button
              type="button"
              onClick={() => setLimit((current) => Math.min(MAX_LIMIT, current + 20))}
              className="mt-2 text-[0.625rem] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("safetyPanel.showMore", {
                count: (eventsData?.total ?? 0) - events.length,
              })}
            </button>
          )}
          {/**
           * The record is longer than the server will hand over.
           *
           * The button is gone at that point — so the user needs to be
           * told that what is on the screen is not everything, rather
           * than being left to count the rows and wonder.
           */}
          {(eventsData?.total ?? 0) > events.length && limit >= MAX_LIMIT && (
            <p className="mt-2 text-[0.625rem] text-muted-subtle">
              {t("safetyPanel.capped", { count: MAX_LIMIT })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
