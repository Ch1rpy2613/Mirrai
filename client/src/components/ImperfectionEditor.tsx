import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";
import { EMOTIONS, EMOTION_KEYS, type EmotionKey } from "@/lib/emotions";
import { defaultImperfectionProfile, type ImperfectionEntry } from "@shared/imperfection";

/**
 * Imperfection, per state.
 *
 * `realismLevel` is one number for the whole persona, and one number is
 * not how a person works: the same person is loose when they are happy
 * and clipped when they are not, and the way they are imperfect changes
 * with what is happening to them.
 *
 * So each state gets its own line here. What is written for a state is
 * only used when the persona is in that state, which is what makes it a
 * personality rather than a mood board.
 */
export default function ImperfectionEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const { data, refetch } = trpc.imperfection.get.useQuery({ personaId });
  const saveMutation = trpc.imperfection.save.useMutation({
    onSuccess: () => {
      toast.success(t("imperfection.saved"));
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [draft, setDraft] = useState<ImperfectionEntry[]>([]);
  /**
   * Whether the draft has been filled from the server yet.
   *
   * The effect used to depend on the query result itself, which meant
   * that every refetch replaced the draft — so a user who had half
   * typed a state lost it the moment the query ran again. The draft is
   * the user's while they are editing it; the server only fills it once.
   */
  const initialised = useRef(false);

  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    setDraft(data.merged);
  }, [data]);

  function update(state: EmotionKey, text: string) {
    setDraft(
      draft.map((entry) =>
        entry.state === state
          ? {
              ...entry,
              deviations: text
                .split(/[；;\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : entry,
      ),
    );
  }

  function save() {
    saveMutation.mutate({ personaId, profile: draft });
  }

  function restoreDefaults() {
    // The defaults, and not what the user has saved.
    //
    // `merged` is "what you saved, plus the defaults for the gaps" — so
    // the button only threw away the unsaved edits and the user's own
    // deviations survived untouched. It looked completely inert.
    setDraft(defaultImperfectionProfile(locale === "en" ? "en" : "zh"));
  }

  /**
   * The states the user has actually set.
   *
   * The rest of the six are the generic defaults, offered as a starting
   * point. They are shown, but they are not applied until they are
   * saved — so the interface has to be able to tell the two apart.
   */
  const appliedStates = (data?.stored ?? []).map((entry) => entry.state);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("imperfection.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("imperfection.hint")}</p>
        {appliedStates.length === 0 ? (
          // The six states are filled in with generic defaults, but a
          // default that is only shown is not an active imperfection.
          // Saying so is the difference between "this persona is
          // imperfect" and "here is something you could start from".
          <p className="text-[11px] text-muted-subtle">
            {t("imperfection.notAppliedYet")}
          </p>
        ) : null}
      </header>

      <div className="space-y-3">
        {EMOTION_KEYS.map((state: EmotionKey) => {
          const entry = draft.find((e) => e.state === state);
          const definition = EMOTIONS[state];
          return (
            <div key={state} className="space-y-1.5 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Badge className={definition.chip}>{t(definition.labelKey)}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {t(definition.descKey)}
                </span>
              </div>
              <Label className="text-xs" htmlFor={`imperfection-${state}`}>{t("imperfection.deviations")}</Label>
              <Textarea
                id={`imperfection-${state}`}
                // The separator follows the interface's language: the
                // full-width semicolon is Chinese typography, and an
                // English reader had Chinese punctuation inserted into
                // their own text.
                value={(entry?.deviations ?? []).join(locale === "en" ? "; " : "；")}
                placeholder={t("imperfection.deviationsHint")}
                onChange={(e) => update(state, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={restoreDefaults}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t("imperfection.restoreDefaults")}
        </Button>
        <Button size="sm" onClick={save} disabled={saveMutation.isPending}>
          <Save className="mr-1 h-3.5 w-3.5" />
          {t("imperfection.save")}
        </Button>
      </div>
    </section>
  );
}
