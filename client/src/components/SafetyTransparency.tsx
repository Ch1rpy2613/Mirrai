import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Check } from "lucide-react";
import { toast } from "sonner";

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
  const utils = trpc.useUtils();

  const { data: eventsData, isLoading } = trpc.safety.events.useQuery({ limit: 20 });
  const { data: assessmentsData } = trpc.safety.assessments.useQuery();

  const resolve = trpc.safety.resolveEvent.useMutation({
    onSuccess: () => utils.safety.events.invalidate(),
    // The failure used to go to the console and nowhere else: the user
    // pressed "got it", the event stayed unhandled, and the only trace
    // was a line in a log they will never read.
    onError: (e: any) => toast.error(e.message),
  });

  const events = eventsData?.events ?? [];
  const assessments = assessmentsData?.assessments ?? [];

  if (events.length === 0 && assessments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        {/* Not "nothing to report" while the record is still being
            fetched — that is a claim about the user's own history, and
            it was made a moment before the truth appeared. */}
        {isLoading ? t("common.loading") : t("safetyPanel.empty")}
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
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{t("safetyPanel.regret")} {assessment.regretRatio}%</span>
                  <span>{t("safetyPanel.gratitude")} {assessment.gratitudeRatio}%</span>
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

      {events.length > 0 && (
        <div>
          <p className="text-xs font-medium text-foreground/80 mb-2">
            {t("safetyPanel.events")}
          </p>
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
                  <span className="text-[0.625rem] text-muted-foreground/70 ml-2">
                    {/* The interface's language, not the browser's.
                        `LetterBox` does it this way, so the same app
                        showed two different date formats depending on
                        which panel you were in. */}
                    {new Date(event.createdAt).toLocaleDateString(locale)}
                  </span>
                </span>
                {event.handled ? (
                  <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted-foreground/70">
                    <Check className="w-3 h-3" /> {t("safetyPanel.handled")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ id: event.id })}
                    className="text-[0.625rem] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("safetyPanel.markHandled")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
