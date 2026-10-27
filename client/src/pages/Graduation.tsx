import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { formatDayKey, formatInstantInZone } from "@/lib/dates";
import { zonedDateKey } from "@shared/timezone";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { ArrowLeft, Download, Quote, Calendar, Sprout } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import OutboundLetters from "@/components/OutboundLetters";
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
/**
 * A "YYYY-MM-DD" day key, in the reader's own date format.
 *
 * The key is a calendar day and not an instant, so it is read as one:
 * `new Date("2026-03-01")` is midnight in Greenwich, which is the
 * previous day in every timezone west of Greenwich.
 */
export default function Graduation() {
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
  const { isAuthenticated, user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  /** The user's own calendar — the one the server files the days in. */
  const timezone = (user as any)?.timezone ?? null;
  const { t, locale } = useLocale();

  const { data: persona, isLoading, isError, error, refetch } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const { data: eventsData } = trpc.relationship.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const { data: memories } = trpc.memory.list.useQuery(
    { personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const { data: diaries } = trpc.diary.list.useQuery(
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
   * It answers the case where the query will never run at all too: the
   * sign-in request failed, so the persona query stayed disabled, so
   * there was no persona and no error and no way back. The page used
   * to spin for ever.
   */
  if (isLoading || authLoading) return <PageLoader />;
  if (isError || !persona) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 app-header">
          <div className="container app-nav">
            <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1">
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
  const letter = persona.farewellLetter;
  /** Which lines the second pass kept, and which it cut. */
  const draft = (persona as any).farewellDraft as
    | { kept?: string[]; removed?: string[] }
    | null
    | undefined;
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
            <p className="text-xs uppercase tracking-wide text-muted-subtle mb-4">
              {t("graduationPage.letter")}
            </p>
            <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
              {letter}
            </p>
            {persona.farewellDegraded ? (
              <p className="text-xs text-muted-subtle mt-3">
                {t("graduationPage.simplified")}
              </p>
            ) : null}
            {draft ? (
              <details className="mt-5 border-t border-border/70 pt-4">
                <summary className="text-xs text-muted-subtle cursor-pointer">
                  {t("graduationPage.draftNote")}
                </summary>
                {draft.kept?.length ? (
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-subtle mb-1">
                      {t("graduationPage.keptHeading")}
                    </p>
                    {draft.kept.map((line: string, index: number) => (
                      <p key={index} className="text-xs text-foreground/85 leading-relaxed">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
                {draft.removed?.length ? (
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-subtle mb-1">
                      {t("graduationPage.removedHeading")}
                    </p>
                    {draft.removed.map((line: string, index: number) => (
                      <p
                        key={index}
                        className="text-xs text-muted-subtle leading-relaxed line-through"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
              </details>
            ) : null}
            {persona.graduatedAt && (
              <p className="text-xs text-muted-subtle mt-5 text-right">
                {t("graduationPage.signed", {
                  /**
                   * The user's own calendar.
                   *
                   * The browser's zone and the zone the user chose are
                   * not always the same — so the date the persona said
                   * goodbye on was a day off from the date the timeline
                   * right above it says.
                   */
                  date: formatInstantInZone(persona.graduatedAt, locale, timezone),
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
            {/**
             * The line down the side of the list.
             *
             * It used to be a `<div>` inside the `<ol>`, and only an
             * `<li>` may be a child of an `<ol>` — so the list's own
             * count of its items was wrong.
             */}
            <div className="relative">
              <div className="absolute left-1.5 top-1 bottom-1 w-px bg-border" aria-hidden />
              <ol className="relative pl-6">
              {events.map((event: any) => (
                <li key={event.id} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-[1.3125rem] top-1.5 w-2 h-2 rounded-full bg-primary/50" aria-hidden />
                  <p className="text-xs text-muted-subtle">
                    {/**
                     * The user's own day.
                     *
                     * The event is filed at noon in the user's stored
                     * zone, and the browser's zone was used to read it
                     * back — so a user whose stored zone and browser
                     * zone disagreed saw the event on the wrong day.
                     */}
                    {formatDayKey(zonedDateKey(new Date(event.happenedAt), timezone), locale)}
                  </p>
                  <p className="text-sm text-foreground mt-0.5">{event.title}</p>
                  {event.detail && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{event.detail}</p>
                  )}
                </li>
              ))}
              </ol>
            </div>
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
                        <p className="text-[0.625rem] text-muted-subtle mt-1.5 flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" /> {formatDayKey(memory.date, locale)}
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
                      <span className="text-muted-subtle"> — {memory.description}</span>
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
            {/* How many there are.

                The page showed five of them and said nothing — so a
                user with forty diaries read as if there were five. */}
            <p className="text-xs text-muted-subtle mb-3">
              {t("graduationPage.diariesCount", { count: Math.min(5, diaries.length), total: diaries.length })}
            </p>
            <div className="space-y-3">
              {diaries.slice(0, 5).map((diary: any) => (
                <div key={diary.id} className="rounded-xl border border-border/70 p-4">
                  {/* The date was printed raw — "2026-03-01" — while
                      every other date on the page is in the reader's
                      own language and format. */}
                  <p className="text-xs text-muted-subtle mb-1.5">
                    {formatDayKey(diary.date, locale)}
                  </p>
                  <p className="text-sm text-foreground/85 leading-relaxed">{diary.summary}</p>
                  {diary.reflection && (
                    <p className="text-xs text-muted-foreground mt-2 italic leading-relaxed">{diary.reflection}</p>
                  )}
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* The exit.

            The farewell above is in the persona's voice. The words that
            were actually left unsaid are the user's — the things they
            said here and never said to the person. They get their own
            place on this page, and the app never sends a word of them. */}
        <motion.section
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
          className="surface p-6 sm:p-8"
        >
          <OutboundLetters personaId={personaId} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="surface p-6 sm:p-8 text-center space-y-4"
        >
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("graduationPage.afterward")}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {/* The button promises a download, so it lands on the tab
                that has the download — not on the settings page's
                first one. */}
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent" onClick={() => navigate("/settings?tab=data")}>
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
