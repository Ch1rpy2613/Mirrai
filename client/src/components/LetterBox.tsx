import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { PenLine, Send, Trash2, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

  const { data, isLoading } = trpc.letter.list.useQuery({ personaId });
  const { data: todosData } = trpc.letter.todos.useQuery({ personaId });
  const [showWrite, setShowWrite] = useState(false);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<UserMood | "">("");
  const [kind, setKind] = useState<"letter" | "todo">("letter");

  const write = trpc.letter.write.useMutation({
    onSuccess: (data) => {
      utils.letter.list.invalidate({ personaId });
      setBody("");
      setMood("");
      setShowWrite(false);
      toast.success(
        data.letter?.status === "waiting"
          ? t("letters.delivered")
          : t("letters.kept"),
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.letter.remove.useMutation({
    onSuccess: () => utils.letter.list.invalidate({ personaId }),
    onError: (e) => toast.error(e.message),
  });

  const letters = (data?.letters ?? []).filter((l: any) => l.kind !== "todo");
  const todos = todosData?.todos ?? [];

  return (
    <div className="space-y-4">
      {letters.length === 0 && !showWrite && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {/* "No letters yet" while the letters are still on their way
              is a false statement about the user's own data. */}
          {isLoading ? t("common.loading") : t("letters.empty")}
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
              <div className="flex items-center gap-3 mt-3 text-[0.625rem] text-muted-foreground/80">
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
                  <p className="text-[0.625rem] text-muted-foreground/70 mb-1.5">
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
                className="absolute top-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ol>
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
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("letters.placeholder")}
            maxLength={5000}
            rows={7}
            className="text-sm leading-relaxed"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
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
          <div className="flex flex-wrap gap-1.5">
            {USER_MOODS.map((option) => (
              <button
                key={option}
                type="button"
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
          <p className="text-[0.625rem] text-muted-foreground/80 leading-relaxed">
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
