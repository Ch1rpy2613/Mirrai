import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Send, ChevronDown, Trash2, MoreVertical, Loader2,
  Plus, Image, Mic, X, Play, Pause, Clock, BarChart3, Search, BookOpen, Theater,
  Volume2, Download, Check,
} from "lucide-react";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import GraduationModal from "@/components/GraduationModal";
import { streamChat, isStreamingUnsupported } from "@/lib/chat-stream";
import { careNoteText } from "@/lib/care-note";
import { useLocale } from "@/contexts/LocaleContext";
import { EMOTIONS, EMOTION_KEYS, emotionColor, type EmotionDefinition } from "@/lib/emotions";

interface Message {
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
}

/** The state of a message, or `null` when it is not a known state. */
function emotionOf(state: string | null | undefined): EmotionDefinition | null {
  return (EMOTIONS as Record<string, EmotionDefinition | undefined>)[state ?? ""] ?? null;
}

function VoicePlayer({ url, duration }: { url: string; duration?: number | null }) {
  const { t } = useLocale();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 波形高度固定一次，避免父组件重渲染（如录音计时每秒一次）时跳动
  const barHeights = useMemo(() => Array.from({ length: 12 }, () => 4 + Math.random() * 12), []);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
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
  const { t } = useLocale();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsMutation = trpc.chat.tts.useMutation();

  const handlePlay = async () => {
    if (audioUrl && audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false); }
      else { audioRef.current.play(); setPlaying(true); }
      return;
    }
    setLoading(true);
    try {
      const result = await ttsMutation.mutateAsync({ text: text.slice(0, 500) });
      setAudioUrl(result.audioUrl);
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch { toast.error(t("chat.ttsFailed")); }
    finally { setLoading(false); }
  };

  return (
    <button onClick={handlePlay} disabled={loading} title={t("chat.tts")} aria-label={t("chat.tts")}
      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30 p-1.5 -m-1">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className={`w-3 h-3 ${playing ? "text-foreground" : ""}`} />}
    </button>
  );
}

