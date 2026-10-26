import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Save, X, Trash2, Wand2, Check, Pencil } from "lucide-react";
import type { MicroRule } from "@shared/micro-rules";

/**
 * The rules, editable.
 *
 * A persona is prose, and prose is read as *meaning*. The sharpest thing
 * anyone knows about another person is usually a distinction — "she says
 * 随便你 when she is angry, but 随便 without the 你 means she is truly
 * angry" — and a paragraph turns that into "she gets cold when she is
 * angry".
 *
 * So the distinction gets its own place, with the words that fire it, what
 * it means, what the person does about it, and the messages it was read
 * off. A rule the user cannot check is a rule the user cannot trust.
 */
/**
 * An id for a rule the user wrote.
 *
 * It was the clock alone, so two rules written in the same millisecond
 * got the same id — and the id is what tells an edited rule from a new
 * one, so the second would have replaced the first instead of being
 * added beside it.
 */
let manualCounter = 0;
function manualId(): string {
  manualCounter += 1;
  return `manual-${Date.now()}-${manualCounter}`;
}

export default function MicroRulesEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  // The punctuation follows the interface's language: the full-width
  // colon is Chinese typography, and an English reader saw
  // "Meaning：the meaning".
  const colon = locale === "en" ? ": " : "：";
  const triggerSeparator = locale === "en" ? ", " : "、";
  const { data, refetch } = trpc.microRule.list.useQuery({ personaId });
  const saveMutation = trpc.microRule.save.useMutation({
    onSuccess: () => {
      toast.success(t("microRules.saved"));
      refetch();
    },
    onError: (e: any) => {
      // The change did not stick, so the list on the screen goes back to
      // what the server has.
      setLocalRules(null);
      toast.error(e.message);
    },
  });
  const mineMutation = trpc.microRule.mine.useMutation({
    onSuccess: (result: { rules: unknown[] }) => {
      if (result.rules.length) {
        toast.success(t("microRules.mined", { count: result.rules.length }));
      } else {
        toast.info(t("microRules.minedNone"));
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [draft, setDraft] = useState<Partial<MicroRule> | null>(null);
  /**
   * What the user has typed into the trigger field.
   *
   * The field holds a list of triggers, and the list is split when the
   * rule is saved — not on every keystroke.
   */
  const [triggerText, setTriggerText] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * The rules as they are on the screen.
   *
   * The list comes from the server, and the server is only refreshed
   * after a save has come back. So two changes in quick succession —
   * confirming two mined rules, say — built the second request from
   * the list as it was *before* the first change, and the first change
   * was undone. The user was told "saved" twice.
   *
   * So the list on the screen is the one the next change is made from.
   */
  const [localRules, setLocalRules] = useState<MicroRule[] | null>(null);
  const rules: MicroRule[] = localRules ?? data?.rules ?? [];

  /**
   * The list the server has wins once it arrives.
   *
   * The local copy was only ever let go of when a save *failed*. So
   * after the first successful save the screen showed the local copy
   * for the rest of the session: the rules that were mined never
   * appeared — the toast said "mined 6 rules" and nothing showed up —
   * and a rule added on another device, or by the distillation, stayed
   * invisible.
   *
   * The local copy is still what the next change is made from — that
   * is what keeps two changes in quick succession from undoing one
   * another — but it is let go of as soon as the server's list arrives.
   */
  useEffect(() => {
    if (data?.rules) setLocalRules(null);
  }, [data?.rules]);

  function save(rulesToSave: MicroRule[]) {
    setLocalRules(rulesToSave);
    saveMutation.mutate({ personaId, rules: rulesToSave });
  }

  function update(rule: MicroRule, patch: Partial<MicroRule>) {
    save(rules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
  }

  function remove(rule: MicroRule) {
    save(rules.filter((r) => r.id !== rule.id));
  }

  /**
   * Puts a rule back into the form so it can be changed.
   *
   * A rule the user confirmed is a rule the user wrote — and "written"
   * means they can change it. Without this, a mined rule the user half
   * agrees with can only be confirmed whole or thrown away.
   */
  function edit(rule: MicroRule) {
    setDraft({
      ...rule,
      trigger: [...rule.trigger],
      evidence: [...rule.evidence],
    });
    setTriggerText(rule.trigger.join(triggerSeparator));
  }

  function add() {
    setDraft({
      id: manualId(),
      trigger: [],
      meaning: "",
      rendering: "",
      confidence: 1,
      source: "manual",
      verified: true,
      evidence: [],
    });
    setTriggerText("");
  }

  function saveDraft() {
    if (!draft) return;
    // The trigger is split once, here, and not on every keystroke.
    //
    // The field used to show the list joined with "、" and split it again
    // on every key press, so a comma the user had just typed was
    // replaced by a Chinese character the moment it appeared — and a
    // trigger phrase that legitimately contains a comma could not be
    // written at all.
    const trigger = triggerText
      .split(/[、,，;；\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!trigger.length || !draft.meaning?.trim() || !draft.rendering?.trim()) {
      toast.error(t("microRules.incomplete"));
      return;
    }
    const edited: MicroRule = {
      id: draft.id ?? `manual-${Date.now()}`,
      trigger,
      meaning: draft.meaning!.trim(),
      rendering: draft.rendering!.trim(),
      confidence: draft.confidence ?? 1,
      source: "manual",
      verified: true,
      evidence: draft.evidence ?? [],
    };
    // An edited rule replaces the one it was edited from; a new one is
    // added. The id is what tells them apart.
    const exists = rules.some((r) => r.id === edited.id);
    /**
     * The draft stays open until the save has landed.
     *
     * It used to close the moment the button was pressed — so a save
     * that failed took the rule the user had just written with it, and
     * there was nothing left to retry.
     */
    /**
     * The next request is built from the list on the screen.
     *
     * This went straight to the mutation — so while the save was in
     * flight the screen still held the *server's* list. The server's
     * save replaces the whole list, so a "confirm" or a "delete" in
     * that window sent the list *without* the rule that had just been
     * added — and the new rule was wiped on the server. The user was
     * told "saved" both times, and the rule they had just written was
     * gone.
     */
    const next = exists
      ? rules.map((r) => (r.id === edited.id ? edited : r))
      : [...rules, edited];
    setLocalRules(next);
    saveMutation.mutate(
      { personaId, rules: next },
      {
        onSuccess: () => {
          setDraft(null);
          setTriggerText("");
        },
      },
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t("microRules.title")}</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mineMutation.mutate({
                personaId,
                // The rules are written in the language the reader
                // reads: the procedure defaulted to Chinese, so an
                // English reader got Chinese rules.
                locale: locale === "en" ? "en" : "zh",
              })}
              disabled={mineMutation.isPending}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              {mineMutation.isPending ? t("microRules.mining") : t("microRules.mine")}
            </Button>
            {/**
             * The button is disabled while a draft is open.
             *
             * It used to be enabled — and it replaced the draft with a
             * blank one, so everything the user had typed was thrown
             * away with no warning.
             */}
            <Button variant="outline" size="sm" onClick={add} disabled={draft !== null}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("microRules.add")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("microRules.hint")}</p>
      </header>

      {rules.length === 0 && !draft ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {t("microRules.empty")}
        </p>
      ) : null}

      <ul className="space-y-3">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                {rule.trigger.join(" / ")}
              </Badge>
              {rule.verified ? (
                <Badge className="text-[11px]">{t("microRules.verified")}</Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px]">
                  {t("microRules.unverified")}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                {rule.source === "auto" ? t("microRules.sourceAuto") : t("microRules.sourceManual")}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {!rule.verified ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update(rule, { verified: true })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {t("microRules.confirm")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
                >
                  {t("microRules.evidence")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("microRules.edit")}
                  onClick={() => edit(rule)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("microRules.delete")}
                  onClick={() => remove(rule)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs">
              <span className="text-muted-foreground">{t("microRules.meaning")}{colon}</span>
              {rule.meaning}
            </p>
            <p className="mt-1 text-xs">
              <span className="text-muted-foreground">{t("microRules.rendering")}{colon}</span>
              {rule.rendering}
            </p>
            {expanded === rule.id ? (
              <div className="mt-2 space-y-1 rounded bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t("microRules.evidence")}</p>
                {rule.evidence.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t("microRules.evidenceEmpty")}</p>
                ) : (
                  rule.evidence.map((item, index) => (
                    <p key={index} className="text-[11px] text-muted-foreground">
                      {item.at ? `${item.at} · ` : ""}
                      {item.snippet}
                    </p>
                  ))
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="micro-rule-trigger">{t("microRules.trigger")}</Label>
            <Input
              id="micro-rule-trigger"
              value={triggerText}
              placeholder={t("microRules.triggerHint")}
              onChange={(e) => setTriggerText(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="micro-rule-meaning">{t("microRules.meaning")}</Label>
            <Textarea
              id="micro-rule-meaning"
              value={draft.meaning ?? ""}
              onChange={(e) => setDraft({ ...draft, meaning: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="micro-rule-rendering">{t("microRules.rendering")}</Label>
            <Textarea
              id="micro-rule-rendering"
              value={draft.rendering ?? ""}
              onChange={(e) => setDraft({ ...draft, rendering: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t("microRules.cancel")}
            </Button>
            <Button size="sm" onClick={saveDraft} disabled={saveMutation.isPending}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {saveMutation.isPending ? t("common.saving") : t("microRules.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
