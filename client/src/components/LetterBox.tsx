import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { PenLine, Send, Trash2, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { USER_MOODS, type UserMood } from "@shared/user-side";

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
  const { data: todosData } = trpc.letter.todos.useQuery({ personaId });
  const [showWrite, setShowWrite] = useState(false);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<UserMood | "">("");
  const [kind, setKind] = useState<"letter" | "todo">("letter");

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
      toast.success(
        /**
         * A note to say later is not a letter.
         *
         * The message was chosen by the status alone — and a note is
         * written as private, so the person who pressed "say it later"
         * was told "the letter is written. It will not be answered —
         * that is your choice." Which is true of the letter, and
         * nonsense of the note.
         */
        data.letter?.kind === "todo"
          ? t("letters.noteSaved")
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

  const letters = [...(data?.letters ?? []), ...older].filter((l: any) => l.kind !== "todo");
  const todos = todosData?.todos ?? [];
  // How many there are, not how many are shown.
  const total = (data?.total ?? 0) as number;

  return (
    <div className="space-y-4">
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
                <span>{new Date(letter.createdAt).toLocaleDateString(locale)}</span>
                {letter.mood && (
                  <span>{t(`moodCheckIn.moods.${letter.mood}` as any)}</span>
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
                aria-label={t("letters.remove")}
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
