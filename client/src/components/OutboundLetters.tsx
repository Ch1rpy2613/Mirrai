import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Send, Search, Check, X, Pencil, BookMarked } from "lucide-react";
import { daysWaiting, isStale } from "@shared/outbound";

/**
 * The way out.
 *
 * The graduation ends with a letter in the persona's voice. But what was
 * actually unfinished was never the persona's sentence — it was the
 * user's. They said things here that they never managed to say to the
 * person they were talking about, and saying them here was the useful
 * part.
 *
 * So the goodbye has an exit as well as a door: the words that were only
 * ever said to the persona, collected and handed back.
 *
 * Nothing is sent. The app never speaks for the person who is not in the
 * room — it can only put the words in front of the user and let them
 * decide. That is the whole contract, and it is why this component has
 * no "send" button: there is a "I said it" button, and that is a
 * different thing entirely.
 */
export default function OutboundLetters({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const { data, refetch } = trpc.outbound.list.useQuery({ personaId });
  const collectMutation = trpc.outbound.collect.useMutation({
    onSuccess: (result) => {
      if (result.saved) {
        toast.success(t("outbound.collected", { count: result.saved }));
      } else {
        toast.info(t("outbound.collectedNone"));
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sentMutation = trpc.outbound.markSent.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const dropMutation = trpc.outbound.drop.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const selfMutation = trpc.outbound.keepForSelf.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const staleMutation = trpc.outbound.markStaleNotified.useMutation({
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.outbound.updateText.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });

  const letters = data?.letters ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");

  /**
   * The letters that have been pointed out in this session.
   *
   * The reminder is said once — and "once" has to survive both a
   * refetch and a reload. The server records it, so a later session
   * stays quiet; this set keeps the line on screen for the rest of this
   * one, so that recording it does not make it blink away.
   */
  const mentioned = useRef(new Set<number>());

  useEffect(() => {
    for (const letter of letters) {
      if (!isStale(letter)) continue;
      if (letter.staleNotifiedAt || mentioned.current.has(letter.id)) continue;
      mentioned.current.add(letter.id);
      staleMutation.mutate({ id: letter.id });
    }
  }, [letters]);

  function beginEdit(id: number, current: string) {
    setEditing(id);
    setText(current);
  }

  function saveEdit(id: number) {
    updateMutation.mutate({ id, text });
    setEditing(null);
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">{t("outbound.title")}</h2>
          <Button
            size="sm"
            variant="outline"
            className="rounded-md px-4"
            onClick={() => collectMutation.mutate({ personaId })}
            disabled={collectMutation.isPending}
          >
            <Search className="w-3.5 h-3.5" />
            {collectMutation.isPending ? t("outbound.collecting") : t("outbound.collect")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("outbound.hint")}</p>
      </header>

      {letters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">
          {t("outbound.empty")}
        </p>
      ) : null}

      <ul className="space-y-3">
        {letters.map((letter: any) => (
          <li key={letter.id} className="rounded-xl border border-border/70 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {letter.status === "sent"
                  ? t("outbound.statusSent")
                  : letter.status === "dropped"
                    ? t("outbound.statusDropped")
                    : letter.status === "ready"
                      ? t("outbound.statusReady")
                      : t("outbound.statusDraft")}
              </Badge>
              {letter.sourceMessageId ? (
                <span className="text-[11px] text-muted-foreground/70">
                  {t("outbound.source")}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                {letter.status !== "sent" && letter.status !== "dropped" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("outbound.edit")}
                      onClick={() => beginEdit(letter.id, letter.text)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => sentMutation.mutate({ id: letter.id })}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("outbound.markSent")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selfMutation.mutate({ id: letter.id })}
                    >
                      <BookMarked className="h-3.5 w-3.5" />
                      {t("outbound.forSelf")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dropMutation.mutate({ id: letter.id })}
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("outbound.drop")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {isStale(letter) && (!letter.staleNotifiedAt || mentioned.current.has(letter.id)) ? (
              <p className="text-[11px] text-muted-foreground/80">
                {t("outbound.staleHint", { days: daysWaiting(letter) })}
              </p>
            ) : null}

            {editing === letter.id ? (
              <div className="space-y-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    {t("microRules.cancel")}
                  </Button>
                  <Button size="sm" onClick={() => saveEdit(letter.id)}>
                    <Send className="h-3.5 w-3.5" />
                    {t("microRules.save")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {letter.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
