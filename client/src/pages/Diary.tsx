import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { localDateKey, zonedDateKey } from "@shared/timezone";
import { ArrowLeft, ChevronLeft, ChevronRight, PenLine, Trash2, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { EMOTIONS, resolveEmotionKey, type EmotionDefinition } from "@/lib/emotions";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

/* 静态类名映射：Tailwind 需在源码中看到完整类名才会生成对应样式 */
const MOOD_CHIP: Record<string, string> = {
  warm: "bg-mood-warm/10 text-mood-warm border-mood-warm/25",
  playful: "bg-mood-playful/10 text-mood-playful border-mood-playful/25",
  nostalgic: "bg-mood-nostalgic/10 text-mood-nostalgic border-mood-nostalgic/25",
  melancholy: "bg-mood-melancholy/10 text-mood-melancholy border-mood-melancholy/25",
  happy: "bg-mood-happy/10 text-mood-happy border-mood-happy/25",
  distant: "bg-mood-distant/10 text-mood-distant border-mood-distant/25",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

/** Parses a `YYYY-MM-DD` string in the local timezone, not in UTC. */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function MoodChip({ mood, small }: { mood: string; small?: boolean }) {
  const { t } = useLocale();
  const key = resolveEmotionKey(mood, t as (key: any) => string);
  const cls = (key ? MOOD_CHIP[key] : undefined) ?? "bg-muted/60 text-muted-foreground border-border/60";
  const definition = key ? (EMOTIONS as Record<string, EmotionDefinition | undefined>)[key] : undefined;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${small ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs"} ${cls}`}>
      <span className="w-1 h-1 bg-current" />
      {definition ? t(definition.labelKey) : mood}
    </span>
  );
}

/**
 * The moods of an emotional arc, in the order they happened.
 *
 * The server stores the arc as an object — `{ start, end, dominant }` —
 * and the client only ever looked for an array, so the whole section was
 * discarded. An array is accepted too, for the rows that hold one.
 */
function emotionalArcValues(arc: unknown): string[] {
  if (Array.isArray(arc)) return arc.map(String).filter(Boolean);
  if (arc && typeof arc === "object") {
    const record = arc as Record<string, unknown>;
    return [record.start, record.dominant, record.end]
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  return [];
}

function DiaryCard({ entry, onDelete, deleting }: { entry: any; onDelete: (id: number) => void; deleting?: boolean }) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  /**
   * The emotional arc.
   *
   * It is an *object* on the server — `{ start, end, dominant }` — and
   * the client only ever looked for an array, so the arc was discarded
   * and the section never appeared. For any diary. Ever.
   */
  const arcs: string[] = emotionalArcValues(entry.emotionalArc);
  const highlights: string[] = Array.isArray(entry.highlights) ? entry.highlights.map(String) : [];
  const quotes: string[] = Array.isArray(entry.quotes) ? entry.quotes.map(String) : [];

  return (
    <article className="surface p-6 sm:p-7 space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="w-3.5 h-3.5" />
          {t("diary.messageCount", { count: entry.messageCount })}
        </span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("diary.deleteConfirm")}</span>
            <button onClick={() => onDelete(entry.id)}
              disabled={deleting}
              className="text-xs px-2.5 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/25 hover:bg-destructive/15 transition-colors disabled:opacity-50">
              {t("common.delete")}
            </button>
            <button onClick={() => setConfirming(false)}
              className="text-xs px-2.5 py-1 rounded-md text-muted-foreground border border-border/60 hover:text-foreground transition-colors">
              {t("common.cancel")}
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} aria-label={t("common.delete")}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="letter-prose text-[0.9375rem] sm:text-base text-foreground/90">{entry.summary}</p>

      {arcs.length > 0 && (
        <div>
          <p className="kicker mb-2.5">{t("diary.arc")}</p>
          <div className="flex gap-1.5 flex-wrap">
            {arcs.map((e, i) => <MoodChip key={i} mood={e} />)}
          </div>
        </div>
      )}
      {highlights.length > 0 && (
        <div>
          <p className="kicker mb-2.5">{t("diary.highlights")}</p>
          <ul className="space-y-1.5">
            {highlights.map((h, i) => (
              <li key={i} className="text-sm text-foreground/80 flex items-start gap-2 leading-relaxed">
                <span className="w-1 h-1 bg-cinnabar mt-[0.55rem] flex-shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {quotes.length > 0 && (
        <div>
          <p className="kicker mb-2.5">{t("diary.quotes")}</p>
          <div className="space-y-2.5">
            {quotes.map((q, i) => (
              <p key={i} className="letter-prose text-[0.9375rem] text-foreground/80 border-l-2 border-cinnabar/50 pl-4">"{q}"</p>
            ))}
          </div>
        </div>
      )}
      {entry.reflection && (
        <div>
          <p className="kicker mb-2.5">{t("diary.reflection")}</p>
          <p className="letter-prose text-sm text-foreground/80">{entry.reflection}</p>
        </div>
      )}
    </article>
  );
}

export default function Diary() {
  const [, navigate] = useLocation();
  const { isAuthenticated, user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();
  /**
   * The user's own clock.
   *
   * The calendar used to count the days in the browser's calendar while
   * the server counted them in the user's — so for anybody whose
   * configured zone is not the browser's, the two disagreed about which
   * day it was, and the diary of the morning was filed under the day
   * before.
   */
  const timezone = (user as any)?.timezone ?? null;
  const now = new Date();
  const todayStr = timezone ? zonedDateKey(now, timezone) : localDateKey(now);
  const todayParts = parseLocalDate(todayStr);
  const [year, setYear] = useState(todayParts.getFullYear());
  const [month, setMonth] = useState(todayParts.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(null);

  /**
   * The four reads, and whether they worked.
   *
   * None of them had a failure branch. So a failed request became an
   * empty page: the page said "you have no persona yet" (the persona
   * list failed), the recent entries and the dots on the calendar
   * silently disappeared, and a selected day showed the date with
   * neither the button to write nor the note that there is nothing to
   * write about.
   */
  const {
    data: personas,
    isError: personasFailed,
    isLoading: personasLoading,
    refetch: refetchPersonas,
  } = trpc.persona.list.useQuery(
    undefined,
    { enabled: isAuthenticated },
  );
  const { data: diaryDates, isError: datesFailed, refetch: refetchDates } = trpc.diary.getDates.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: entries, isError: entriesFailed, refetch: refetchEntries } = trpc.diary.list.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: dayEntry, isError: dayEntryFailed, refetch: refetchDay } = trpc.diary.getByDate.useQuery(
    { personaId: selectedPersonaId || 0, date: selectedDate || "" },
    { enabled: isAuthenticated && !!selectedPersonaId && !!selectedDate }
  );
  /**
   * Whether the selected day has anything to write about.
   *
   * The button was offered for every past day, and the server always
   * refused the days without messages — so the user's only feedback was
   * an error toast.
   */
  const { data: dayMessages, isError: dayMessagesFailed } = trpc.diary.hasMessages.useQuery(
    { personaId: selectedPersonaId || 0, date: selectedDate || "" },
    { enabled: isAuthenticated && !!selectedPersonaId && !!selectedDate }
  );
  const dayHasMessages = (dayMessages?.count ?? 0) > 0;
  const dayMessagesKnown = dayMessages !== undefined;

  const generateMutation = trpc.diary.generate.useMutation({
    onSuccess: () => {
      toast.success(t("diary.generateSuccess"));
      refetchDates();
      refetchEntries();
      // The day's own entry is refetched as well.
      //
      // It was not, and it is the query the page decides what to show:
      // so after the diary was written the page still offered to write
      // it, and a second tap failed with "there is already a diary for
      // this day". The user was told it was written, and saw nothing.
      refetchDay();
    },
    onError: (e: any) => toast.error(t("diary.generateFailed", { message: e.message })),
  });

  const deleteMutation = trpc.diary.delete.useMutation({
    onSuccess: () => { toast.success(t("diary.deleted")); setSelectedDate(null); refetchDates(); refetchEntries(); },
    onError: (e: any) => toast.error(e.message),
  });

  const datesSet = new Set((diaryDates || []).map((d: any) => d.date));
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const weekdays = Array.from(t("diary.weekdays"));

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  /**
   * The calendar stops at the current month.
   *
   * There is nothing to write in a month that has not happened, so
   * walking forward only showed an empty grid of dimmed days.
   */
  const todayPartsNow = parseLocalDate(todayStr);
  const atCurrentMonth = year === todayPartsNow.getFullYear() && month === todayPartsNow.getMonth();
  const nextMonth = () => {
    if (atCurrentMonth) return;
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
  };

  const handleGenerate = async (date: string) => {
    if (!selectedPersonaId) return;
    setGenerating(true);
    try {
      await generateMutation.mutateAsync({ personaId: selectedPersonaId, date });
      setSelectedDate(date);
    } catch {
      /**
       * The failure is not announced here.
       *
       * The mutation's own `onError` has already said what went wrong
       * — and React Query awaits it before the promise rejects, so a
       * toast here as well meant two stacked notifications for one
       * failed tap, one of them with no content at all.
       *
       * The catch is still there: it is what stops the rejection from
       * going past the handler.
       */
    } finally { setGenerating(false); }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav max-w-2xl">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1" aria-label={t("common.back")}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-spacer" />
        </div>
      </header>

      <main className="flex-1 container max-w-3xl page-main space-y-6">
        <motion.div variants={fadeUp} initial="hidden" animate="visible">
          <p className="kicker kicker-accent mb-3">{t("diary.kicker")}</p>
          <h1 className="page-title">{t("diary.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            {t("diary.intro")}
          </p>
        </motion.div>

        {/* Persona selector */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible" className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide">
          {(personas || []).map((p: any) => (
            <button key={p.id} onClick={() => { setSelectedPersonaId(p.id); setSelectedDate(null); }}
              className={`flex-shrink-0 px-3 sm:px-4 py-2.5 -mb-px text-sm border-b-2 transition-colors ${selectedPersonaId === p.id ? "border-cinnabar text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {p.name}
            </button>
          ))}
        </motion.div>

        {!selectedPersonaId && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible" className="empty-state">
            <p className="kicker kicker-accent">{t("diary.emptyKicker")}</p>
            <p className="empty-state-title">
              {/**
               * The list is on its way.
               *
               * "No personas yet — create one in the lobby first" is a
               * claim about the user's own data, and it was made while
               * the list was still being fetched: the query waits for
               * the sign-in request to answer, so for at least one
               * network round trip there was nothing on the screen but
               * that sentence and a button back to the lobby.
               */}
              {personasFailed
                ? t("common.error")
                : personasLoading || authLoading
                  ? t("common.loading")
                  : (personas || []).length === 0
                    ? t("diary.emptyNoPersona")
                    : t("diary.emptySelect")}
            </p>
            {personasFailed ? (
              <Button className="mt-3" variant="outline" onClick={() => refetchPersonas()}>{t("common.retry")}</Button>
            ) : (personas || []).length === 0 && !personasLoading && !authLoading ? (
              <Button className="mt-3" onClick={() => navigate("/")}>{t("errors.backHome")}</Button>
            ) : null}
          </motion.div>
        )}

        {selectedPersonaId && (
          <>
            {/* Calendar */}
            <motion.section variants={fadeUp} initial="hidden" animate="visible" className="surface p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="app-nav-icon" aria-label={t("diary.prevMonth")}>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-display text-base font-semibold text-foreground">
                  {new Date(year, month, 1).toLocaleDateString(locale, { year: "numeric", month: "long" })}
                </span>
                <button onClick={nextMonth} className="app-nav-icon" aria-label={t("diary.nextMonth")} disabled={atCurrentMonth}>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
                {weekdays.map((d, i) => <div key={`${d}-${i}`}>{d}</div>)}
              </div>
              {datesFailed && (
                <p className="text-xs text-destructive mb-2" role="alert">
                  {t("common.error")}
                </p>
              )}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const hasDiary = datesSet.has(dateStr);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  /**
                   * A day that has not happened yet.
                   *
                   * The server refuses to write a diary for a future
                   * day — and the button looked perfectly ordinary, so
                   * the user's only feedback was an error toast. The
                   * future days are dimmed and cannot be picked.
                   */
                  const isFuture = dateStr > todayStr;
                  return (
                    <button key={day} onClick={() => { if (!isFuture) setSelectedDate(dateStr); }}
                      disabled={isFuture}
                      /* The cell says only the number of the day, so a
                         screen reader announced a grid of "1", "2", "3" —
                         with no month, no year, no weekday and no word
                         about whether there is a diary there. */
                      aria-label={`${parseLocalDate(dateStr).toLocaleDateString(locale, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        weekday: "long",
                      })}${hasDiary ? ` · ${t("diary.hasEntry")}` : ""}`}
                      aria-current={isToday ? "date" : undefined}
                      className={`cal-cell relative aspect-square flex items-center justify-center rounded-md text-sm
                        ${isFuture
                          ? "text-muted-subtle cursor-not-allowed"
                          : isSelected
                            ? "bg-primary text-primary-foreground font-semibold"
                            : isToday
                              ? "border border-foreground/40 font-medium text-foreground"
                              : "text-foreground/80 hover:bg-muted"}`}>
                      {day}
                      {hasDiary && <span className={`absolute bottom-1 w-1 h-1 ${isSelected ? "bg-primary-foreground" : "bg-cinnabar"}`} />}
                    </button>
                  );
                })}
              </div>
            </motion.section>

            {/* Selected date content */}
            {selectedDate && (
              <motion.section
                key={selectedDate}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="space-y-4"
              >
                <div className="flex items-end justify-between gap-3">
                  <h2 className="section-title">
                    {parseLocalDate(selectedDate).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })}
                  </h2>
                  {/**
                   * The button is only offered when there is something
                   * to write from.
                   *
                   * It was offered for every past day — and the server
                   * always refused the days without messages, so the
                   * user's only feedback was an error toast.
                   */}
                  {!dayEntry && selectedDate <= todayStr && dayHasMessages && (
                    <Button size="sm" onClick={() => handleGenerate(selectedDate)} disabled={generating}
                      className="gap-1.5">
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
                      {t("diary.writeDay")}
                    </Button>
                  )}
                  {!dayEntry && selectedDate <= todayStr && dayMessagesKnown && !dayHasMessages && (
                    <p className="text-xs text-muted-subtle">{t("diary.noMessagesThatDay")}</p>
                  )}
                  {dayMessagesFailed && (
                    <p className="text-xs text-destructive" role="alert">
                      {t("common.error")}
                    </p>
                  )}
                </div>
                {dayEntryFailed && (
                  <p className="text-xs text-destructive" role="alert">
                    {t("common.error")}
                  </p>
                )}
                {dayEntry && (
                  <DiaryCard
                    entry={dayEntry}
                    onDelete={(id) => deleteMutation.mutate({ id })}
                    deleting={deleteMutation.isPending}
                  />
                )}
              </motion.section>
            )}

            {/* Recent entries list */}
            {!selectedDate && entriesFailed && (
              <motion.section variants={fadeUp} initial="hidden" animate="visible">
                <p className="text-xs text-destructive" role="alert">{t("common.error")}</p>
              </motion.section>
            )}
            {!selectedDate && entries && entries.items.length > 0 && (
              <motion.section variants={fadeUp} initial="hidden" animate="visible" className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="section-title">{t("diary.recent")}</h2>
                  <span className="kicker">{t("diary.recentKicker")}</span>
                </div>
                {/**
                    How many are not shown.

                    The server caps the page at thirty, and the list said
                    nothing — so a persona with two hundred diaries read
                    as if there were thirty, and the list looked like the
                    whole history.
                    */}
                {(entries.total ?? 0) > entries.items.length && (
                  <p className="text-xs text-muted-subtle">
                    {t("diary.moreEntries", {
                      count: (entries.total ?? 0) - entries.items.length,
                    })}
                  </p>
                )}
                {entries.items.map((entry: any) => (
                  <button key={entry.id} onClick={() => setSelectedDate(entry.date)}
                    className="surface surface-interactive w-full text-left p-5">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      {/* The date, in the interface's language.
                          The one list a user scans was the only place on
                          the page that printed the raw ISO date, while
                          the header formatted the very same date
                          properly a few lines above. */}
                      <span className="font-display text-base font-semibold text-foreground">
                        {parseLocalDate(entry.date).toLocaleDateString(locale, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">{entry.personaName || ""}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{entry.summary}</p>
                    {emotionalArcValues(entry.emotionalArc).length > 0 && (
                      <div className="flex gap-1.5 mt-3 flex-wrap">
                        {emotionalArcValues(entry.emotionalArc).slice(0, 5).map((e, i) => (
                          <MoodChip key={i} mood={e} small />
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </motion.section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