function MessageBubble({ msg, personaName, showMood }: { msg: Message; personaName: string; showMood: boolean }) {
  const { t, locale } = useLocale();
  const isUser = msg.role === "user";
  const mood = emotionOf(msg.emotionalState);
  const [imgExpanded, setImgExpanded] = useState(false);

  const renderContent = () => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <>
          <img src={msg.mediaUrl} alt="" onClick={() => setImgExpanded(true)}
            className="max-w-[200px] max-h-[200px] rounded-md cursor-pointer hover:opacity-90 transition-opacity" />
          {msg.content !== "[图片]" && <p className="mt-1.5 text-sm">{msg.content}</p>}
          {/* Portal：祖先的 animate-fade-in-up 以 forwards 保留 transform，会把 fixed 定位锚定到气泡上 */}
          {imgExpanded && createPortal(
            <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-fade-in"
              onClick={() => setImgExpanded(false)}>
              <img src={msg.mediaUrl!} alt="" className="max-w-full max-h-full object-contain rounded-md" />
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
          {msg.content && msg.content !== "（语音消息）" && (
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
    return <Streamdown className="letter-prose letter-prose--chat" parseIncompleteMarkdown>{msg.content}</Streamdown>;
  };

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4 animate-fade-in-up`}>
      {!isUser && (
        <PersonaAvatar name={personaName} className="w-8 h-8 rounded-full text-sm flex-shrink-0 mt-0.5" />
      )}
      <div className={`max-w-[78%] sm:max-w-[75%] flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && mood && showMood && (
          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border ${mood.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${mood.dot}`} />
            {t(mood.labelKey)}
          </span>
        )}
        <div className={`px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? "bubble-user" : "bubble-ai"}`}>
          {renderContent()}
        </div>
        {msg.createdAt && !msg.isStreaming && (
          <span className="text-[11px] text-muted-foreground/50 px-1 flex items-center gap-1.5">
            {new Date(msg.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
            {msg.channel === "wechat" && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-mood-happy/10 text-mood-happy">{t("chat.channelWechat")}</span>}
            {!isUser && msg.messageType !== "voice" && <TTSButton text={msg.content} />}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MAIN CHAT ────────────────────────────────────────────────────────────────

export default function Chat() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { t, locale } = useLocale();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [currentState, setCurrentState] = useState("warm");
  const [showStatePanel, setShowStatePanel] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showMenu, setShowMenu] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showEmotionReport, setShowEmotionReport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [showGraduation, setShowGraduation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Aborts an in-flight streaming request when the user stops the reply. */
  const abortRef = useRef<AbortController | null>(null);

  // 录音波形高度在一次录音内固定，避免计时每秒重渲染导致跳动
  const recordingBarHeights = useMemo(
    () => (isRecording ? Array.from({ length: 20 }, () => 4 + Math.random() * 16) : []),
    [isRecording]
  );

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); toast.success(t("chat.online")); };
    const onOffline = () => { setIsOnline(false); toast.error(t("chat.offline")); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [t]);

  const { data: persona } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: intimacy } = trpc.persona.getIntimacy.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: history } = trpc.chat.getHistory.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const sendMutation = trpc.chat.send.useMutation({
    onError: (e: any) => {
      toast.error(t("chat.failed", { message: e.message }));
      setIsSending(false);
    },
  });

  const clearMutation = trpc.chat.clear.useMutation({
    onSuccess: () => { setMessages([]); toast.success(t("chat.cleared")); setShowMenu(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: scenesList } = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });
  const activateSceneMutation = trpc.scene.activate.useMutation({
    onSuccess: () => { toast.success(t("chat.sceneActivated")); setShowScenePanel(false); },
  });
  const deactivateSceneMutation = trpc.scene.deactivate.useMutation({
    onSuccess: () => { toast.success(t("chat.sceneDeactivated")); setShowScenePanel(false); },
  });

  const activeScene = scenesList?.find((s: any) => s.id === persona?.activeSceneId);

  const changeStateMutation = trpc.persona.update.useMutation({
    onSuccess: () => toast.success(t("chat.stateChanged")),
  });

  const sendImageMutation = trpc.chat.sendImage.useMutation({
    onError: (e: any) => { toast.error(t("chat.imageFailed", { message: e.message })); setIsSending(false); },
  });

  const sendVoiceMutation = trpc.chat.sendVoice.useMutation({
    onError: (e: any) => { toast.error(t("chat.voiceFailed", { message: e.message })); setIsSending(false); },
  });

  const exportMutation = trpc.chat.export.useMutation();

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({ personaId });
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("chat.exportSuccess"));
    } catch (e: any) { toast.error(t("chat.exportFailed", { message: e.message })); }
  };

  useEffect(() => {
    if (history) {
      setMessages(history.map((m: any) => ({
        id: m.id, role: m.role as "user" | "assistant",
        content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl, mediaDuration: m.mediaDuration,
        emotionalState: m.emotionalState, channel: m.channel, createdAt: m.createdAt,
      })));
    }
  }, [history]);

  useEffect(() => {
    if (persona?.emotionalState) setCurrentState(persona.emotionalState);
  }, [persona?.emotionalState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    setIsSending(true);

    const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);

    const streamId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendDelta = (chunk: string) => {
      setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: m.content + chunk } : m));
    };

    try {
      try {
        await streamChat({
          personaId,
          message: text,
          locale: locale === "en" ? "en" : "zh",
          signal: controller.signal,
          callbacks: {
            onDelta: appendDelta,
            onEmotion: (state) => {
              setCurrentState(state);
              setMessages(prev => prev.map(m => m.id === streamId ? { ...m, emotionalState: state } : m));
            },
            onDone: (info) => {
              setMessages(prev => prev.map(m => m.id === streamId
                ? {
                    ...m,
                    id: `ai-${info.messageId}`,
                    content: m.content || t("chat.silence"),
                    emotionalState: info.emotionalState,
                    createdAt: new Date(),
                    isStreaming: false,
                  }
                : m
              ));
              setCurrentState(info.emotionalState);
              if (info.graduationSuggested) setShowGraduation(true);
              if (info.careNote?.showBanner) toast.info(careNoteText(info.careNote, t));
            },
            onError: (message) => {
              toast.error(t("chat.interrupted", { message }));
              setMessages(prev => prev.map(m => m.id === streamId ? { ...m, isStreaming: false } : m));
            },
          },
        });
      } catch (err) {
        // A server without the streaming route still works through the
        // ordinary mutation.
        const status = (err as { status?: number })?.status;
        if (!isStreamingUnsupported(status ?? 0)) throw err;

        const result = await sendMutation.mutateAsync({
          personaId,
          message: text,
          locale: locale === "en" ? "en" : "zh",
        });
        setMessages(prev => prev.map(m => m.id === streamId
          ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
          : m
        ));
        setCurrentState(result.emotionalState);
        if (result.graduationSuggested) setShowGraduation(true);
        if (result.careNote?.showBanner) toast.info(careNoteText(result.careNote, t));
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== streamId));
    } finally {
      abortRef.current = null;
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  /** Stops an in-flight streaming reply. */
  const handleStopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isSending) return;
    setShowAttach(false);
    setIsSending(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = URL.createObjectURL(file);
      const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "[图片]", messageType: "image", mediaUrl: localUrl, createdAt: new Date() };
      setMessages(prev => [...prev, userMsg]);
      const streamId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

      try {
        const result = await sendImageMutation.mutateAsync({ personaId, imageContent: base64, fileName: file.name, mimeType: file.type });
        setMessages(prev => prev.map(m => m.id === streamId
          ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
          : m
        ));
        setCurrentState(result.emotionalState);
      } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
      finally { setIsSending(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [isSending, personaId, currentState]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const duration = recordingTime;
          setIsRecording(false);
          setRecordingTime(0);
          setIsSending(true);

          const localUrl = URL.createObjectURL(blob);
          const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "（语音消息）", messageType: "voice", mediaUrl: localUrl, mediaDuration: duration, createdAt: new Date() };
          setMessages(prev => [...prev, userMsg]);
          const streamId = `stream-${Date.now()}`;
          setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

          try {
            const result = await sendVoiceMutation.mutateAsync({ personaId, audioContent: base64, duration, fileName: `voice-${Date.now()}.webm` });
            setMessages(prev => prev.map(m => {
              if (m.id === streamId) return { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false };
              if (m === userMsg) return { ...m, content: result.transcription || "（语音消息）" };
              return m;
            }));
            setCurrentState(result.emotionalState);
          } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
          finally { setIsSending(false); }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error(t("chat.micDenied")); }
  }, [personaId, currentState, recordingTime, t]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const mood = EMOTIONS[currentState as keyof typeof EMOTIONS] || EMOTIONS.warm;
  const moodRingStyle = { ["--mood-color" as string]: `var(${mood.cssVar})` };
  const starterQuestions: string[] = ((persona?.personaData as any)?.starterQuestions?.length > 0
    ? (persona?.personaData as any).starterQuestions
    : Array.from(t("chat.defaultStarters")));

  return (
    <div className="h-dvh bg-background flex flex-col relative">
      {/* Header */}
      <header className="sticky top-0 z-40 app-header flex-shrink-0">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} aria-label={t("common.back")}
            className="app-nav-back -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="mood-ring-sm flex-shrink-0" style={moodRingStyle}>
              <PersonaAvatar name={persona?.name || "?"} className="w-8 h-8 rounded-full text-sm" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="app-nav-title truncate">{persona?.name || "..."}</p>
                {intimacy && (
                  <span
                    className="text-xs flex-shrink-0"
                    title={t("chat.intimacyScore", {
                      level: t(`intimacy.${intimacy.level}` as any),
                      score: intimacy.score,
                    })}
                  >
                    {intimacy.icon}
                  </span>
                )}
                {activeScene && (
                  <span className="hidden md:inline-flex items-center max-w-[140px] truncate text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground">
                    {activeScene.icon} {activeScene.name}
                  </span>
                )}
              </div>
              <p className="app-nav-subtitle truncate">{persona?.relationshipDesc || "TA"}</p>
            </div>
          </div>

          <div className="app-nav-actions">
            {/* 情感状态切换 */}
            <div className="relative">
              <button onClick={() => setShowStatePanel(!showStatePanel)}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${mood.chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${mood.dot}`} />
                <span className="hidden sm:inline">{t(mood.labelKey)}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showStatePanel ? "rotate-180" : ""}`} />
              </button>
              {showStatePanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStatePanel(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" as const }}
                    className="absolute right-0 top-full mt-2 z-50 w-60 surface p-1.5">
                    <p className="kicker px-2.5 pt-2 pb-1.5">{t("chat.switchState")}</p>
                    {EMOTION_KEYS.map((key) => {
                      const m = EMOTIONS[key];
                      return (
                      <button key={key} onClick={() => {
                        changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
                        setCurrentState(key); setShowStatePanel(false);
                      }} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${currentState === key ? "bg-muted" : "hover:bg-muted/60"}`}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${m.dot}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-foreground leading-tight">{t(m.labelKey)}</span>
                          <span className="block text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{t(m.descKey)}</span>
                        </span>
                        {currentState === key && <Check className="w-3.5 h-3.5 text-foreground flex-shrink-0" />}
                      </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </div>

            <button onClick={() => setShowScenePanel(!showScenePanel)} title={t("chat.sceneMode")} aria-label={t("chat.sceneMode")}
              className={`app-nav-icon ${activeScene || showScenePanel ? "app-nav-icon-active" : ""}`}>
              <Theater className="w-4 h-4" />
            </button>
            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} aria-label={t("chat.moreActions")}
                className="app-nav-icon">
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" as const }}
                    className="absolute right-0 top-full mt-2 z-50 surface p-1.5 min-w-[168px]">
                    <button onClick={() => { setShowSearch(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <Search className="w-4 h-4 text-muted-foreground" />{t("chat.search")}
                    </button>
                    <button onClick={() => { setShowTimeline(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <Clock className="w-4 h-4 text-muted-foreground" />{t("chat.memoryTimeline")}
                    </button>
                    <button onClick={() => { setShowEmotionReport(true); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <BarChart3 className="w-4 h-4 text-muted-foreground" />{t("chat.emotionReport")}
                    </button>
                    <button onClick={() => { navigate(`/diary`); setShowMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />{t("diary.title")}
                    </button>
                    <button onClick={() => { handleExport(); setShowMenu(false); }} disabled={exportMutation.isPending}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors disabled:opacity-50">
                      <Download className="w-4 h-4 text-muted-foreground" />{t("chat.export")}
                    </button>
                    <button onClick={() => clearMutation.mutate({ personaId })}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors">
                      <Trash2 className="w-4 h-4" />{t("chat.clear")}
                    </button>
                  </motion.div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 场景模式面板 */}
        {showScenePanel && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowScenePanel(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" as const }}
              className="absolute inset-x-0 top-full z-40 px-4 pt-2">
              <div className="container max-w-2xl mx-auto">
                <div className="surface p-4 max-h-[70vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-display text-sm font-semibold text-foreground">{t("chat.sceneMode")}</p>
                    <button onClick={() => setShowScenePanel(false)} aria-label={t("common.close")}
                      className="app-nav-icon !h-7 !min-w-7">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {activeScene && (
                    <div className="mb-3 flex items-center gap-2 px-1">
                      <span className="text-xs text-muted-foreground">{t("chat.currentScene", { scene: `${activeScene.icon} ${activeScene.name}` })}</span>
                      <button onClick={() => deactivateSceneMutation.mutate({ personaId })}
                        className="text-xs text-destructive hover:underline">{t("chat.noScene")}</button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(scenesList || []).map((scene: any) => (
                      <button key={scene.id} onClick={() => activateSceneMutation.mutate({ personaId, sceneId: scene.id })}
                        className={`text-left p-3 rounded-md border transition-colors ${scene.id === persona?.activeSceneId ? "border-cinnabar/40 bg-cinnabar/5" : "border-border hover:border-foreground/30 hover:bg-muted/40"}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {scene.icon
                            ? <span className="text-base leading-none">{scene.icon}</span>
                            : <Theater className="w-4 h-4 text-muted-foreground" />}
                          <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{scene.name}</span>
                          {scene.id === persona?.activeSceneId && <Check className="w-3.5 h-3.5 text-cinnabar flex-shrink-0" />}
                        </div>
                        {scene.description && <p className="text-xs text-muted-foreground line-clamp-2">{scene.description}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </header>

      {showSearch && <SearchPanel personaId={personaId} onClose={() => { setShowSearch(false); setSearchQuery(""); }} />}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="container py-4 sm:py-6 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" as const }}
              className="text-center py-12 sm:py-16">
              <div className="mood-ring-sm inline-flex" style={moodRingStyle}>
                <PersonaAvatar name={persona?.name || "?"} className="w-16 h-16 sm:w-20 sm:h-20 rounded-full text-2xl sm:text-3xl" />
              </div>
              <h2 className="page-title mt-7">
                {t("chat.waitingForYou", { name: persona?.name || t("common.them") })}
              </h2>
              <p className="text-muted-foreground text-sm mt-2.5">{t(mood.descKey)}</p>
              <hr className="rule w-16 mx-auto my-8" />
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                {starterQuestions.map((q: string) => (
                  <button key={q} onClick={() => setInput(q)}
                    className="text-xs px-3.5 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowScenePanel(true)}
                className="mt-6 inline-flex items-center gap-2 text-xs px-4 py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                <Theater className="w-3.5 h-3.5" />
                {t("chat.pickScene")}
              </button>
            </motion.div>
          )}
          {messages.map((msg, i) => {
            // The mood chip is a signal, not decoration — showing it on every
            // message turns the conversation into a wall of labels. It only
            // appears when the mood actually shifts.
            const prevMood = [...messages.slice(0, i)]
              .reverse()
              .find(m => m.role === "assistant" && m.emotionalState);
            const showMood = Boolean(
              msg.role === "assistant" &&
              msg.emotionalState &&
              msg.emotionalState !== prevMood?.emotionalState,
            );
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                personaName={persona?.name || "?"}
                showMood={showMood}
              />
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 chat-composer">
        <div className="container pt-3 max-w-2xl mx-auto">
          {isRecording ? (
            <div className="flex items-center gap-3 h-11">
              <button onClick={cancelRecording} aria-label={t("chat.cancelRecording")}
                className="w-10 h-10 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-colors flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
              <div className="flex-1 flex items-center gap-2.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-destructive breathing-dot flex-shrink-0" />
                <span className="text-sm text-foreground whitespace-nowrap">{t("chat.recordingNow", { seconds: recordingTime })}</span>
                <div className="flex-1 flex items-center gap-0.5 px-2 overflow-hidden">
                  {recordingBarHeights.map((h, i) => (
                    <div key={i} className="w-1 rounded-full bg-primary/40 animate-pulse flex-shrink-0"
                      style={{ height: `${h}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <Button onClick={stopRecording} aria-label={t("chat.sendVoice")}
                className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <div className="relative">
                <button onClick={() => setShowAttach(!showAttach)} aria-label={t("chat.attach")}
                  className={`h-11 w-11 flex items-center justify-center rounded-md border transition-colors ${showAttach ? "text-foreground bg-muted border-border" : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"}`}>
                  <Plus className={`w-5 h-5 transition-transform ${showAttach ? "rotate-45" : ""}`} />
                </button>
                {showAttach && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAttach(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: "easeOut" as const }}
                      className="absolute bottom-full left-0 mb-2 z-50 surface p-1.5 min-w-[150px]">
                      <label className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors cursor-pointer">
                        <Image className="w-4 h-4 text-muted-foreground" />{t("chat.attachImage")}
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                      </label>
                      <button onClick={() => { setShowAttach(false); startRecording(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted/60 rounded-md transition-colors">
                        <Mic className="w-4 h-4 text-muted-foreground" />{t("chat.voiceMessageAction")}
                      </button>
                    </motion.div>
                  </>
                )}
              </div>
              <Textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={t("chat.placeholder", { name: persona?.name || t("common.them") })}
                rows={1} className="flex-1 resize-none bg-muted/40 border-border text-foreground placeholder:text-muted-foreground/50 rounded-md min-h-[44px] max-h-32 px-4 py-3" />
              {isSending ? (
                <Button onClick={handleStopStreaming} aria-label={t("chat.stop")}
                  className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                  <X className="w-5 h-5" />
                </Button>
              ) : (
                <Button onClick={handleSend} disabled={!input.trim() || !isOnline} aria-label={t("chat.send")}
                  className="h-11 w-11 p-0 rounded-md flex-shrink-0">
                  <Send className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}
          <p className="hidden sm:block text-muted-foreground/35 text-[10px] mt-1.5 text-right tracking-wide">
            {t("chat.enterToSend")}
          </p>
        </div>
      </div>

      {showTimeline && <MemoryTimeline personaId={personaId} onClose={() => setShowTimeline(false)} />}
      {showEmotionReport && <EmotionReport personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowEmotionReport(false)} />}
      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showGraduation} onClose={() => setShowGraduation(false)} />
    </div>
  );
}

// ─── SEARCH PANEL ────────────────────────────────────────────────────────────

function SearchPanel({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results } = trpc.chat.search.useQuery(
    { personaId, query: debouncedQuery },
    { enabled: debouncedQuery.length > 0 }
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val.trim()), 300);
  };

  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-cinnabar/20 text-foreground rounded-sm px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="bg-background border-b border-border animate-fade-in">
      <div className="container max-w-2xl mx-auto py-3">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-muted/40">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input value={query} onChange={e => handleChange(e.target.value)} autoFocus
            placeholder={t("chat.searchPlaceholder")} className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none" />
          <button onClick={onClose} aria-label={t("chat.closeSearch")} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        {debouncedQuery && results && (
          <div className="mt-3 max-h-64 overflow-y-auto space-y-1.5">
            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">{t("chat.noResults")}</p>
            ) : (
              results.map((m: any) => (
                <div key={m.id} className="flex items-start gap-2 px-2.5 py-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" onClick={onClose}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm flex-shrink-0 mt-0.5 ${m.role === "user" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {m.role === "user" ? t("common.me") : t("common.them")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground line-clamp-2">{highlight(m.content, debouncedQuery)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(m.createdAt).toLocaleDateString(locale)} {new Date(m.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MEMORY TIMELINE ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { labelKey: "chat.memory.categories.memory" | "chat.memory.categories.milestone" | "chat.memory.categories.anniversary" | "chat.memory.categories.anchor"; dot: string; chip: string }> = {
  milestone: { labelKey: "chat.memory.categories.milestone", dot: "bg-mood-playful", chip: "bg-mood-playful/10 text-mood-playful" },
  memory: { labelKey: "chat.memory.categories.memory", dot: "bg-primary", chip: "bg-primary/10 text-primary" },
  anniversary: { labelKey: "chat.memory.categories.anniversary", dot: "bg-chart-2", chip: "bg-chart-2/10 text-chart-2" },
  anchor: { labelKey: "chat.memory.categories.anchor", dot: "bg-chart-4", chip: "bg-chart-4/10 text-chart-4" },
};

function MemoryTimeline({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const { t } = useLocale();
  const { data: memories, refetch } = trpc.memory.list.useQuery({ personaId });
  const createMutation = trpc.memory.create.useMutation({ onSuccess: () => { refetch(); setShowAdd(false); } });
  const deleteMutation = trpc.memory.delete.useMutation({ onSuccess: () => refetch() });
  const extractMutation = trpc.memory.autoExtract.useMutation({
    onSuccess: (data) => { refetch(); toast.success(t("chat.memory.extracted", { count: data.extracted.length })); },
    onError: (e: any) => toast.error(e.message),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "memory" as "memory" | "milestone" | "anniversary" | "anchor", date: "" });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-sm bg-card border-l border-border h-full flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground">{t("chat.memoryTimeline")}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => extractMutation.mutate({ personaId })} disabled={extractMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-md border border-cinnabar/30 text-cinnabar hover:bg-cinnabar/5 transition-colors disabled:opacity-50">
              {extractMutation.isPending ? t("chat.memory.extracting") : t("chat.memory.extract")}
            </button>
            <button onClick={onClose} aria-label={t("common.close")} className="app-nav-icon !h-8 !min-w-8"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {(!memories || memories.length === 0) && !showAdd && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{t("chat.memory.empty")}</p>
              <p className="text-xs mt-1">{t("chat.memory.emptyHint")}</p>
            </div>
          )}

          <div className="relative">
            {memories && memories.length > 0 && <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />}
            {memories?.map((m: any) => {
              const cat = CATEGORY_LABELS[m.category] || CATEGORY_LABELS.memory;
              return (
                <div key={m.id} className="relative pl-8 pb-6 group">
                  <div className={`absolute left-1.5 top-1 w-3 h-3 rounded-full ${cat.dot} ring-2 ring-card`} />
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${cat.chip}`}>{t(cat.labelKey)}</span>
                      {m.date && <span className="text-xs text-muted-foreground ml-2">{m.date}</span>}
                      <p className="text-sm font-medium text-foreground mt-1">{m.title}</p>
                      {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                    </div>
                    <button onClick={() => deleteMutation.mutate({ id: m.id })} aria-label={t("chat.memory.delete")}
                      className="md:opacity-0 md:group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {showAdd && (
            <div className="mt-4 p-3.5 bg-muted/40 rounded-md border border-border space-y-2">
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t("chat.memory.titlePlaceholder")} className="w-full text-sm bg-transparent border-b border-border pb-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none" />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t("chat.memory.descriptionPlaceholder")} rows={2} className="w-full text-xs bg-transparent border-b border-border pb-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none resize-none" />
              <div className="flex gap-2">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as "memory" | "milestone" | "anniversary" | "anchor" }))}
                  className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground">
                  <option value="memory">{t("chat.memory.categories.memory")}</option>
                  <option value="milestone">{t("chat.memory.categories.milestone")}</option>
                  <option value="anniversary">{t("chat.memory.categories.anniversary")}</option>
                  <option value="anchor">{t("chat.memory.categories.anchor")}</option>
                </select>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 text-foreground" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setShowAdd(false)} className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">{t("common.cancel")}</button>
                <button onClick={() => { if (form.title.trim()) createMutation.mutate({ personaId, ...form }); }}
                  disabled={!form.title.trim() || createMutation.isPending}
                  className="text-xs px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50">{t("common.save")}</button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border">
          <button onClick={() => { setShowAdd(true); setForm({ title: "", description: "", category: "memory", date: "" }); }}
            className="w-full flex items-center justify-center gap-1.5 text-sm py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors">
            <Plus className="w-4 h-4" />{t("chat.memory.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EMOTION REPORT ──────────────────────────────────────────────────────────

function EmotionReport({ personaId, personaName, onClose }: { personaId: number; personaName: string; onClose: () => void }) {
  const { t } = useLocale();
  const [days, setDays] = useState(30);
  const { data: report } = trpc.emotion.getReport.useQuery({ personaId, days });

  const chartData = (report?.snapshots || []).map((s: any) => ({
    date: s.date,
    value: EMOTION_KEYS.indexOf(s.emotionalState) + 1,
    state: s.emotionalState,
    label: emotionOf(s.emotionalState) ? t(emotionOf(s.emotionalState)!.labelKey) : s.emotionalState,
    messages: s.messageCount,
  }));

  const pieData = (report?.distribution || []).map((d: any) => ({
    name: emotionOf(d.emotionalState) ? t(emotionOf(d.emotionalState)!.labelKey) : d.emotionalState,
    value: Number(d.count),
    fill: emotionColor(d.emotionalState),
  }));

  const mostCommon = pieData.length > 0 ? pieData.reduce((a: any, b: any) => a.value > b.value ? a : b) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative surface w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10 rounded-t-lg">
          <h3 className="card-title">
            <span className="font-sans">{personaName}</span> {t("chat.emotionReport")}
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex bg-muted rounded-md p-0.5">
              {[7, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${days === d ? "bg-card text-foreground" : "text-muted-foreground"}`}>
                  {t("chat.report.days", { count: d })}
                </button>
              ))}
            </div>
            <button onClick={onClose} aria-label={t("common.close")} className="app-nav-icon !h-8 !min-w-8"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center">
              <p className="stat-value">{report?.totalDays || 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("chat.report.chatDays")}</p>
            </div>
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center">
              <p className="stat-value">{report?.totalMessages || 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("chat.report.messages")}</p>
            </div>
            <div className="bg-muted/40 border border-border rounded-md p-3 text-center flex flex-col items-center justify-center">
              {mostCommon
                ? <span className="w-5 h-5 rounded-full mt-1" style={{ backgroundColor: mostCommon.fill }} />
                : <p className="stat-value">—</p>}
              <p className="text-xs text-muted-foreground mt-1.5">{mostCommon?.name || t("chat.report.noData")}</p>
            </div>
          </div>

          {chartData.length > 0 ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-3">{t("chat.report.trend")}</p>
                <div className="h-40 flex items-end gap-1">
                  {chartData.map((d: any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={t("chat.report.barTitle", { date: d.date, label: d.label, count: d.messages })}>
                      <div className="w-full rounded-t-sm transition-all hover:opacity-80"
                        style={{ height: `${(d.value / 6) * 100}%`, backgroundColor: emotionColor(d.state), minHeight: "4px" }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">{chartData[0]?.date}</span>
                  <span className="text-[10px] text-muted-foreground">{chartData[chartData.length - 1]?.date}</span>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground mb-3">{t("chat.report.distribution")}</p>
                <div className="space-y-2">
                  {pieData.map((d: any) => {
                    const total = pieData.reduce((s: number, p: any) => s + p.value, 0);
                    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs text-foreground w-12">{d.name}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: d.fill }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>{t("chat.report.empty")}</p>
              <p className="text-xs mt-1">{t("chat.report.emptyHint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
