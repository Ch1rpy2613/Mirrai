import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Search, MessageSquare, User, X, Bookmark, BookOpen } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * The command palette.
 *
 * A person looking for something they said six months ago does not
 * remember which conversation it was in, and does not want to open four
 * personas to find out. ⌘K searches everything at once.
 */
export default function CommandPalette() {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const personas = trpc.persona.list.useQuery(undefined, { enabled: open });
  const results = trpc.chat.searchAll.useQuery(
    { query: query.trim(), limit: 20 },
    { enabled: open && query.trim().length > 0 },
  );

  // ⌘K / Ctrl-K, and Escape to close.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Wait for the dialog to mount before focusing.
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const matchingPersonas = useMemo(() => {
    const list = (personas.data ?? []) as any[];
    const needle = query.trim().toLowerCase();
    if (!needle) return list.slice(0, 6);
    return list
      .filter((p) =>
        `${p.name} ${p.relationshipDesc ?? ""}`.toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [personas.data, query]);

  const matchingMessages = (results.data ?? []) as any[];

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  /**
   * A real dialog.
   *
   * The palette used to be two plain `div`s over the page: it was not
   * announced as a dialog, it did not trap the focus, and a keyboard
   * user tabbed straight out of it and landed on the page behind the
   * overlay. Radix gives all of that, and gives the focus back to
   * where it was when the palette closes.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-w-lg gap-0 p-0 overflow-hidden animate-fade-in"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {/* The name of the dialog, for a screen reader. */}
        <DialogTitle className="sr-only">{t("commandPalette.title")}</DialogTitle>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("commandPalette.placeholder")}
            aria-label={t("commandPalette.placeholder")}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
          />
          <button
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {matchingPersonas.length > 0 && (
            <div className="mb-2">
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground/70 px-2 py-1.5">
                {t("commandPalette.personas")}
              </p>
              {matchingPersonas.map((persona) => (
                <button
                  key={persona.id}
                  onClick={() => go(`/chat/${persona.id}`)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted/50 transition-colors text-left"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">{persona.name}</span>
                  {persona.relationshipDesc && (
                    <span className="text-xs text-muted-foreground truncate">
                      {persona.relationshipDesc}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {matchingMessages.length > 0 && (
            <div>
              <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground/70 px-2 py-1.5">
                {t("commandPalette.messages")}
              </p>
              {matchingMessages.map((message) => (
                <button
                  key={`${message.kind}-${message.personaId}-${message.id}`}
                  onClick={() => go(`/chat/${message.personaId}`)}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted/50 transition-colors text-left"
                >
                  {message.kind === "memory"
                    ? <Bookmark className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    : message.kind === "diary"
                      ? <BookOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      : <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-muted-foreground">
                      {message.personaName}
                      {message.kind !== "message" && (
                        <span className="ml-1.5 opacity-70">
                          {t(`commandPalette.kinds.${message.kind}` as any)}
                        </span>
                      )}
                    </span>
                    {message.title && (
                      <span className="block text-sm text-foreground font-medium">
                        {message.title}
                      </span>
                    )}
                    <span className="block text-sm text-foreground line-clamp-2">
                      {message.content}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* The search is still running.
              The data is `undefined` while the query key changes, so the
              palette flashed "no results" before the first results
              arrived — and again on every keystroke. A wrong answer
              where a pending one belongs. */}
          {query.trim() && results.isFetching && (
            <p className="text-xs text-muted-foreground text-center py-6" role="status">
              {t("commandPalette.searching")}
            </p>
          )}

          {query.trim() && !results.isFetching && matchingPersonas.length === 0 && matchingMessages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {t("commandPalette.noResults")}
            </p>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[0.625rem] text-muted-foreground/70">
          {t("commandPalette.hint")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
