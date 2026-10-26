import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * The guided questionnaire.
 *
 * For people who have no chat logs to upload. The answers are mapped onto
 * the same persona structure the distillation pipeline produces, so the
 * result behaves like any other persona.
 */

/* The `key` is what the server stores — only the label is localised. */
const COMMUNICATION_STYLES = [
  { key: "gentle", labelKey: "questionnaire.communicationStyles.gentle" },
  { key: "direct", labelKey: "questionnaire.communicationStyles.direct" },
  { key: "playful", labelKey: "questionnaire.communicationStyles.playful" },
  { key: "quiet", labelKey: "questionnaire.communicationStyles.quiet" },
  { key: "detailed", labelKey: "questionnaire.communicationStyles.detailed" },
  { key: "caring", labelKey: "questionnaire.communicationStyles.caring" },
  { key: "irritable", labelKey: "questionnaire.communicationStyles.irritable" },
  { key: "literary", labelKey: "questionnaire.communicationStyles.literary" },
] as const;

const CONFLICT_STYLES = [
  { key: "silent", labelKey: "questionnaire.conflictStyles.silent" },
  { key: "direct", labelKey: "questionnaire.conflictStyles.direct" },
  { key: "forget", labelKey: "questionnaire.conflictStyles.forget" },
  { key: "cold", labelKey: "questionnaire.conflictStyles.cold" },
  { key: "dramatic", labelKey: "questionnaire.conflictStyles.dramatic" },
  { key: "apologetic", labelKey: "questionnaire.conflictStyles.apologetic" },
] as const;

const LOVE_LANGUAGES = [
  { key: "words", labelKey: "questionnaire.loveLanguages.words" },
  { key: "time", labelKey: "questionnaire.loveLanguages.time" },
  { key: "gifts", labelKey: "questionnaire.loveLanguages.gifts" },
  { key: "acts", labelKey: "questionnaire.loveLanguages.acts" },
  { key: "touch", labelKey: "questionnaire.loveLanguages.touch" },
  { key: "service", labelKey: "questionnaire.loveLanguages.service" },
] as const;

/** Where the answers are kept while the questionnaire is open. */
const QUESTIONNAIRE_STORAGE_KEY = "mirrai-questionnaire";

/* The step titles already live in the dictionary. */
const STEP_KEYS = [
  "questionnaire.name",
  "questionnaire.relationship",
  "questionnaire.metStory",
  "questionnaire.communication",
  "questionnaire.catchphrases",
  "questionnaire.caresAbout",
  "questionnaire.conflict",
  "questionnaire.loveLanguage",
  "questionnaire.boundaries",
  "questionnaire.confirm",
] as const;

type Answers = {
  name: string;
  relationship: string;
  togetherFrom: string;
  metStory: string;
  communicationStyles: string[];
  catchphrases: string;
  caresAbout: string;
  conflictStyle: string;
  loveLanguage: string;
  boundaries: string;
  nickname: string;
};

