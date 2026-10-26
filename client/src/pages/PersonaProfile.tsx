import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { ArrowLeft, Pencil, Heart, Quote, Calendar, Sparkles } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import DigitalPersonaBadge from "@/components/DigitalPersonaBadge";
import FidelityPanel from "@/components/FidelityPanel";
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
  const { isAuthenticated } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();

  const { data: persona, isLoading, isError, error } = trpc.persona.get.useQuery(
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

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center space-y-3">
          <p className="text-sm text-foreground/80">{t("errors.notFound")}</p>
          <p className="text-xs text-muted-foreground">{(error as any)?.message ?? ""}</p>
        </div>
      </div>
    );
  }
  if (isLoading || !persona) return <PageLoader />;

  const data = (persona.personaData as any) || {};
  const phase = resolveRelationshipPhase((eventsData?.events ?? []) as any);
  const memoryItems = memories?.items ?? [];
  const anchors = memoryItems.filter((m: any) => m.category === "anchor");
  const milestones = memoryItems.filter((m: any) => m.category !== "anchor");
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
  if (data.attachmentStyle) portrait.push({ label: t("profile.attachmentStyle"), value: data.attachmentStyle });
  if (data.loveLanguage) portrait.push({ label: t("profile.loveLanguage"), value: data.loveLanguage });
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
                    {persona.togetherFrom}
                    {persona.togetherTo ? ` – ${persona.togetherTo}` : ` – ${t("profile.present")}`}
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
                  {memory.date && <span className="text-xs text-muted-subtle mr-2">{memory.date}</span>}
                  {memory.title}
                </li>
              ))}
            </ul>
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
