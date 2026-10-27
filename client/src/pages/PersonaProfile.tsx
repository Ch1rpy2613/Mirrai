import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { formatMonthKey, formatDayKey } from "@/lib/dates";
import { ArrowLeft, Pencil, Heart, Quote, Calendar, Sparkles } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import DigitalPersonaBadge from "@/components/DigitalPersonaBadge";
import FidelityPanel from "@/components/FidelityPanel";
import { attachmentStyleLabel, loveLanguageLabel } from "@/lib/persona-options";
import { normalizeMicroRules } from "@shared/micro-rules";
import { Button } from "@/components/ui/button";
import { resolveRelationshipPhase } from "@shared/user-side";

/**
 * What the app has understood.
 *
 * The persona was rebuilt from somebody's chat history, and the result
 * was a set of fields in a form. The user could edit them, but they
 * could not *read* them as a portrait — and a person who cannot see what
 * the system thinks of their ex has no way of knowing whether to trust
 * it.
 *
 * This page is that portrait: read-only, honest, and one click from
 * correcting anything that is wrong.
 */
export default function PersonaProfile() {
  const params = useParams<{ id: string }>();
  /**
   * The persona's id, and whether it is one at all.
   *
   * `parseInt("abc")` is NaN, and `NaN > 0` is false — so the query was
   * disabled, `isLoading` was false and `isError` was false, and the
   * page showed a loader for ever with no error and no way out. A stale
   * or hand-edited link did that.
   */
  const personaId = Number.parseInt(params.id ?? "", 10);
  const hasPersonaId = Number.isInteger(personaId) && personaId > 0;
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();

  const { data: persona, isLoading, isError, error, refetch } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const { data: memories } = trpc.memory.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const { data: eventsData } = trpc.relationship.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );

  // The spinner used to spin for ever.
  //
  // A persona that is gone — a stale link, a persona deleted on another
  // device — made the query fail, `persona` stayed undefined and
  // `isLoading` became false, so the page showed a loader with no way
  // back and no explanation.
  if (!hasPersonaId) return <NotFound />;

  /**
   * The screen has a way out.
   *
   * The header that carries the back button is drawn *after* this, so
   * a failed request used to strand the user on a page with nothing to
   * press but the browser's back button.
   *
   * The same screen answers the case where the query will never run at
   * all: the sign-in request failed, so the persona query stayed
   * disabled, so there was no persona and no error and no way back.
   * The page used to spin for ever.
   */
  if (isLoading || authLoading) return <PageLoader />;
  if (isError || !persona) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 app-header">
          <div className="container app-nav">
            <button onClick={() => navigate(`/chat/${personaId}`)} className="app-nav-back -ml-1 gap-1">
              <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
            </button>
          </div>
        </header>
        <main className="container page-main max-w-3xl">
          <div className="text-center space-y-4 py-16">
            <p className="text-sm text-foreground/80">
              {isError ? t("errors.notFound") : t("common.error")}
            </p>
            <p className="text-xs text-muted-foreground">{(error as any)?.message ?? ""}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const data = (persona.personaData as any) || {};
  const phase = resolveRelationshipPhase((eventsData?.events ?? []) as any);
  const memoryItems = memories?.items ?? [];
  const anchors = memoryItems.filter((m: any) => m.category === "anchor");
  /**
   * The important moments.
   *
   * Everything that was not an anchor used to be called a milestone —
   * so the ordinary memories, the ones the app writes about what
   * happened yesterday, were presented as the important moments of a
   * relationship. The graduation page splits the same three categories
   * properly.
   */
  const milestones = memoryItems.filter(
    (m: any) => m.category === "milestone" || m.category === "anniversary",
  );
  /**
   * The rules the user has confirmed.
   *
   * The unconfirmed ones are candidates — they have not been checked, so
   * they are not part of the portrait yet, and showing them here would
   * present a guess as a decision.
   */
  const confirmedRules = normalizeMicroRules(data.microRules).filter((rule) => rule.verified);

  const portrait: Array<{ label: string; value: string; icon?: any }> = [];
  if (data.personality) portrait.push({ label: t("profile.personality"), value: data.personality });
  if (data.speakingStyle) portrait.push({ label: t("profile.speakingStyle"), value: data.speakingStyle });
  /**
   * The attachment style and the love language.
   *
   * What is stored is a Chinese *identifier* — "安全型", "肯定的言辞" —
   * and it was printed as it was: so an English user read "肯定的言辞"
   * under "Love language", while the same persona's lobby card read
   * "Words of affirmation".
   *
   * The localisers were already there — the lobby uses them.
   */
  if (data.attachmentStyle) {
    portrait.push({ label: t("profile.attachmentStyle"), value: attachmentStyleLabel(data.attachmentStyle, t) });
  }
  if (data.loveLanguage) {
    portrait.push({ label: t("profile.loveLanguage"), value: loveLanguageLabel(data.loveLanguage, t) });
  }
  if (data.conflictStyle) portrait.push({ label: t("profile.conflictStyle"), value: data.conflictStyle });
  if (data.memories) portrait.push({ label: t("profile.memories"), value: data.memories });
  if (data.touchingMoments) portrait.push({ label: t("profile.touchingMoments"), value: data.touchingMoments });
  if (data.summary) portrait.push({ label: t("profile.summary"), value: data.summary });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate(`/chat/${personaId}`)} className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="kicker">{t("profile.kicker")}</p>
              <p className="app-nav-title">{persona.name}</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
          <Button size="sm" variant="ghost" className="rounded-md text-xs" onClick={() => navigate(`/persona/${personaId}/edit`)}>
            <Pencil className="w-3.5 h-3.5" /> {t("profile.edit")}
          </Button>
        </div>
      </header>

      <main className="container page-main max-w-3xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="surface p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <PersonaAvatar name={persona.name} className="w-16 h-16 rounded-full text-2xl flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-xl font-semibold text-foreground">{persona.name}</h1>
                <DigitalPersonaBadge />
              </div>
              {persona.relationshipDesc && (
                <p className="text-sm text-muted-foreground mt-1">{persona.relationshipDesc}</p>
              )}
              <div className="flex items-center gap-4 flex-wrap mt-3 text-xs text-muted-foreground">
                {persona.togetherFrom && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {/* The dates were printed raw — "2021-05" — while
                        every other date on the page is in the reader's
                        own language and format. */}
                    {formatMonthKey(persona.togetherFrom, locale)}
                    {persona.togetherTo
                      ? ` – ${formatMonthKey(persona.togetherTo, locale)}`
                      : ` – ${t("profile.present")}`}
                  </span>
                )}
                {phase && (
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3" />
                    {t(`relationship.kinds.${phase}` as any)}
                  </span>
                )}
                {persona.timezone && (
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> {persona.timezone}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {portrait.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="surface p-5 sm:p-6"
          >
            <h2 className="section-title">{t("profile.portrait")}</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
              {t("profile.portraitNote")}
            </p>
            <dl className="space-y-4">
              {portrait.map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-medium text-foreground/80">{item.label}</dt>
                  <dd className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.value}</dd>
                </div>
              ))}
            </dl>
          </motion.section>
        )}

        {data.catchphrases?.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="surface p-5 sm:p-6"
          >
            <h2 className="section-title">{t("profile.catchphrases")}</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {data.catchphrases.map((phrase: string) => (
                <span key={phrase} className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground">
                  {phrase}
                </span>
              ))}
            </div>
          </motion.section>
        )}

        {/* The rules, read-only.

            The profile is what the app thinks this person is. The rules
            are the part of that portrait the user decided, so they are
            shown here as the user's own decisions — not as another field
            the system guessed. */}
        {confirmedRules.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
            className="surface p-5 sm:p-6"
          >
            <h2 className="section-title">{t("profile.rules")}</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
              {t("profile.rulesNote")}
            </p>
            <ul className="space-y-2.5">
              {confirmedRules.map((rule) => (
                <li key={rule.id} className="text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {rule.trigger.join(" / ")}
                  </span>
                  <p className="text-muted-foreground mt-0.5 leading-relaxed">
                    {rule.meaning} — {rule.rendering}
                  </p>
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        {anchors.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="surface p-5 sm:p-6"
          >
            <h2 className="section-title">{t("profile.anchors")}</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">{t("profile.anchorsNote")}</p>
            <ul className="space-y-2.5">
              {anchors.map((memory: any) => (
                <li key={memory.id} className="flex items-start gap-2">
                  <Quote className="w-3.5 h-3.5 text-primary/60 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-foreground">{memory.title}</p>
                    {memory.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{memory.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        {milestones.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="surface p-5 sm:p-6"
          >
            <h2 className="section-title">{t("profile.milestones")}</h2>
            <ul className="mt-3 space-y-2">
              {milestones.map((memory: any) => (
                <li key={memory.id} className="text-sm text-muted-foreground">
                  {memory.date && (
                    /**
                     * The date, in the reader's language.
                     *
                     * It was the stored value — "2024-03-14" — next to
                     * dates that were formatted. Two dates about the
                     * same thing, in two formats, on the same screen.
                     */
                    <span className="text-xs text-muted-subtle mr-2">
                      {formatDayKey(memory.date, locale)}
                    </span>
                  )}
                  {memory.title}
                </li>
              ))}
            </ul>
            {/**
             * The list is cut short.
             *
             * The server says how many there are — and this page did
             * not say anything, so a persona with four hundred memories
             * showed two hundred of them and the page said "here are
             * the milestones".
             */}
            {(memories?.total ?? 0) > memoryItems.length && (
              <p className="mt-2 text-[0.625rem] text-muted-subtle">
                {t("chat.memory.capped", { shown: memoryItems.length, total: memories?.total ?? 0 })}
              </p>
            )}
          </motion.section>
        )}

        {/* The ruler and the timing.

            The page above is what the app thinks this person is. This is
            what the measurement says: whether the rebuild still sounds
            like them, and whether the waiting between their messages is
            theirs or the app's. */}
        <motion.section
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
          className="surface p-5 sm:p-6"
        >
          <FidelityPanel personaId={personaId} />
        </motion.section>

        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
          className="text-xs text-muted-foreground leading-relaxed text-center"
        >
          {t("profile.disclaimer")}
        </motion.p>
      </main>
    </div>
  );
}