const EMPTY: Answers = {
  name: "",
  relationship: "",
  togetherFrom: "",
  metStory: "",
  communicationStyles: [],
  catchphrases: "",
  caresAbout: "",
  conflictStyle: "",
  loveLanguage: "",
  boundaries: "",
  nickname: "",
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function Questionnaire() {
  const [, navigate] = useLocation();
  const { t, locale } = useLocale();
  /**
   * The questionnaire needs a session.
   *
   * It used to have no guard at all: an anonymous visitor could answer
   * every question, press "finish", and be told the persona was made —
   * and the mutation failed with "not authorised", with the answer lost.
   */
  useAuth({ redirectOnUnauthenticated: true });
  /**
   * The step and the answers, kept in the session.
   *
   * The questionnaire asks for long free-text answers — the memories,
   * the catchphrases, the boundaries, how the two of them met — across
   * ten steps. It used to keep them in memory only, so a reload, a
   * crash, a browser "restore tab", or the sign-in redirect threw the
   * whole thing away with no warning.
   */
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY);

  // Restored once, on the first render.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem(QUESTIONNAIRE_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { step?: number; answers?: Answers };
      if (parsed.answers && typeof parsed.answers === "object") {
        /**
         * The shape is checked.
         *
         * The saved answers were spread over the empty ones without
         * being looked at — so a stored `communicationStyles` that was
         * not an array made the page throw when it drew the chips, and
         * the persist effect then overwrote the saved answers with the
         * broken ones.
         */
        const merged = { ...EMPTY, ...parsed.answers };
        setAnswers({
          ...merged,
          communicationStyles: Array.isArray(merged.communicationStyles)
            ? merged.communicationStyles.filter((v): v is string => typeof v === "string")
            : [],
        });
      }
      if (typeof parsed.step === "number" && parsed.step > 0 && parsed.step < STEP_KEYS.length) {
        setStep(parsed.step);
      }
    } catch {
      // A broken saved answer is not worth a crash.
    }
  }, []);

  // And kept up to date from then on.
  useEffect(() => {
    try {
      sessionStorage.setItem(QUESTIONNAIRE_STORAGE_KEY, JSON.stringify({ step, answers }));
    } catch {
      // A browser that will not keep it is not a problem: the answers
      // are still in the page.
    }
  }, [step, answers]);

  const createPersona = trpc.persona.createFromQuestionnaire.useMutation();

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const canAdvance = () => {
    if (step === 0) return answers.name.trim().length > 0;
    if (step === 1) return answers.relationship.trim().length > 0;
    return true;
  };

  const handleFinish = async () => {
    try {
      const result = await createPersona.mutateAsync({
        answers: {
          name: answers.name,
          relationship: answers.relationship,
          togetherFrom: answers.togetherFrom || undefined,
          metStory: answers.metStory || undefined,
          communicationStyles: answers.communicationStyles,
          catchphrases: answers.catchphrases
            .split(/[、,，\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
          caresAbout: answers.caresAbout || undefined,
          conflictStyle: answers.conflictStyle || undefined,
          loveLanguage: answers.loveLanguage || undefined,
          boundaries: answers.boundaries || undefined,
          nickname: answers.nickname || undefined,
        },
      });
      // The answers have become a persona, so they are not kept for the
      // next questionnaire.
      try {
        sessionStorage.removeItem(QUESTIONNAIRE_STORAGE_KEY);
      } catch {
        // A browser that will not keep it is not a problem.
      }
      toast.success(t("questionnaire.created"));
      navigate(`/chat/${result.personaId}`);
    } catch (e: any) {
      toast.error(t("questionnaire.createFailed", { message: e?.message ?? t("errors.unknown") }));
    }
  };

  const currentTitle = t(STEP_KEYS[step]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
            <span>
              {t("questionnaire.step", { current: step + 1, total: STEP_KEYS.length })}
            </span>
            <span>{Math.round(((step + 1) / STEP_KEYS.length) * 100)}%</span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / STEP_KEYS.length) * 100}%` }}
            />
          </div>
        </div>

        <h1 className="text-xl font-semibold text-foreground mb-1">{currentTitle}</h1>

        <div className="space-y-4 min-h-[220px]">
          {step === 0 && (
            <div className="space-y-2">
              <Label htmlFor="q-name">{t("questionnaire.fieldName")}</Label>
              <Input id="q-name" value={answers.name} onChange={(e) => set("name", e.target.value)} placeholder={t("questionnaire.namePlaceholder")} autoFocus />
            </div>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="q-rel">{t("questionnaire.relationshipLabel")}</Label>
                <Input id="q-rel" value={answers.relationship} onChange={(e) => set("relationship", e.target.value)} placeholder={t("questionnaire.relationshipPlaceholder")} autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-from">{t("questionnaire.togetherFromLabel")}</Label>
                <Input id="q-from" value={answers.togetherFrom} onChange={(e) => set("togetherFrom", e.target.value)} placeholder={t("questionnaire.togetherFromPlaceholder")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="q-nick">{t("questionnaire.nicknameLabel")}</Label>
                <Input id="q-nick" value={answers.nickname} onChange={(e) => set("nickname", e.target.value)} placeholder={t("questionnaire.nicknamePlaceholder")} />
              </div>
            </>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <Label htmlFor="q-met">{t("questionnaire.metLabel")}</Label>
              <Textarea
                id="q-met"
                value={answers.metStory}
                onChange={(e) => set("metStory", e.target.value)}
                placeholder={t("questionnaire.metPlaceholder")}
                rows={5}
                autoFocus
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-wrap gap-2">
              {COMMUNICATION_STYLES.map((style) => {
                const active = answers.communicationStyles.includes(style.key);
                return (
                  <button
                    key={style.key}
                    type="button"
                    // The chips are toggles, and they said nothing
                    // about their state: a screen-reader user heard a
                    // row of unlabelled buttons with no feedback that a
                    // choice was already made.
                    aria-pressed={active}
                    onClick={() => set("communicationStyles", toggle(answers.communicationStyles, style.key))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t(style.labelKey)}
                  </button>
                );
              })}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2">
              <Label htmlFor="q-catch">{t("questionnaire.catchphrasesLabel")}</Label>
              <Textarea
                id="q-catch"
                value={answers.catchphrases}
                onChange={(e) => set("catchphrases", e.target.value)}
                placeholder={t("questionnaire.catchphrasesPlaceholder")}
                rows={4}
                autoFocus
              />
            </div>
          )}

          {step === 5 && (
            <div className="space-y-2">
              <Label htmlFor="q-cares">{t("questionnaire.caresLabel")}</Label>
              <Textarea
                id="q-cares"
                value={answers.caresAbout}
                onChange={(e) => set("caresAbout", e.target.value)}
                placeholder={t("questionnaire.caresPlaceholder")}
                rows={5}
                autoFocus
              />
            </div>
          )}

          {step === 6 && (
            <div className="flex flex-wrap gap-2">
              {CONFLICT_STYLES.map((style) => {
                const active = answers.conflictStyle === style.key;
                return (
                  <button
                    key={style.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set("conflictStyle", active ? "" : style.key)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t(style.labelKey)}
                  </button>
                );
              })}
            </div>
          )}

          {step === 7 && (
            <div className="flex flex-wrap gap-2">
              {LOVE_LANGUAGES.map((lang) => {
                const active = answers.loveLanguage === lang.key;
                return (
                  <button
                    key={lang.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set("loveLanguage", active ? "" : lang.key)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t(lang.labelKey)}
                  </button>
                );
              })}
            </div>
          )}

          {step === 8 && (
            <div className="space-y-2">
              <Label htmlFor="q-bounds">{t("questionnaire.boundariesLabel")}</Label>
              <Textarea
                id="q-bounds"
                value={answers.boundaries}
                onChange={(e) => set("boundaries", e.target.value)}
                placeholder={t("questionnaire.boundariesPlaceholder")}
                rows={5}
                autoFocus
              />
            </div>
          )}

          {step === 9 && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Check className="w-4 h-4 text-primary" />
                {answers.name || t("common.them")}
              </div>
              <dl className="space-y-1 text-muted-foreground">
                <div>
                  <dt className="inline">{t("questionnaire.summaryRelationship")}</dt>
                  <dd className="inline">{answers.relationship || "—"}</dd>
                </div>
                <div>
                  <dt className="inline">{t("questionnaire.summarySince")}</dt>
                  <dd className="inline">{answers.togetherFrom || "—"}</dd>
                </div>
                <div>
                  <dt className="inline">{t("questionnaire.summaryCommunication")}</dt>
                  <dd className="inline">
                    {answers.communicationStyles
                      .map((k) => {
                        const found = COMMUNICATION_STYLES.find((s) => s.key === k);
                        return found ? t(found.labelKey) : k;
                      })
                      .join(locale === "en" ? ", " : "、") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t("questionnaire.summaryConflict")}</dt>
                  <dd className="inline">
                    {CONFLICT_STYLES.find((s) => s.key === answers.conflictStyle)
                      ? t(CONFLICT_STYLES.find((s) => s.key === answers.conflictStyle)!.labelKey)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline">{t("questionnaire.summaryLove")}</dt>
                  <dd className="inline">
                    {LOVE_LANGUAGES.find((s) => s.key === answers.loveLanguage)
                      ? t(LOVE_LANGUAGES.find((s) => s.key === answers.loveLanguage)!.labelKey)
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-8">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {step === 0 ? t("common.back") : t("common.previous")}
          </Button>

          {step < STEP_KEYS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canAdvance()}>
              {t("common.next")}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={createPersona.isPending}>
              {createPersona.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {t("questionnaire.create")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
