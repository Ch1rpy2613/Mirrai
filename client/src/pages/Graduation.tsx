import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { ArrowLeft, Download, Quote, Calendar, Sprout } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { Button } from "@/components/ui/button";

/**
 * The goodbye.
 *
 * The graduation used to be a modal with a letter in it. A modal is a
 * thing you dismiss, and this is not a thing you dismiss — it is the
 * one moment the product exists for, and it deserves a page you can
 * come back to.
 *
 * So: the letter, the timeline, the moments, and something to take away
 * with you. And afterwards the persona is asleep and the app is quiet —
 * but the page is still here, because being allowed to come back and
 * look is the difference between an ending and a dismissal.
 */
export default function Graduation() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { t, locale } = useLocale();

  const { data: persona, isLoading } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 },
  );
  const { data: eventsData } = trpc.relationship.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 },
  );
  const { data: memories } = trpc.memory.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 },
  );
  const { data: diaries } = trpc.diary.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 },
  );

  if (isLoading || !persona) return <PageLoader />;

  const letter = persona.farewellLetter;
  const events = eventsData?.events ?? [];
  const memoryItems = memories?.items ?? [];
  const milestones = memoryItems.filter(
    (m: any) => m.category === "milestone" || m.category === "anniversary",
  );
  const ordinary = memoryItems.filter(
    (m: any) => m.category !== "milestone" && m.category !== "anniversary",
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="kicker">{t("graduationPage.kicker")}</p>
              <p className="app-nav-title">{persona.name}</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
        </div>
      </header>

      <main className="container page-main max-w-2xl space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="text-center pt-4"
        >
          <PersonaAvatar name={persona.name} className="w-20 h-20 rounded-full text-3xl mx-auto" />
          <h1 className="page-title mt-6">{t("graduationPage.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            {t("graduationPage.subtitle")}
          </p>
        </motion.div>

        {letter ? (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="surface p-6 sm:p-8"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground/70 mb-4">
              {t("graduationPage.letter")}
            </p>
            <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
              {letter}
            </p>
            {persona.graduatedAt && (
              <p className="text-xs text-muted-foreground/70 mt-5 text-right">
                {t("graduationPage.signed", {
                  date: new Date(persona.graduatedAt).toLocaleDateString(locale),
                })}
              </p>
            )}
          </motion.section>
        ) : (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="surface p-6 sm:p-8 text-center"
          >
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("graduationPage.noLetter")}
            </p>
          </motion.section>
        )}

        {events.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          >
            <h2 className="section-title mb-4">{t("graduationPage.timeline")}</h2>
            <ol className="relative pl-6">
              <div className="absolute left-1.5 top-1 bottom-1 w-px bg-border" aria-hidden />
              {events.map((event: any) => (
                <li key={event.id} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-[1.3125rem] top-1.5 w-2 h-2 rounded-full bg-primary/50" aria-hidden />
                  <p className="text-xs text-muted-foreground/70">
                    {new Date(event.happenedAt).toLocaleDateString(locale)}
                  </p>
                  <p className="text-sm text-foreground mt-0.5">{event.title}</p>
                  {event.detail && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{event.detail}</p>
                  )}
                </li>
              ))}
            </ol>
          </motion.section>
        )}

        {milestones.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          >
            <h2 className="section-title mb-1">{t("graduationPage.milestones")}</h2>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {t("graduationPage.milestonesNote")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {milestones.map((memory: any) => (
                <div key={memory.id} className="rounded-xl border border-border/70 p-4">
                  <div className="flex items-start gap-2">
                    <Quote className="w-3.5 h-3.5 text-primary/60 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{memory.title}</p>
                      {memory.description && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{memory.description}</p>
                      )}
                      {memory.date && (
                        <p className="text-[0.625rem] text-muted-foreground/70 mt-1.5 flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" /> {memory.date}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {ordinary.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          >
            <h2 className="section-title mb-4">{t("graduationPage.memories")}</h2>
            <ul className="space-y-2">
              {ordinary.map((memory: any) => (
                <li key={memory.id} className="text-sm text-muted-foreground flex items-start gap-2">
                  <Sprout className="w-3.5 h-3.5 text-primary/50 flex-shrink-0 mt-0.5" />
                  <span>
                    {memory.title}
                    {memory.description && (
                      <span className="text-muted-foreground/70"> — {memory.description}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        {diaries && diaries.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          >
            <h2 className="section-title mb-4">{t("graduationPage.diaries")}</h2>
            <div className="space-y-3">
              {diaries.slice(0, 5).map((diary: any) => (
                <div key={diary.id} className="rounded-xl border border-border/70 p-4">
                  <p className="text-xs text-muted-foreground/70 mb-1.5">{diary.date}</p>
                  <p className="text-sm text-foreground/85 leading-relaxed">{diary.summary}</p>
                  {diary.reflection && (
                    <p className="text-xs text-muted-foreground mt-2 italic leading-relaxed">{diary.reflection}</p>
                  )}
                </div>
              ))}
            </div>
          </motion.section>
        )}

        <motion.section
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="surface p-6 sm:p-8 text-center space-y-4"
        >
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("graduationPage.afterward")}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent" onClick={() => navigate("/settings")}>
              <Download className="w-3.5 h-3.5" /> {t("graduationPage.takeItWithYou")}
            </Button>
            <Button size="sm" variant="ghost" className="rounded-md" onClick={() => navigate("/")}>
              {t("graduationPage.backHome")}
            </Button>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
