import { useState, useRef, useMemo, useEffect } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { createPortal } from "react-dom";
import {
  ChevronDown, Trash2, Loader2, Play, Pause, Volume2,
  Copy, Pencil, RefreshCw, CornerUpLeft, Mail, Sparkles, X,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { EMOTIONS, type EmotionDefinition } from "@/lib/emotions";
import { SAFE_REHYPE_PLUGINS } from "@/lib/safe-markdown";
import { formatTimeInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * A message in the conversation.
 *
 * It lives here rather than in the chat page because the page is two
 * thousand lines long and this is the piece that has to be right: the
 * bubble is where a person copies, quotes, edits, repeats and removes what
 * they said.
 */
export interface Message {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "voice" | "image";
  mediaUrl?: string | null;
  mediaDuration?: number | null;
  emotionalState?: string;
  channel?: string;
  createdAt?: Date;
  isStreaming?: boolean;
  /** The message this one replies to. */
  replyToId?: number | null;
  /** The quoted text, for the bubble. */
  replyToContent?: string | null;
  /** The memories that were injected into this turn. */
  recalled?: Array<{ id: number; title: string; subject: string }>;
  /**
   * Where the message came from, when it is not an ordinary turn.
   *
   * "letter" — the answer to a letter the user wrote.
   * "proactive" — the persona spoke first.
   */
  origin?: "letter" | "proactive" | null;
}
/** The state of a message, or `null` when it is not a known state. */
export function emotionOf(state: string | null | undefined): EmotionDefinition | null {
  return (EMOTIONS as Record<string, EmotionDefinition | undefined>)[state ?? ""] ?? null;
}
function VoicePlayer({ url, duration }: { url: string; duration?: number | null }) {
  const { t } = useLocale();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 波形高度固定一次，避免父组件重渲染（如录音计时每秒一次）时跳动
  const barHeights = useMemo(() => Array.from({ length: 12 }, () => 4 + Math.random() * 12), []);

  // The clip stops when the bubble goes away.
  //
  // The audio element was never paused and never released, so the
  // recording carried on over whatever page the user had navigated to,
  // and its `onended` then set state on a component that was no longer
  // there.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else {
      // The play can be refused — the browser blocks it without a
      // gesture, or the blob is gone — and the refusal was an unhandled
      // rejection: the button then said "pause" while nothing played.
      audioRef.current.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
  };

  return (
    <button onClick={toggle} aria-label={playing ? t("chat.pauseVoice") : t("chat.playVoice")} className="flex items-center gap-2 min-w-[120px]">
      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      <div className="flex-1 flex items-center gap-0.5">
        {barHeights.map((h, i) => (
          <div key={i} className={`w-1 rounded-full bg-current transition-all ${playing ? "animate-pulse" : ""}`}
            style={{ height: `${h}px`, animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>
      {duration != null && <span className="text-xs opacity-60">{duration}″</span>}
    </button>
  );
}
function TTSButton({ text }: { text: string }) {
  const { t, locale } = useLocale();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsMutation = trpc.chat.tts.useMutation();

  /* The voice used to be hardcoded, so every persona in every language
     spoke with the same one. It is part of who somebody is, so it is the
     user's call — and it is remembered between sessions. */
  const [voice, setVoice] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mirrai.tts.voice");
    } catch {
      return null;
    }
  });
  /**
   * The voices, and whether the read-aloud may be used at all.
   *
   * The voice is an online service — the text of the reply goes to
   * Microsoft. So the operator can switch it off, and the button is
   * hidden then: offering a button that only fails is worse than not
   * offering it.
   */
  const { data: voiceData } = trpc.chat.voices.useQuery(
    { locale: locale === "en" ? "en" : "zh" },
    { staleTime: 60_000 },
  );

  // The clip stops when the bubble goes away.
  //
  // The audio element was never paused and never released, so the
  // speech carried on after the user had navigated off, and its
  // `onended` then set state on a component that was no longer there.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // The voice menu closes when the user clicks anywhere else.
  //
  // There was no click-outside handler anywhere in the interface, so the
  // menu stayed open over the conversation until a voice was picked.
  const menuRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showVoices) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setShowVoices(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowVoices(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showVoices]);

  const handlePlay = async () => {
    if (audioUrl && audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false); }
      else {
        // The play can be refused — the browser blocks it without a
        // gesture, or the file is gone — and the refusal was an
        // unhandled rejection: the button then said "pause" while
        // nothing played.
        audioRef.current.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
      }
      return;
    }
    setLoading(true);
    try {
      const result = await ttsMutation.mutateAsync({
        text: text.slice(0, 500),
        voice: voice ?? undefined,
      });
      setAudioUrl(result.audioUrl);
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      // And here too: the refusal must not be an unhandled rejection.
      await audio.play();
      setPlaying(true);
    } catch { toast.error(t("chat.ttsFailed")); }
    finally { setLoading(false); }
  };

  /**
   * The button is not offered when the read-aloud is switched off.
   *
   * The voice is Microsoft's online speech service: the text of the
   * reply is streamed to them. The app's promise is that the data does
   * not leave the machine — so an operator can switch this off, and
   * then the button is gone rather than failing.
   */
  /**
   * The button is not offered unless the read-aloud is on.
   *
   * It used to be hidden only when the query had *succeeded* and said
   * so. While the query was still on its way — or when it had failed —
   * the button was there, and pressing it produced "the voice could not
   * be made". Offering a button that only fails is worse than not
   * offering it.
   */
  if (!voiceData || voiceData.enabled === false) return null;

  return (
    <span className="relative inline-flex items-center" ref={menuRef}>
    <button onClick={handlePlay} disabled={loading} title={t("chat.tts")} aria-label={t("chat.tts")}
      className="text-muted-subtle hover:text-muted-foreground transition-colors disabled:opacity-30 p-1.5 -m-1">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className={`w-3 h-3 ${playing ? "text-foreground" : ""}`} />}
    </button>
    <button
      onClick={() => setShowVoices((value) => !value)}
      title={t("chat.ttsVoice")}
      aria-label={t("chat.ttsVoice")}
      className="text-muted-subtle hover:text-muted-foreground transition-colors p-1 -m-1"
    >
      <ChevronDown className="w-2.5 h-2.5" />
    </button>
    {showVoices && (
      <div className="absolute z-20 mt-1 min-w-[160px] rounded-lg border border-border bg-elevated shadow-lg py-1">
        {(voiceData?.voices ?? []).map((option) => (
          <button
            key={option.id}
            onClick={() => {
              setVoice(option.id);
              setAudioUrl(null);
              setShowVoices(false);
              try {
                localStorage.setItem("mirrai.tts.voice", option.id);
              } catch {
                // A browser that will not keep the choice is not a problem.
              }
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-muted/60 ${voice === option.id ? "text-foreground" : "text-muted-foreground"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    )}
    </span>
  );
}
export function MessageBubble({
  msg,
  personaName,
  showMood,
  onRegenerate,
  onEdit,
  onDelete,
  deleting,
  onQuote,
}: {
  msg: Message;
  personaName: string;
  showMood: boolean;
  onRegenerate?: (msg: Message) => void;
  /**
   * Saves an edit.
   *
   * It returns a promise, and the editor stays open until it settles:
   * the bubble used to close at once, so a failed save threw the
   * user's rewritten words away with no way of getting them back — the
   * only trace was the error toast.
   */
  onEdit?: (msg: Message, content: string) => Promise<void> | void;
  /**
   * Deletes a message.
   *
   * The bubble is told whether the delete is in flight, so the button
   * can be put out of reach while it is — a double click used to send
   * two deletes, and the second failed after the first had already
   * reported success.
   */
  onDelete?: (msg: Message) => void;
  /** Whether a delete is in flight. */
  deleting?: boolean;
  onQuote?: (msg: Message) => void;
}) {
  const { t, locale } = useLocale();
  /**
   * The user's own clock.
   *
   * The times on the messages were the browser's — so on a machine
   * whose zone is not the user's, every message carried a different
   * time from the dates around it.
   */
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const isUser = msg.role === "user";
  const mood = emotionOf(msg.emotionalState);
  const [imgExpanded, setImgExpanded] = useState(false);
  /**
   * The lightbox.
   *
   * It is a dialog, so the focus goes into it when it opens and comes
   * back to the picture when it closes. The focus stayed on the
   * conversation behind it, so a keyboard user was tabbing through the
   * page *behind* a visually modal panel.
   */
  const pictureRef = useRef<HTMLButtonElement | null>(null);

  /**
   * The lightbox.
   *
   * The focus used to be moved with `lightboxRef.current?.focus()` —
   * and the element it pointed at was a `div` with no `tabIndex`, so
   * the call did nothing. The focus stayed on the picture button
   * *behind* the overlay, and because the overlay is portalled to the
   * body it is not that button's ancestor — so the Escape handler on
   * the overlay never received the key. Escape did nothing, and Tab
   * walked the page behind a visually modal panel.
   */
  const lightboxRef = useDialogFocus<HTMLDivElement>(imgExpanded, () => setImgExpanded(false));
  const [editing, setEditing] = useState(false);
  /** Whether the edit is on its way to the server. */
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(msg.content);

  const renderContent = () => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <>
          {/* The picture is named.
              An empty alt says "decorative", which is right for an
              ornament and wrong for the only thing in the message — a
              reader was told there was nothing there. */}
          {/**
           * The picture is a button.
           *
           * It was a picture with a click handler, so a keyboard user
           * could not open it at all.
           */}
          <button type="button"
            ref={pictureRef}
            onClick={() => setImgExpanded(true)}
            aria-label={t("chat.imageAlt")}
            className="block rounded-md cursor-pointer hover:opacity-90 transition-opacity">
            <img src={msg.mediaUrl} alt={t("chat.imageAlt")}
              className="max-w-[200px] max-h-[200px] rounded-md" />
          </button>
          {/**
           * The caption under the picture.
           *
           * The picture's own text is a placeholder — "[图片]" — and it
           * was compared with the *current* language's copy of it. So a
           * person who sent a picture in Chinese and then changed the
           * interface to English saw "[图片]" under their own picture,
           * in an English conversation.
           *
           * The message's own kind says what it is, so the caption is
           * hidden for a picture — whatever language the placeholder was
           * written in.
           */}
          {msg.messageType !== "image" && msg.content !== t("chat.imageMessage") && (
            <p className="mt-1.5 text-sm">{msg.content}</p>
          )}
          {/* Portal：祖先的 animate-fade-in-up 以 forwards 保留 transform，会把 fixed 定位锚定到气泡上 */}
          {/**
           * The enlarged picture is a dialog.
           *
           * It used to be a `div` over the page: it was not announced
           * as a dialog, it did not trap the focus, and Escape did not
           * close it — a keyboard user was left inside it with no way
           * out but the picture itself.
           */}
          {imgExpanded && createPortal(
            <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-fade-in"
              role="dialog"
              aria-modal="true"
              aria-label={t("chat.imageAlt")}
              ref={lightboxRef}
              onClick={() => setImgExpanded(false)}>
              <img src={msg.mediaUrl!} alt={t("chat.imageAlt")} className="max-w-full max-h-full object-contain rounded-md" />
              <button type="button" onClick={() => setImgExpanded(false)}
                aria-label={t("common.close")}
                className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>,
            document.body
          )}
        </>
      );
    }
    if (msg.messageType === "voice" && msg.mediaUrl) {
      return (
        <div className="flex flex-col gap-1">
          <VoicePlayer url={msg.mediaUrl} duration={msg.mediaDuration} />
          {msg.content && msg.content !== t("chat.voiceMessage") && (
            <p className="text-xs opacity-60 mt-1">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.isStreaming) {
      if (!msg.content) {
        return (
          <span className="inline-flex items-center gap-1 px-0.5 py-1.5">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        );
      }
      return <span>{msg.content}<span className="inline-block w-1 h-4 bg-primary/40 ml-0.5 animate-pulse" /></span>;
    }
    if (isUser) return <span>{msg.content}</span>;
    return (
      <Streamdown
        className="letter-prose letter-prose--chat"
        parseIncompleteMarkdown
        rehypePlugins={SAFE_REHYPE_PLUGINS}
      >{msg.content}</Streamdown>
    );
  };

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4 animate-fade-in-up`}>
      {!isUser && (
        <>
          {/* The persona's name, for a screen reader.
              The avatar is `aria-hidden`, and the name was nowhere else
              in the bubble — so a reader could not tell which persona a
              given message came from, which in an app with several of
              them is the context that matters. */}
          <span className="sr-only">{personaName}</span>
          <PersonaAvatar name={personaName} className="w-8 h-8 rounded-full text-sm flex-shrink-0 mt-0.5" />
        </>
      )}
      <div className={`max-w-[78%] sm:max-w-[75%] flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && mood && showMood && (
          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border ${mood.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${mood.dot}`} />
            {t(mood.labelKey)}
          </span>
        )}
        {/* Where it came from. The answer to a letter and a message that
            started the conversation are both different from an ordinary
            turn, and the difference is the point. */}
        {isUser && msg.origin === "letter" && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-border/70 text-muted-foreground">
            <Mail className="w-3 h-3" /> {t("chat.letterSent")}
          </span>
        )}
        {!isUser && msg.origin && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-border/70 text-muted-foreground">
            {msg.origin === "letter" ? <Mail className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            {t(msg.origin === "letter" ? "chat.answerToLetter" : "chat.spokeFirst")}
          </span>
        )}
        {/* What the persona had in mind when it answered.
            The retrieval used to be entirely invisible, so the persona
            could bring up something from three months ago and there was
            no way to know it had been recalled rather than invented. */}
        {!isUser && msg.recalled && msg.recalled.length > 0 && (
          <details className="group w-full">
            <summary className="cursor-pointer list-none text-[11px] text-muted-subtle hover:text-muted-foreground transition-colors flex items-center gap-1">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              {t("chat.recalled", { count: msg.recalled.length })}
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {msg.recalled.map((memory) => (
                <li key={memory.id} className="text-[11px] text-muted-subtle leading-relaxed">
                  · {memory.title}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className={`px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? "bubble-user" : "bubble-ai"}`}>
          {msg.replyToContent && !editing && (
            <div className="mb-2 pl-2 border-l-2 border-current/25 text-xs text-current/60 line-clamp-2">
              {msg.replyToContent}
            </div>
          )}
          {editing ? (
            <div className="space-y-2 min-w-[220px]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
                autoFocus
                rows={Math.min(6, Math.ceil(draft.length / 28) + 1)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary/50 resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const text = draft.trim();
                    if (!text || saving) return;
                    /**
                     * The editor stays open until the server has taken
                     * the text.
                     *
                     * It used to close at once, so a failed save threw
                     * the user's rewritten words away with no way of
                     * getting them back — the only trace was the error
                     * toast.
                     */
                    setSaving(true);
                    try {
                      await onEdit?.(msg, text);
                      setEditing(false);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  /**
                   * The button is not disabled while the save is on its
                   * way.
                   *
                   * So a double click sent the same edit twice — and a
                   * second one that arrived after the first was written
                   * was a second write of the same words, with the
                   * editor's own state behind it.
                   */
                  disabled={!draft.trim() || saving}
                  className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => { setDraft(msg.content); setEditing(false); }}
                  className="text-xs px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            renderContent()
          )}
        </div>
        {msg.createdAt && !msg.isStreaming && (
          <span className="text-[11px] text-muted-subtle px-1 flex items-center gap-1.5">
            {/**
             * The time of the message, in the user's own clock.
             *
             * It was the browser's — so a message sent at half past nine
             * at night in Shanghai was stamped half past one in the
             * afternoon on a machine set to UTC, and the messages on
             * the screen were in a different clock from the dates
             * around them.
             */}
            {formatTimeInZone(msg.createdAt, locale, timezone)}
            {msg.channel === "wechat" && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-mood-happy/10 text-mood-happy">{t("chat.channelWechat")}</span>}
            {!isUser && msg.messageType !== "voice" && <TTSButton text={msg.content} />}
            {/* A message is the user's own. Being able to fix, repeat or
                remove one is what makes it a conversation rather than a
                transcript. */}
            {!editing && (
              <span className="inline-flex items-center gap-0.5">
                {msg.content && (
                  <button
                    type="button"
                    onClick={async () => {
                      // The write is awaited and reported.
                      //
                      // It used to be fired and forgotten: a browser that
                      // refuses the write — an insecure context, a
                      // permission that was not given — showed nothing at
                      // all, and there is no handler anywhere in the
                      // interface for an unhandled rejection.
                      try {
                        await navigator.clipboard.writeText(msg.content);
                        toast.success(t("chat.copied"));
                      } catch {
                        toast.error(t("chat.copyFailed"));
                      }
                    }}
                    title={t("chat.copy")}
                    aria-label={t("chat.copy")}
                    className="text-muted-subtle hover:text-muted-foreground transition-colors p-0.5"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
                {onQuote && (
                  <button
                    type="button"
                    onClick={() => onQuote(msg)}
                    title={t("chat.quote")}
                    aria-label={t("chat.quote")}
                    className="text-muted-subtle hover:text-muted-foreground transition-colors p-0.5"
                  >
                    <CornerUpLeft className="w-3 h-3" />
                  </button>
                )}
                {isUser && onEdit && (
                  <button
                    type="button"
                    onClick={() => { setDraft(msg.content); setEditing(true); }}
                    title={t("chat.edit")}
                    aria-label={t("chat.edit")}
                    className="text-muted-subtle hover:text-muted-foreground transition-colors p-0.5"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                {!isUser && onRegenerate && (
                  <button
                    type="button"
                    onClick={() => onRegenerate(msg)}
                    title={t("chat.regenerate")}
                    aria-label={t("chat.regenerate")}
                    className="text-muted-subtle hover:text-muted-foreground transition-colors p-0.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(msg)}
                    disabled={deleting}
                    title={t("chat.delete")}
                    aria-label={t("chat.delete")}
                    className="text-muted-subtle hover:text-destructive transition-colors p-0.5 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
