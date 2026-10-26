import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Gauge, Timer, Play } from "lucide-react";

/**
 * The ruler, and the timing.
 *
 * Everything else in this product is measured by whether it works. This
 * is the part measured by whether it is still the *person*: one of their
 * real lines is held back, and the rebuilt persona has to say it again.
 *
 * The timing sits next to it because it is the same question from the
 * other side. A persona whose reply gaps come from a product constant is
 * a schedule; one whose gaps come from its own history is a person.
 */
/**
 * The metrics of a run, with every number filled in.
 *
 * A number that is not there reads as zero rather than as a crash.
 */
function normaliseMetrics(raw: unknown): {
  overlap: number;
  likelihoodGap: number;
  lengthDistance: number;
  emotionAccuracy: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const number = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    overlap: number(record.overlap),
    likelihoodGap: number(record.likelihoodGap),
    lengthDistance: number(record.lengthDistance),
    emotionAccuracy: number(record.emotionAccuracy),
  };
}

export default function FidelityPanel({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();

  /**
   * What the likelihood gap says, in words.
   *
   * The number is the difference between two log-probabilities, so zero
   * means the model cannot tell the two lines apart — and a *negative*
   * number means the rebuilt line is more likely under the person's own
   * model than the line they actually wrote. That is a strange thing to
   * read as "-1.250", so it is said in words instead.
   */
  function likelihoodVerdict(gap: number): string {
    if (!Number.isFinite(gap) || Math.abs(gap) < 0.5) {
      return t("fidelity.likelihoodSame");
    }
    return gap < 0 ? t("fidelity.likelihoodMore") : t("fidelity.likelihoodLess");
  }
  const [variant, setVariant] = useState<"default" | "withoutRules">("default");

  const { data: behavior, refetch: refetchBehavior } = trpc.behavior.get.useQuery({ personaId });
  const measureMutation = trpc.behavior.measure.useMutation({
    onSuccess: (result) => {
      if (!result.profile) {
        toast.info(t("fidelity.behavior.notMeasured"));
      }
      refetchBehavior();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const utils = trpc.useUtils();
  const { data: latest } = trpc.eval.latest.useQuery({ personaId });
  const runMutation = trpc.eval.run.useMutation({
    onSuccess: () => {
      toast.success(t("fidelity.done"));
      // The numbers on screen are the previous run's.
      //
      // The run was never invalidated, so the toast said "done" while
      // the four tiles still showed the run before it — the user had no
      // way to see the result of the run they had just paid for. The
      // measurement next door does refresh its own.
      utils.eval.latest.invalidate({ personaId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  /**
   * The metrics, with every number present.
   *
   * The record is a loosely-typed JSON column, and it was read as if it
   * always had every field. A run stored before a field existed — or
   * written by an older build — threw a TypeError inside this panel,
   * which blanked the whole profile page.
   */
  const metrics = normaliseMetrics(latest?.run?.metricsJson);
  const profile = behavior?.profile ?? null;

  return (
    <section className="space-y-6">
      {/* The timing */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Timer className="h-3.5 w-3.5" />
            {t("fidelity.behavior.title")}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => measureMutation.mutate({ personaId })}
            disabled={measureMutation.isPending}
          >
            {measureMutation.isPending
              ? t("fidelity.behavior.measuring")
              : t("fidelity.behavior.measure")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("fidelity.behavior.hint")}
        </p>
        {profile ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.behavior.median")}
              </dt>
              <dd className="text-sm mt-1">{Math.round(profile.replyGapMedianSec)}s</dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.behavior.proactive")}
              </dt>
              <dd className="text-sm mt-1">
                {Math.round(profile.proactiveRate * 100)}%
              </dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.behavior.samples")}
              </dt>
              <dd className="text-sm mt-1">{profile.samples}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("fidelity.behavior.notMeasured")}
          </p>
        )}
      </div>

      <hr className="rule" />

      {/* The ruler */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            {t("fidelity.title")}
          </h3>
          <div className="flex items-center gap-2">
            {/* The switch is a button.
                A `Badge` is a `<span>`, so the control that decides
                what the evaluation measured could not be reached with
                the keyboard and was not announced as a switch. */}
            <button
              type="button"
              aria-pressed={variant === "default"}
              onClick={() => setVariant(variant === "default" ? "withoutRules" : "default")}
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                variant === "default"
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {variant === "default"
                ? t("fidelity.withRules")
                : t("fidelity.withoutRules")}
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runMutation.mutate({
                personaId,
                variant,
                // The evaluation is written in the language the reader
                // reads: the procedure defaulted to Chinese.
                locale: locale === "en" ? "en" : "zh",
              })}
              disabled={runMutation.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              {runMutation.isPending ? t("fidelity.running") : t("fidelity.run")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("fidelity.hint")}</p>
        {/* The second measure is the least obvious of the four, so it
            says what it does — in a sentence, not in a name. */}
        <p className="text-[11px] text-muted-subtle leading-relaxed">
          {t("fidelity.likelihoodHint")}
        </p>

        {metrics ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.overlap")}
              </dt>
              <dd className="text-sm mt-1">{metrics.overlap.toFixed(3)}</dd>
              <dd className="text-[11px] text-muted-subtle mt-1">
                {t("fidelity.overlapHint")}
              </dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.likelihood")}
              </dt>
              <dd className="text-sm mt-1">{metrics.likelihoodGap.toFixed(3)}</dd>
              {/* The number is a difference of log-probabilities, which
                  means nothing to a reader on its own — and its sign
                  runs the other way from the other three numbers. So it
                  is said in words. */}
              <dd className="text-[11px] text-muted-subtle mt-1">
                {likelihoodVerdict(metrics.likelihoodGap)}
              </dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.length")}
              </dt>
              <dd className="text-sm mt-1">{metrics.lengthDistance.toFixed(1)}</dd>
              <dd className="text-[11px] text-muted-subtle mt-1">
                {t("fidelity.lengthHint")}
              </dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.emotion")}
              </dt>
              <dd className="text-sm mt-1">
                {Math.round((metrics.emotionAccuracy ?? 0) * 100)}%
              </dd>
              <dd className="text-[11px] text-muted-subtle mt-1">
                {t("fidelity.emotionHint")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{t("fidelity.noRun")}</p>
        )}
      </div>
    </section>
  );
}
