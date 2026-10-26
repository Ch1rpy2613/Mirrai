import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
export default function FidelityPanel({ personaId }: { personaId: number }) {
  const { t } = useLocale();

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

  const { data: latest } = trpc.eval.latest.useQuery({ personaId });
  const runMutation = trpc.eval.run.useMutation({
    onSuccess: () => toast.success(t("fidelity.done")),
    onError: (e: any) => toast.error(e.message),
  });

  const metrics = (latest?.run?.metricsJson as any) ?? null;
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
            <Badge
              variant={variant === "default" ? "default" : "secondary"}
              className="cursor-pointer select-none"
              onClick={() => setVariant(variant === "default" ? "withoutRules" : "default")}
            >
              {variant === "default"
                ? t("fidelity.withRules")
                : t("fidelity.withoutRules")}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runMutation.mutate({ personaId, variant })}
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
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          {t("fidelity.likelihoodHint")}
        </p>

        {metrics ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.overlap")}
              </dt>
              <dd className="text-sm mt-1">{metrics.overlap.toFixed(3)}</dd>
              <dd className="text-[11px] text-muted-foreground/80 mt-1">
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
              <dd className="text-[11px] text-muted-foreground/80 mt-1">
                {likelihoodVerdict(metrics.likelihoodGap)}
              </dd>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <dt className="text-[11px] text-muted-foreground">
                {t("fidelity.length")}
              </dt>
              <dd className="text-sm mt-1">{metrics.lengthDistance.toFixed(1)}</dd>
              <dd className="text-[11px] text-muted-foreground/80 mt-1">
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
              <dd className="text-[11px] text-muted-foreground/80 mt-1">
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
