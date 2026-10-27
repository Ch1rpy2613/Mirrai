import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { PenLine, Send, Trash2, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { USER_MOODS, isUserMood, type UserMood } from "@shared/user-side";
import { formatInstantInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import CrisisCard from "@/components/CrisisCard";

/**
 * The letters.
 *
 * The app had one way to say something: talk to it, and get an answer.
 * But the things people most want to say to somebody they cannot reach
 * are the things they cannot say *to* them — and sometimes the answer is
 * the problem.
 *
 * So there are two ways to write, and they are not the same act:
 *
 *   「不发送」 — kept, and never answered. Sometimes that is the point.
 *   「交给 TA」 — delivered, and answered a day later. Because instant
 *                replies are the one thing that gives the game away.
 */
export default function LetterBox({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  /**
   * The user's own calendar.
   *
   * The dates on the letters were the browser's — so a letter written
   * late in the evening could show the next day, and a machine set to
   * the wrong city disagreed with the rest of the app.
   */
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.letter.list.useQuery({ personaId });
  /**
   * The older letters.
   *
   * The list stopped at two hundred and there was no way to reach the
   * rest — so the letters existed in the export and not in the product.
   */
  const [older, setOlder] = useState<any[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const { data: todosData, isError: todosFailed } = trpc.letter.todos.useQuery({ personaId });
  const [showWrite, setShowWrite] = useState(false);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<UserMood | "">("");
  const [kind, setKind] = useState<"letter" | "todo">("letter");
  /**
   * The support resources.
   *
   * A letter is what a person writes when they cannot say it any other
   * way, so the server reads it — and when it finds crisis language
   * the resources are shown here.
   */
  const [showCrisis, setShowCrisis] = useState(false);

  const write = trpc.letter.write.useMutation({
    onSuccess: (data) => {
      utils.letter.list.invalidate({ personaId });
      /**
       * The list of things to say later.
       *
       * It is a separate query — and it was never invalidated, so a
       * note the user had just written did not appear until the page
       * was reloaded.
       */
      utils.letter.todos.invalidate({ personaId });
      setBody("");
      setMood("");
      setShowWrite(false);
      /**
       * The support resources.
       *
       * A letter is the most personal thing the app holds — it is
       * what a person writes when they cannot say it any other way.
       * The server reads it for crisis language, and when it finds
       * something the resources are shown here, the way they are for
       * the mood check-in and the relationship timeline.
       */
      if ((data as any)?.crisis) setShowCrisis(true);
      toast.success(
        /**
         * A note to say later is not a letter.
         *
         * The message was chosen by the status alone — and a note is
         * written as private, so the person who pressed "say it later"
         * was told "the letter is written. It will not be answered —
         * that is your choice." Which is true of the letter, and
         * nonsense of the note.
         *
         * And a persona that has said goodbye does not answer: the
         * letter is kept, and the user is told that is why.
         */
        data.letter?.kind === "todo"
          ? t("letters.noteSaved")
          : (data as any)?.asleep
            ? t("letters.personaAsleep")
            : data.letter?.status === "waiting"
              ? t("letters.delivered")
              : t("letters.kept"),
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.letter.remove.useMutation({
    onSuccess: () => {
      utils.letter.list.invalidate({ personaId });
      utils.letter.todos.invalidate({ personaId });
    },
    onError: (e) => toast.error(e.message),
  });

  /**
   * The older pages are dropped when the first page moves.
   *
   * The list is paged: the newest fifty, and then the pages before
   * them. Writing a letter or deleting one shifts the first page — so
   * the older pages were left pointing at a boundary that had moved,
   * and a letter fell between the two: it was on neither page, and it
   * could never be reached again.
   *
   * So the pages go when the list changes. The letter that fell in the
   * gap is then reachable again — the "load older" button asks for the
   * page before the oldest one *on the screen now*.
   */
  useEffect(() => {
    setOlder([]);
  }, [data]);

  /** Asks for the page before the oldest one on the screen. */
  const loadOlder = async () => {
    const shown = [...(data?.letters ?? []), ...older];
    const oldest = shown[shown.length - 1];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await utils.letter.list.fetch({
        personaId,
        before: oldest.id,
        limit: 50,
      });
      const known = new Set(shown.map((l: any) => l.id));
      setOlder((current) => [
        ...current,
        ...(page.letters ?? []).filter((l: any) => !known.has(l.id)),
      ]);
    } catch (e) {
      toast.error((e as Error)?.message || t("errors.unknown"));
    } finally {
      setLoadingOlder(false);
    }
  };

  /**
   * The two pages, without a letter twice.
   *
   * The first page and the older pages can overlap for a moment — the
   * older pages are dropped when the list changes, but the render
   * before that has both. So a letter that is on both is shown once.
   */
  const letters = (() => {
    const seen = new Set<number>();
    const all: any[] = [];
    for (const letter of [...(data?.letters ?? []), ...older]) {
      if (letter.kind === "todo") continue;
      if (seen.has(letter.id)) continue;
      seen.add(letter.id);
      all.push(letter);
    }
    return all;
  })();
  const todos = todosData?.todos ?? [];
  // How many there are, not how many are shown.
  const total = (data?.total ?? 0) as number;

  return (
    <div className="space-y-4">
      {showCrisis && <CrisisCard onClose={() => setShowCrisis(false)} />}
      {letters.length === 0 && !showWrite && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {/* "No letters yet" while the letters are still on their way
              is a false statement about the user's own data. */}
          {isLoading
            ? t("common.loading")
            // A failed request leaves the list empty — so "you have no
            // letters" was a claim about the user's own data, and it
            // was simply false.
            : isError
              ? t("common.error")
              : t("letters.empty")}
        </p>
      )}

      {letters.length > 0 && (
        <ol className="space-y-3">
          {letters.map((letter: any) => (
            <li
              key={letter.id}
              className="rounded-xl border border-border/70 p-4 group relative"
            >
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {letter.body}
              </p>
              <div className="flex items-center gap-3 mt-3 text-[0.625rem] text-muted-subtle">
                <span>{formatInstantInZone(letter.createdAt, locale, timezone)}</span>
                {letter.mood && (
                  /**
                   * The mood is named, not coded.
                   *
                   * The dictionary falls back to the key itself, so an
                   * unknown mood was shown as "moodCheckIn.moods.xyz" —
                   * and the server accepts any sixteen-character mood
                   * string.
                   */
                  <span>
                    {isUserMood(letter.mood)
                      ? t(`moodCheckIn.moods.${letter.mood}` as any)
                      : letter.mood}
                  </span>
                )}
                {letter.status === "private" && (
                  <span className="inline-flex items-center gap-1">
                    <X className="w-2.5 h-2.5" /> {t("letters.statusPrivate")}
                  </span>
                )}
                {letter.status === "waiting" && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" /> {t("letters.statusWaiting")}
                  </span>
                )}
              </div>
              {letter.replyText && (
                <div className="mt-3 pt-3 border-t border-border/60">
                  <p className="text-[0.625rem] text-muted-subtle mb-1.5">
                    {t("letters.reply")}
                  </p>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {letter.replyText}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  // A letter is the user's own writing. It is not
                  // thrown away by one click with nothing said.
                  if (!window.confirm(t("letters.removeConfirm"))) return;
                  remove.mutate({ id: letter.id });
                }}
                /**
                 * The button says which letter.
                 *
                 * Every one of them was "remove" — so a screen-reader
                 * user heard "remove, remove, remove" and could not
                 * tell which letter they were about to throw away.
                 */
                aria-label={t("letters.removeNamed", {
                  date: formatInstantInZone(letter.createdAt, locale, timezone),
                  preview: (letter.body ?? "").slice(0, 20),
                })}
                // The button is disabled while the removal is in flight:
                // two clicks meant two removals, and the second one
                // failed on a row that was already gone.
                disabled={remove.isPending}
                className="absolute top-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* The letters that are not on the screen. */}
      {total > letters.length && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("letters.moreCount", { count: total - letters.length })}
          </p>
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loadingOlder ? t("common.loading") : t("letters.loadOlder")}
          </button>
        </div>
      )}

      {/**
       * The notes for later.
       *
       * A failed request left the list empty — so the box said there
       * were none, which is a claim about the user's own writing.
       */}
      {todosFailed && (
        <p className="text-xs text-destructive" role="alert">{t("common.error")}</p>
      )}

      {todos.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
          <p className="text-xs font-medium text-foreground/80 mb-2">
            {t("letters.todoTitle")}
          </p>
          <ul className="space-y-1.5">
            {todos.map((todo: any) => (
              <li key={todo.id} className="text-xs text-muted-foreground leading-relaxed">
                · {todo.body}
              </li>
            ))}
          </ul>
          {/**
           * The list stops at twenty.
           *
           * So the user has to be told that there are more — otherwise
           * their own words are quietly not on the screen, and the box
           * says "here are your notes" and means "here are twenty of
           * them".
           */}
          {(todosData?.total ?? 0) > todos.length && (
            <p className="mt-2 text-[0.625rem] text-muted-subtle">
              {t("letters.todoCapped", { count: (todosData?.total ?? 0) - todos.length })}
            </p>
          )}
        </div>
      )}

      {showWrite ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          {/**
           * The field is named.
           *
           * It had a placeholder and nothing else, so a screen reader
           * announced it as "edit text" — and clicking the label did
           * nothing, because there was no label.
           */}
          <Label className="sr-only" htmlFor="letter-body">{t("letters.placeholder")}</Label>
          <Textarea
            id="letter-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("letters.placeholder")}
            maxLength={5000}
            rows={7}
            className="text-sm leading-relaxed"
          />
          {/**
           * The kind is a choice, and the choice is said out loud.
           *
           * The two buttons and the six moods showed their state only
           * in colour, so a screen-reader user got no feedback that a
           * choice had been made.
           */}
          <div className="flex gap-1.5" role="group" aria-label={t("letters.kindLabel")}>
            <button
              type="button"
              aria-pressed={kind === "letter"}
              onClick={() => setKind("letter")}
              className={`text-[0.625rem] px-2.5 py-1 rounded border transition-colors ${
                kind === "letter"
                  ? "border-primary/50 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("letters.kindLetter")}
            </button>
            <button
              type="button"
              aria-pressed={kind === "todo"}
              onClick={() => setKind("todo")}
              className={`text-[0.625rem] px-2.5 py-1 rounded border transition-colors ${
                kind === "todo"
                  ? "border-primary/50 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("letters.kindTodo")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("moodCheckIn.title")}>
            {USER_MOODS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mood === option}
                onClick={() => setMood(mood === option ? "" : option)}
                className={`text-[0.625rem] px-2 py-0.5 rounded border transition-colors ${
                  mood === option
                    ? "border-primary/50 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`moodCheckIn.moods.${option}` as any)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {kind === "todo" ? (
              <Button
                size="sm"
                className="rounded-md px-4"
                disabled={!body.trim() || write.isPending}
                onClick={() => write.mutate({
                  personaId,
                  body: body.trim(),
                  mood: mood || undefined,
                  kind: "todo",
                  deliver: false,
                  locale: locale === "en" ? "en" : "zh",
                })}
              >
                <Clock className="w-3.5 h-3.5" /> {t("letters.saveTodo")}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  className="rounded-md px-4"
                  disabled={!body.trim() || write.isPending}
                  onClick={() => write.mutate({
                    personaId,
                    body: body.trim(),
                    mood: mood || undefined,
                    deliver: false,
                    locale: locale === "en" ? "en" : "zh",
                  })}
                >
                  <PenLine className="w-3.5 h-3.5" /> {t("letters.keep")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-md px-4 bg-transparent"
                  disabled={!body.trim() || write.isPending}
                  onClick={() => write.mutate({
                    personaId,
                    body: body.trim(),
                    mood: mood || undefined,
                    deliver: true,
                    locale: locale === "en" ? "en" : "zh",
                  })}
                >
                  <Send className="w-3.5 h-3.5" /> {t("letters.deliver")}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setShowWrite(false)}>
              {t("common.cancel")}
            </Button>
          </div>
          <p className="text-[0.625rem] text-muted-subtle leading-relaxed">
            {t(kind === "todo" ? "letters.todoNote" : "letters.deliverNote")}
          </p>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="rounded-md text-xs bg-transparent" onClick={() => setShowWrite(true)}>
          <PenLine className="w-3.5 h-3.5" /> {t("letters.write")}
        </Button>
      )}
    </div>
  );
}
