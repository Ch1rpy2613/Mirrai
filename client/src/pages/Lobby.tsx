import { useState, useMemo, useEffect, useRef, useId, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Plus, MessageCircle, Upload, Trash2, Sparkles, Clock, LogOut,
  Settings, Pencil, Users, CalendarDays, FileText,
  Wifi, Heart, Brain, Star, Lightbulb,
  Zap, Coffee, Search, Flame, Gift,
  ArrowUpDown, Eye, Bookmark, Activity, Palette, BookOpen,
  GraduationCap, Sunrise, Sun, Moon, CloudSun, Sunset,
  Handshake, HeartHandshake,
  Cloud, Waves, Tornado, Trophy, Gem, Sprout, Medal, MessagesSquare,
  Library, Lock, Drama, Shield, X, Pin, ChevronDown, CheckSquare, Square, PauseCircle,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import PageLoader from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { normaliseLoveLanguage } from "@shared/love-language";
import MoodCheckIn from "@/components/MoodCheckIn";
import { EMOTIONS, EMOTION_KEYS, emotionColor, type EmotionDefinition } from "@/lib/emotions";
import { localDateKey } from "@shared/timezone";
import { attachmentStyleLabel, loveLanguageLabel } from "@/lib/persona-options";
import { normalizeIntimacyLevel } from "@shared/intimacy";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** The state of a persona, or `null` when it is not a known state. */
function emotionOf(state: string | null | undefined): EmotionDefinition | null {
  return (EMOTIONS as Record<string, EmotionDefinition | undefined>)[state ?? ""] ?? null;
}

const STATUS_CONFIG: Record<string, { labelKey: "lobby.status.pending" | "lobby.status.analyzing" | "lobby.status.ready" | "lobby.status.error"; dotClass: string }> = {
  pending:   { labelKey: "lobby.status.pending", dotClass: "bg-mood-playful" },
  analyzing: { labelKey: "lobby.status.analyzing", dotClass: "bg-mood-nostalgic animate-pulse" },
  ready:     { labelKey: "lobby.status.ready", dotClass: "bg-mood-happy" },
  error:     { labelKey: "lobby.status.error", dotClass: "bg-destructive" },
};

/* These are the values stored on the persona, not display strings — the
   server keeps them verbatim, so they must not be localised. */
/**
 * The icon for each love language.
 *
 * It is keyed by the *stored* value, and the list of those values lives
 * in one place — the lobby had its own, with one value misspelled, so
 * the gift icon never appeared for anybody.
 */
const LOVE_LANG_ICONS: Record<string, any> = {
  // i18n:allow-identifier
  "肯定的言辞": MessageCircle, "精心时刻": Clock, "接收礼物": Gift,
  // i18n:allow-identifier
  "服务的行动": Handshake, "身体接触": HeartHandshake,
};

const ATTACHMENT_ICONS: Record<string, any> = {
  "安全型": Shield, "焦虑型": Cloud, "回避型": Waves, "混乱型": Tornado,
};

const ANALYSIS_STAGES: Record<number, "lobby.analysisStages.reading" | "lobby.analysisStages.chatting" | "lobby.analysisStages.images" | "lobby.analysisStages.done"> = {
  10: "lobby.analysisStages.reading", 30: "lobby.analysisStages.chatting",
  70: "lobby.analysisStages.images", 100: "lobby.analysisStages.done",
};

const TIP_ICONS = [Lightbulb, Zap, Heart, Brain, Coffee, Star];

const MILESTONES = [
  { threshold: 1000, icon: Trophy, labelKey: "lobby.milestones.thousands" },
  { threshold: 500, icon: Gem, labelKey: "lobby.milestones.deep" },
  { threshold: 100, icon: Star, labelKey: "lobby.milestones.oldFriend" },
  { threshold: 50, icon: Flame, labelKey: "lobby.milestones.warm" },
  { threshold: 10, icon: Sprout, labelKey: "lobby.milestones.new" },
] as const;

const FILTER_TABS = [
  { key: "all", labelKey: "common.all" },
  { key: "ready", labelKey: "lobby.status.ready" },
  { key: "analyzing", labelKey: "lobby.status.analyzing" },
  { key: "pending", labelKey: "lobby.status.pending" },
] as const;

const SORT_OPTIONS = [
  { key: "recent", labelKey: "lobby.sort.recent" },
  { key: "created", labelKey: "lobby.sort.created" },
  { key: "chats", labelKey: "lobby.sort.chats" },
  { key: "name", labelKey: "lobby.sort.name" },
] as const;

const ACHIEVEMENTS = [
  { id: "first_chat", icon: MessageCircle, labelKey: "lobby.achievements.first_chat.label", descKey: "lobby.achievements.first_chat.desc", check: (s: any) => s.totalChats >= 1 },
  { id: "ten_chats", icon: MessagesSquare, labelKey: "lobby.achievements.ten_chats.label", descKey: "lobby.achievements.ten_chats.desc", check: (s: any) => s.totalChats >= 10 },
  { id: "fifty_chats", icon: BookOpen, labelKey: "lobby.achievements.fifty_chats.label", descKey: "lobby.achievements.fifty_chats.desc", check: (s: any) => s.totalChats >= 50 },
  { id: "hundred_chats", icon: Library, labelKey: "lobby.achievements.hundred_chats.label", descKey: "lobby.achievements.hundred_chats.desc", check: (s: any) => s.totalChats >= 100 },
  { id: "multi_persona", icon: Users, labelKey: "lobby.achievements.multi_persona.label", descKey: "lobby.achievements.multi_persona.desc", check: (s: any) => s.totalPersonas >= 3 },
  { id: "daily_active", icon: Flame, labelKey: "lobby.achievements.daily_active.label", descKey: "lobby.achievements.daily_active.desc", check: (s: any) => s.todayChats >= 5 },
  { id: "veteran", icon: Medal, labelKey: "lobby.achievements.veteran.label", descKey: "lobby.achievements.veteran.desc", check: (s: any) => s.memberDays >= 30 },
  { id: "collector", icon: Drama, labelKey: "lobby.achievements.collector.label", descKey: "lobby.achievements.collector.desc", check: (s: any) => s.totalPersonas >= 5 },
] as const;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** The translator handed out by `useLocale`. */
type Translate = ReturnType<typeof useLocale>["t"];

function getGreeting(): { textKey: "lobby.greetings.night.text" | "lobby.greetings.morning.text" | "lobby.greetings.forenoon.text" | "lobby.greetings.noon.text" | "lobby.greetings.afternoon.text" | "lobby.greetings.evening.text"; subKey: "lobby.greetings.night.sub" | "lobby.greetings.morning.sub" | "lobby.greetings.forenoon.sub" | "lobby.greetings.noon.sub" | "lobby.greetings.afternoon.sub" | "lobby.greetings.evening.sub" } {
  const h = new Date().getHours();
  if (h < 6) return { textKey: "lobby.greetings.night.text", subKey: "lobby.greetings.night.sub" };
  if (h < 9) return { textKey: "lobby.greetings.morning.text", subKey: "lobby.greetings.morning.sub" };
  if (h < 12) return { textKey: "lobby.greetings.forenoon.text", subKey: "lobby.greetings.forenoon.sub" };
  if (h < 14) return { textKey: "lobby.greetings.noon.text", subKey: "lobby.greetings.noon.sub" };
  if (h < 18) return { textKey: "lobby.greetings.afternoon.text", subKey: "lobby.greetings.afternoon.sub" };
  if (h < 22) return { textKey: "lobby.greetings.evening.text", subKey: "lobby.greetings.evening.sub" };
  return { textKey: "lobby.greetings.night.text", subKey: "lobby.greetings.night.sub" };
}

function relativeTime(date: string | Date, locale: string, t: Translate): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("lobby.relativeTime.justNow");
  if (mins < 60) return t("lobby.relativeTime.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("lobby.relativeTime.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("lobby.relativeTime.days", { count: days });
  if (days < 30) return t("lobby.relativeTime.weeks", { count: Math.floor(days / 7) });
  return new Date(date).toLocaleDateString(locale);
}

/**
 * The start of a day, in the reader's own calendar.
 *
 * "2021-05-20" is a calendar date, not an instant: `new Date()` reads
 * it as midnight in *Greenwich*, so for anybody east of Greenwich the
 * day was already partly over when it was parsed. The number of days
 * together was then off by one — and the anniversary fell on the wrong
 * day, which is the one number on this page that has to be right.
 */
function dayStart(value: string | Date): number {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
      ).getTime();
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Date.now();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(from: string | Date, to?: string | Date): number {
  const start = dayStart(from);
  const end = dayStart(to ?? new Date());
  return Math.max(1, Math.round((end - start) / 86400000));
}

function getAnalysisStage(progress: number): "lobby.analysisStages.reading" | "lobby.analysisStages.chatting" | "lobby.analysisStages.images" | "lobby.analysisStages.done" | "lobby.analysisStages.preparing" {
  for (const [t, l] of Object.entries(ANALYSIS_STAGES).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (progress >= Number(t)) return l;
  }
  return "lobby.analysisStages.preparing";
}

function getMilestone(chatCount: number) {
  return MILESTONES.find(m => chatCount >= m.threshold);
}

function getDaysUntilAnniversary(togetherFrom: string): number | null {
  const start = new Date(dayStart(togetherFrom));
  if (Number.isNaN(start.getTime())) return null;
  /**
   * The difference is counted in days, not in milliseconds.
   *
   * The two were compared as instants — so on the anniversary itself,
   * midnight of that day is *before* now, and the year was rolled
   * forward. So the banner never appeared on the day it was about,
   * and the "anniversary today" wording could never be reached.
   */
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisYear = new Date(startOfToday.getFullYear(), start.getMonth(), start.getDate());
  let diff = Math.round((thisYear.getTime() - startOfToday.getTime()) / 86400000);
  if (diff < 0) {
    thisYear.setFullYear(thisYear.getFullYear() + 1);
    diff = Math.round((thisYear.getTime() - startOfToday.getTime()) / 86400000);
  }
  return diff <= 30 ? diff : null;
}

function getMissYouLevel(lastChatAt: string | Date | null): "lobby.missYou.strong" | "lobby.missYou.mild" | null {
  if (!lastChatAt) return null;
  const days = Math.floor((Date.now() - new Date(lastChatAt).getTime()) / 86400000);
  if (days >= 7) return "lobby.missYou.strong";
  if (days >= 3) return "lobby.missYou.mild";
  return null;
}

function getCompatibilityScore(persona: any): number {
  const chatWeight = Math.min((persona.chatCount || 0) / 100, 1) * 40;
  const daysWeight = persona.togetherFrom ? Math.min(daysBetween(persona.togetherFrom) / 365, 1) * 30 : 15;
  const dataWeight = persona.personaData ? 20 : 0;
  const recentWeight = persona.lastChatAt && (Date.now() - new Date(persona.lastChatAt).getTime()) < 86400000 * 3 ? 10 : 0;
  return Math.min(99, Math.round(chatWeight + daysWeight + dataWeight + recentWeight));
}

// ─── ANIMATED COUNTER HOOK ───────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    prevTarget.current = target;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

// ─── FRAMER MOTION VARIANTS ──────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.09 } },
};

// ─── SECTION HEADINGS ────────────────────────────────────────────────────────

function SectionHeading({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div>
        <div className="kicker mb-1.5">{kicker}</div>
        <h2 className="section-title">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function PanelTitle({ icon: Icon, title, right }: { icon: any; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3.5">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <h3 className="card-title">{title}</h3>
      </div>
      {right}
    </div>
  );
}

// ─── HERO BANNER · 问候区 ────────────────────────────────────────────────────

function HeroBanner({ username, stats }: { username?: string; stats?: any }) {
  const { t, locale } = useLocale();
  const greeting = getGreeting();
  /**
   * The quote.
   *
   * The count was written as twelve — the number of quotes today. So
   * any copy change that made it thirteen would have shown "undefined"
   * one time in thirteen.
   */
  const quote = useMemo(() => {
    const quotes = Array.from(t("lobby.quotes"));
    if (quotes.length === 0) return "";
    return quotes[Math.floor(Math.random() * quotes.length)];
  }, [t]);
  const memberDays = stats?.memberSince
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86400000))
    : 0;
  const animatedDays = useAnimatedCounter(memberDays);
  const animatedChats = useAnimatedCounter(stats?.totalChats || 0);
  const animatedToday = useAnimatedCounter(stats?.todayChats || 0);

  return (
    <motion.section className="mb-10" initial="hidden" animate="visible" variants={stagger}>
      <motion.p variants={fadeUp} className="kicker kicker-accent mb-3">
        {t("lobby.kicker")}
      </motion.p>

      <motion.h1 variants={fadeUp} className="page-title">
        {username ? `${username}${locale === "en" ? ", " : "，"}${t(greeting.textKey)}` : t(greeting.textKey)}
      </motion.h1>
      <motion.p variants={fadeUp} className="text-muted-foreground mt-2">{t(greeting.subKey)}</motion.p>

      <motion.div variants={fadeUp} className="rule w-16 my-6" />

      <motion.blockquote variants={fadeUp} className="border-l-2 border-border pl-4 max-w-md">
        <p className="font-display text-sm text-muted-foreground italic leading-relaxed">“{quote}”</p>
      </motion.blockquote>

      {memberDays > 0 && (
        <motion.div variants={fadeUp} className="flex items-center gap-5 mt-5 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>{t("lobby.hero.daysLabel")} <span className="font-display text-base font-semibold text-foreground">{animatedDays}</span> {t("lobby.hero.daysUnit")}</span>
          </div>
          {stats && stats.totalChats > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t("lobby.hero.chatsLabel")} <span className="font-display text-base font-semibold text-foreground">{animatedChats}</span> {t("lobby.hero.chatsUnit")}</span>
            </div>
          )}
          {stats && stats.todayChats > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="w-3.5 h-3.5" />
              <span>{t("lobby.hero.todayLabel")} <span className="font-display text-base font-semibold text-foreground">{animatedToday}</span> {t("lobby.hero.todayUnit")}</span>
            </div>
          )}
        </motion.div>
      )}
    </motion.section>
  );
}

// ─── STAT CELLS (ANIMATED) ───────────────────────────────────────────────────

function StatCell({ value, label }: { value: string | number; label: string }) {
  const animated = useAnimatedCounter(typeof value === "number" ? value : 0);
  const display = typeof value === "number" ? animated : value;
  return (
    <div>
      <div className="stat-value">{display}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}

// ─── TODAY'S RECOMMENDATION ──────────────────────────────────────────────────

function TodayRecommendation({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const { t, locale } = useLocale();
  const recommended = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready" && p.graduationStatus !== "graduated");
    if (ready.length === 0) return null;
    return ready.sort((a, b) => {
      const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
      const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
      return aTime - bTime;
    })[0];
  }, [personas]);

  if (!recommended) return null;
  const emotion = emotionOf(recommended.emotionalState) || EMOTIONS.warm;
  const EmotionIcon = emotion.icon;
  const pd = (recommended.personaData as any) || {};
  const missLevel = getMissYouLevel(recommended.lastChatAt);

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={Bookmark}
        title={t("lobby.recommendation.title")}
        right={missLevel && (
          <span className="inline-flex items-center gap-1 text-[0.625rem] px-2 py-0.5 rounded-md border text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30">
            <Heart className="w-2.5 h-2.5" /> {t(missLevel)}
          </span>
        )}
      />
      <div className="flex items-center gap-3">
        <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotionColor(recommended.emotionalState) } as CSSProperties}>
          <PersonaAvatar name={recommended.name} className="w-10 h-10 rounded-full text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-sans text-sm font-semibold text-foreground">{recommended.name}</span>
            <span className={`inline-flex items-center gap-1 text-[0.625rem] px-2 py-0.5 rounded-md border ${emotion.chip}`}>
              <EmotionIcon className="w-2.5 h-2.5" /> {t(emotion.labelKey)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {recommended.lastChatAt
              ? t("lobby.recommendation.lastChat", { time: relativeTime(recommended.lastChatAt, locale, t) })
              : t("lobby.recommendation.never")}
            {pd.summary && ` · ${(pd.summary as string).slice(0, 30)}`}
          </p>
        </div>
        <Button size="sm" onClick={() => onChat(recommended.id)}
          className="rounded-md text-xs h-8 px-4 flex-shrink-0">
          <MessageCircle className="w-3 h-3" /> {t("lobby.recommendation.chat")}
        </Button>
      </div>
    </div>
  );
}

// ─── "TA 想对你说" DAILY MESSAGES ────────────────────────────────────────────

/**
 * Proactive reminders — anniversaries and the like.
 *
 * The scheduler delivers them; this shows the ones that landed on the web
 * and lets the user dismiss them.
 */
function RemindersPanel({ personas }: { personas: any[] }) {
  const { t } = useLocale();
  const { data: reminders } = trpc.reminder.list.useQuery();
  const dismiss = trpc.reminder.dismiss.useMutation();

  const pending = (reminders ?? []).filter((r: any) => !r.dismissedAt);
  if (pending.length === 0) return null;

  const nameOf = (personaId: number) =>
    personas.find((p: any) => p.id === personaId)?.name ?? "";

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Bookmark} title={t("reminders.title")} />
      <div className="space-y-2">
        {pending.map((reminder: any) => (
          <div
            key={reminder.id}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm text-foreground">{reminder.text}</p>
              {nameOf(reminder.personaId) && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {nameOf(reminder.personaId)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate({ id: reminder.id })}
              /**
               * The button is put out of reach while the dismissal is
               * running — so a double click does not send two, and the
               * second does not fail after the first reported success.
               */
              disabled={dismiss.isPending}
              className="text-[11px] text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50"
            >
              {t("reminders.dismiss")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyMessages({ personas }: { personas: any[] }) {
  const { t } = useLocale();
  const messages = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready" && p.graduationStatus !== "graduated");
    if (ready.length === 0) return [];
    const today = new Date().getDate();
    const greetings = Array.from(t("lobby.daily.greetings"));
    return ready.slice(0, 3).map((p, i) => {
      const pd = (p.personaData as any) || {};
      const catchphrases: string[] = pd.catchphrases || [];
      const greetingIdx = (p.name.charCodeAt(0) + today + i) % greetings.length;
      let msg: string = greetings[greetingIdx];
      if (catchphrases.length > 0) {
        const cp = catchphrases[(today + i) % catchphrases.length];
        msg = `${cp}~ ${msg}`;
      }
      if (pd.nickname) msg += ` —— ${pd.nickname}`;
      return { name: p.name, message: msg, emotion: p.emotionalState || "warm" };
    });
  }, [personas, t]);

  if (messages.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading kicker={t("lobby.daily.kicker")} title={t("lobby.daily.title")} />
      <div>
        {messages.map((m, i) => {
          const emotion = emotionOf(m.emotion) || EMOTIONS.warm;
          return (
            <div key={i} className="border-t border-border last:border-b flex items-start gap-3 py-3.5 animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotionColor(m.emotion) } as CSSProperties}>
                <PersonaAvatar name={m.name} className="w-8 h-8 rounded-full text-xs" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-sans text-xs font-semibold text-foreground">{m.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.message}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 mt-1">{t("lobby.daily.today")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── EMOTIONAL WEATHER ───────────────────────────────────────────────────────

function EmotionalWeather({ personas }: { personas: any[] }) {
  const { t } = useLocale();
  const moodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of personas) {
      const state = p.emotionalState || "warm";
      counts[state] = (counts[state] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [personas]);

  if (personas.length < 2) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Palette} title={t("lobby.weather.title")} />
      <div className="flex items-end gap-2 h-14">
        {moodCounts.map(([state, count]) => {
          const e = emotionOf(state) || EMOTIONS.warm;
          const MoodIcon = e.icon;
          const pct = Math.round((count / personas.length) * 100);
          return (
            <div key={state} className="flex flex-col items-center gap-1.5 flex-1" title={`${t(e.labelKey)} · ${pct}%`}>
              <div className="w-full rounded-t-md transition-all duration-500" style={{
                height: `${Math.max(8, pct * 0.4)}px`,
                backgroundColor: emotionColor(state),
                opacity: 0.55,
              }} />
              <MoodIcon className="w-3 h-3" style={{ color: emotionColor(state) }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ACTIVITY HEATMAP ────────────────────────────────────────────────────────

function ActivityHeatmap() {
  const { t } = useLocale();
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const { cells, maxCount } = useMemo(() => {
    const map = new Map<string, number>();
    if (dailyActivity) {
      for (const row of dailyActivity) {
        map.set(String(row.date), Number(row.count));
      }
    }
    const cells: Array<{ date: string; count: number; label: string }> = [];
    let maxCount = 1;
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      // The user's own day, not the UTC one: `toISOString()` is the day
      // in Greenwich, which is the wrong day for everybody east of it
      // until lunchtime — and the server counts the days in the user's
      // calendar, so the two have to agree.
      const key = localDateKey(d);
      const count = map.get(key) || 0;
      if (count > maxCount) maxCount = count;
      cells.push({
        date: key,
        count,
        label: t("lobby.heatmap.cell", { month: d.getMonth() + 1, day: d.getDate(), count }),
      });
    }
    return { cells, maxCount };
  }, [dailyActivity, t]);

  const totalMessages = cells.reduce((s, c) => s + c.count, 0);
  if (totalMessages === 0) return null;

  const cellColor = (v: number) =>
    v === 0
      ? "color-mix(in oklab, var(--color-muted) 75%, transparent)"
      : `color-mix(in oklab, var(--color-mood-happy) ${Math.round(18 + v * 82)}%, transparent)`;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={Activity}
        title={t("lobby.heatmap.title")}
        right={<span className="text-[10px] text-muted-foreground">{t("lobby.heatmap.range", { count: totalMessages })}</span>}
      />
      <div className="flex gap-[3px] flex-wrap">
        {cells.map((cell) => {
          const intensity = cell.count === 0 ? 0 : Math.max(0.15, cell.count / maxCount);
          return (
            <div key={cell.date} className="heatmap-cell" title={cell.label}
              style={{ width: "14px", height: "14px", backgroundColor: cellColor(intensity) }} />
          );
        })}
      </div>
      <div className="flex items-center gap-1 mt-3 justify-end">
        <span className="text-[9px] text-muted-foreground/60">{t("lobby.heatmap.less")}</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <div key={i} className="heatmap-cell" style={{
            width: "10px", height: "10px", backgroundColor: cellColor(v),
          }} />
        ))}
        <span className="text-[9px] text-muted-foreground/60">{t("lobby.heatmap.more")}</span>
      </div>
    </div>
  );
}

// ─── ACHIEVEMENT BADGES ──────────────────────────────────────────────────────

function AchievementBadges({ stats }: { stats: any }) {
  const { t } = useLocale();
  const memberDays = stats?.memberSince
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86400000))
    : 0;
  const checkData = { ...stats, memberDays };
  const unlocked = ACHIEVEMENTS.filter(a => a.check(checkData));
  const locked = ACHIEVEMENTS.filter(a => !a.check(checkData));

  if (unlocked.length === 0 && !stats) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={Trophy}
        title={t("lobby.achievements.title")}
        right={<span className="num-frac text-[10px] text-muted-foreground">{t("lobby.achievements.unlocked", { count: unlocked.length, total: ACHIEVEMENTS.length })}</span>}
      />
      <div className="flex gap-2 flex-wrap">
        {unlocked.map((a, i) => {
          const BadgeIcon = a.icon;
          return (
            <div key={a.id} className="animate-fade-in-up flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-card border border-border"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }} title={t(a.descKey)}>
              <BadgeIcon className="w-3 h-3 text-foreground" />
              <span className="text-[10px] font-medium text-foreground">{t(a.labelKey)}</span>
            </div>
          );
        })}
        {locked.slice(0, 3).map(a => (
          <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/50 opacity-50"
            title={t(a.descKey)}>
            <Lock className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{t(a.labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CHAT STREAK ─────────────────────────────────────────────────────────────

function ChatStreak() {
  const { t } = useLocale();
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const streak = useMemo(() => {
    if (!dailyActivity || dailyActivity.length === 0) return 0;
    const dateSet = new Set(dailyActivity.map(r => String(r.date)));
    let count = 0;
    const d = new Date();
    const todayKey = localDateKey(d);
    if (!dateSet.has(todayKey)) {
      d.setDate(d.getDate() - 1);
      if (!dateSet.has(localDateKey(d))) return 0;
    }
    while (dateSet.has(localDateKey(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [dailyActivity]);

  if (streak < 2) return null;

  return (
    <div className="mb-8 flex items-center gap-2.5">
      <Flame className="w-4 h-4 text-mood-warm" />
      <span className="font-display text-sm font-semibold text-mood-warm">{t("lobby.streak", { count: streak })}</span>
      <div className="flex gap-0.5 ml-1">
        {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
          <div key={i} className="w-1.5 h-3 rounded-full bg-mood-warm" style={{ opacity: 0.3 + (i / 7) * 0.7 }} />
        ))}
      </div>
    </div>
  );
}

// ─── CONVERSATION STARTERS ───────────────────────────────────────────────────

function ConversationStarters({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const { t } = useLocale();
  const ready = personas.filter((p: any) => p.analysisStatus === "ready" && p.graduationStatus !== "graduated");
  const questions = useMemo(() => Array.from(t("lobby.starters.questions")), [t]);
  const [starterIdx, setStarterIdx] = useState(() => Math.floor(Math.random() * questions.length));

  const starters = useMemo(() => {
    const result: Array<{ text: string; personaId: number; personaName: string }> = [];
    for (const p of ready.slice(0, 3)) {
      const pd = (p.personaData as any) || {};
      const custom: string[] = pd.starterQuestions || [];
      if (custom.length > 0) {
        const idx = (new Date().getDate() + p.id) % custom.length;
        result.push({ text: custom[idx], personaId: p.id, personaName: p.name });
      } else {
        const idx = (starterIdx + p.id) % questions.length;
        result.push({ text: questions[idx], personaId: p.id, personaName: p.name });
      }
    }
    return result;
  }, [ready, starterIdx, questions]);

  if (ready.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading
        kicker={t("lobby.starters.kicker")}
        title={t("lobby.starters.title")}
        right={
          <button onClick={() => setStarterIdx((starterIdx + 1) % questions.length)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-0.5">{t("lobby.starters.refresh")}</button>
        }
      />
      <div>
        {starters.map((s, i) => (
          <button key={i} onClick={() => onChat(s.personaId)}
            className="w-full flex items-center gap-3 border-t border-border last:border-b px-1 py-3.5 text-left group hover:bg-muted/30 transition-colors">
            <PersonaAvatar name={s.personaName} className="w-8 h-8 rounded-md text-xs flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-display text-xs text-foreground/85 leading-relaxed truncate">“{s.text}”</p>
              <span className="text-[10px] text-muted-foreground/60">{t("lobby.starters.ask", { name: s.personaName })}</span>
            </div>
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── PERSONA CONSTELLATION ───────────────────────────────────────────────────

function PersonaConstellation({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const { t } = useLocale();
  const ready = personas.filter((p: any) => p.analysisStatus === "ready" && p.graduationStatus !== "graduated");
  if (ready.length < 2) return null;

  const cx = 140, cy = 90;
  const radius = 65;
  const nodes = ready.slice(0, 6).map((p: any, i: number) => {
    const angle = (i / Math.min(ready.length, 6)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const emotion = emotionOf(p.emotionalState) || EMOTIONS.warm;
    return { ...p, x, y, emotion };
  });

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Sparkles} title={t("lobby.constellation.title")} />
      <svg viewBox="0 0 280 180" className="w-full" style={{ maxHeight: "180px" }}>
        {nodes.map((n, i) =>
          nodes.slice(i + 1).map((m, j) => (
            <line key={`${i}-${j}`} x1={n.x} y1={n.y} x2={m.x} y2={m.y}
              stroke="var(--color-foreground)" strokeWidth="1" opacity="0.12" />
          ))
        )}
        <circle cx={cx} cy={cy} r="8" fill="var(--color-foreground)" opacity="0.12" />
        <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="8" fill="var(--color-foreground)" fontWeight="600">{t("lobby.constellation.me")}</text>
        {nodes.map((n) => (
          <g key={n.id} onClick={() => onChat(n.id)} className="cursor-pointer">
            <line x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={emotionColor(n.emotionalState)} strokeWidth="1.5" opacity="0.3" />
            <circle cx={n.x} cy={n.y} r="16" fill="var(--color-card)" stroke={emotionColor(n.emotionalState)} strokeWidth="2" opacity="0.9" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="12" fontWeight="600"
              fill={emotionColor(n.emotionalState)}>{n.name.charAt(0)}</text>
            <text x={n.x} y={n.y + 28} textAnchor="middle" fontSize="8" fill="var(--color-muted-foreground)">
              {n.name.length > 4 ? n.name.slice(0, 4) : n.name}
            </text>
            <circle cx={n.x + 12} cy={n.y - 12} r="4" fill={emotionColor(n.emotionalState)} stroke="var(--color-card)" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── MINI CALENDAR ───────────────────────────────────────────────────────────

function MiniCalendar() {
  const { t, locale } = useLocale();
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const { days, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    const dateSet = new Set<string>();
    if (dailyActivity) {
      for (const r of dailyActivity) dateSet.add(String(r.date));
    }
    const days: Array<{ day: number; active: boolean; today: boolean } | null> = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, active: dateSet.has(key), today: d === now.getDate() });
    }
    return { days, monthLabel: new Date(year, month, 1).toLocaleDateString(locale, { year: "numeric", month: "long" }) };
  }, [dailyActivity, locale]);

  const activeDays = days.filter(d => d?.active).length;
  if (activeDays === 0 && (!dailyActivity || dailyActivity.length === 0)) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={CalendarDays}
        title={t("lobby.calendar.title")}
        right={<span className="text-[10px] text-muted-foreground">{t("lobby.calendar.summary", { month: monthLabel, count: activeDays })}</span>}
      />
      <div className="grid grid-cols-7 gap-1">
        {Array.from(t("lobby.calendar.weekdays")).map((d, i) => (
          <div key={`${d}-${i}`} className="text-center text-[9px] text-muted-foreground/60 py-0.5">{d}</div>
        ))}
        {days.map((d, i) => (
          <div key={i} className={`cal-cell aspect-square rounded-md flex items-center justify-center text-[10px] ${
            !d ? "" :
            d.today ? "bg-primary text-primary-foreground font-bold" :
            d.active ? "bg-primary/10 text-foreground font-medium" :
            "text-muted-foreground/40"
          }`}>
            {d?.day || ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PERSONA LEADERBOARD ─────────────────────────────────────────────────────

function PersonaLeaderboard({ personas }: { personas: any[] }) {
  const { t } = useLocale();
  const ranked = useMemo(() => {
    return [...personas]
      .filter((p: any) => (p.chatCount || 0) > 0)
      .sort((a, b) => (b.chatCount || 0) - (a.chatCount || 0))
      .slice(0, 3);
  }, [personas]);

  if (ranked.length < 2) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Medal} title={t("lobby.leaderboard.title")} />
      <div className="space-y-2.5">
        {ranked.map((p: any, i: number) => {
          const emotion = emotionOf(p.emotionalState) || EMOTIONS.warm;
          const maxChats = ranked[0].chatCount || 1;
          const pct = Math.round(((p.chatCount || 0) / maxChats) * 100);
          return (
            <div key={p.id} className="flex items-center gap-3">
              <span className={`w-5 text-center font-display text-sm font-semibold flex-shrink-0 ${
                i === 0 ? "text-foreground" : "text-muted-foreground/60"
              }`}>{i + 1}</span>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotionColor(p.emotionalState) } as CSSProperties}>
                <PersonaAvatar name={p.name} className="w-7 h-7 rounded-full text-[11px]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground truncate">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{t("lobby.leaderboard.chats", { count: p.chatCount })}</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: emotionColor(p.emotionalState), opacity: 0.55 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PERSONA CARD ────────────────────────────────────────────────────────────

function PersonaCard({ persona, onChat, onUpload, onEdit, onDelete, onTogglePin, selectable, selected, onToggleSelect }: {
  persona: any; onChat: () => void; onUpload: () => void; onEdit: () => void; onDelete: () => void;
  onTogglePin?: () => void;
  /** The bulk selection. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t, locale } = useLocale();
  const status = STATUS_CONFIG[persona.analysisStatus] || STATUS_CONFIG.pending;
  const emotion = emotionOf(persona.emotionalState) || EMOTIONS.warm;
  const EmotionIcon = emotion.icon;
  const isAnalyzing = persona.analysisStatus === "analyzing";
  const isReady = persona.analysisStatus === "ready";
  const isGraduated = persona.graduationStatus === "graduated";
  const pd = (persona.personaData as any) || {};
  const togetherDays = persona.togetherFrom ? daysBetween(persona.togetherFrom, persona.togetherTo || undefined) : null;
  const traits = [pd.personality, pd.speakingStyle].filter(Boolean).join(locale === "en" ? ", " : "，").slice(0, 50);
  const milestone = getMilestone(persona.chatCount || 0);
  const MilestoneIcon = milestone?.icon;
  const anniversary = persona.togetherFrom ? getDaysUntilAnniversary(persona.togetherFrom) : null;
  const catchphrases: string[] = pd.catchphrases || [];
  const missLevel = getMissYouLevel(persona.lastChatAt);
  const compatibility = isReady ? getCompatibilityScore(persona) : null;

  const [showLetter, setShowLetter] = useState(false);
  /**
   * The letter is a dialog.
   *
   * The focus goes into it when it opens and comes back when it
   * closes, Tab walks inside it, and Escape closes it.
   */
  const letterDialogRef = useDialogFocus<HTMLDivElement>(showLetter, () => setShowLetter(false));
  const letterTitleId = useId();
  const awakenMutation = trpc.persona.awaken.useMutation({
    onSuccess: () => { toast.success(t("lobby.card.awakened", { name: persona.name })); window.location.reload(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className={`surface surface-interactive p-5 animate-fade-in-up relative ${isGraduated ? "opacity-80" : ""}`}>
      {selectable && (
        <button
          onClick={onToggleSelect}
          aria-label={t("lobby.directory.select")}
          className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-foreground transition-colors"
        >
          {selected
            ? <CheckSquare className="w-4 h-4 text-cinnabar" />
            : <Square className="w-4 h-4" />}
        </button>
      )}
      {(isGraduated || (!isGraduated && milestone && MilestoneIcon) || missLevel) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {isGraduated && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-melancholy bg-mood-melancholy/10 border-mood-melancholy/30">
              <GraduationCap className="w-3 h-3" /> {t("lobby.card.dormant")}
            </span>
          )}
          {/* A paused persona says so. Silence with no explanation looks
              like a bug. */}
          {!isGraduated && persona.presence === "quiet" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-muted-foreground bg-muted/60 border-border">
              <PauseCircle className="w-3 h-3" /> {t("presence.quiet")}
            </span>
          )}
          {/* Why it is quiet. A persona that has gone silent without a
              word looks like a bug, and the one thing it must not be
              mistaken for is a breakup. */}
          {!isGraduated && persona.reachability === "unreachable" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-distant bg-mood-distant/10 border-mood-distant/30"
              title={t("lobby.card.unreachableNote")}>
              <CloudSun className="w-3 h-3" /> {t("lobby.card.unreachable")}
            </span>
          )}
          {!isGraduated && milestone && MilestoneIcon && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-warm bg-mood-warm/10 border-mood-warm/30">
              <MilestoneIcon className="w-3 h-3" /> {t(milestone.labelKey)}
            </span>
          )}
          {missLevel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30">
              <Heart className="w-2.5 h-2.5" /> {t(missLevel)}
            </span>
          )}
        </div>
      )}

      {!isGraduated && persona.reachability === "unreachable" && (
        <p className="text-xs text-mood-distant/90 mb-3 leading-relaxed">
          {t("lobby.card.unreachableLine")}
        </p>
      )}

      {anniversary !== null && anniversary <= 30 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-md bg-mood-warm/10 border border-mood-warm/25">
          <Gift className="w-3.5 h-3.5 text-mood-warm" />
          <span className="text-xs text-mood-warm">
            {anniversary === 0 ? t("lobby.card.anniversaryToday") : t("lobby.card.anniversarySoon", { count: anniversary })}
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <div className="mood-ring" style={{ "--mood-color": emotionColor(persona.emotionalState) } as CSSProperties}>
            <PersonaAvatar name={persona.name} className="w-14 h-14 rounded-lg text-xl" />
          </div>
          {isReady && (
            <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-mood-happy border-2 border-card breathing-dot" />
          )}
          {persona.wechatBound && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-mood-happy border-2 border-card flex items-center justify-center" title={t("lobby.card.wechatBound")}>
              <Wifi className="w-2.5 h-2.5 text-card" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-sans text-base font-semibold text-foreground truncate">{persona.name}</h3>
            <span className={`inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-md border ${emotion.chip}`}>
              <EmotionIcon className="w-3 h-3" /> {t(emotion.labelKey)}
            </span>
            {persona.isPinned && (
              <span className="inline-flex items-center gap-1 text-[0.6875rem] px-1.5 py-0.5 rounded-md border border-mood-warm/30 bg-mood-warm/10 text-mood-warm">
                <Pin className="w-2.5 h-2.5" /> {t("lobby.card.pinned")}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm truncate">{persona.relationshipDesc || t("lobby.card.relationship")}</p>

          <div className="flex items-center gap-2.5 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
              {t(status.labelKey)}
            </span>
            {persona.chatCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageCircle className="w-3 h-3" /> {persona.chatCount}
              </span>
            )}
            {persona.fileCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" /> {persona.fileCount}
              </span>
            )}
            {persona.llmProvider && (
              <span className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-medium">
                {persona.llmProvider}
              </span>
            )}
          </div>
        </div>
      </div>

      {(togetherDays || persona.lastChatAt) && (
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {togetherDays && (
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3 text-mood-warm" />
              {persona.togetherTo
                ? t("lobby.card.togetherDays", { count: togetherDays })
                : t("lobby.card.daysTogether", { count: togetherDays })}
            </span>
          )}
          {persona.lastChatAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t("lobby.card.lastChat", { time: relativeTime(persona.lastChatAt, locale, t) })}
            </span>
          )}
        </div>
      )}

      {persona.intimacyLevel && normalizeIntimacyLevel(persona.intimacyLevel) !== "acquainted" && isReady && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>
              {t("lobby.intimacy", {
                level: t(`intimacy.${normalizeIntimacyLevel(persona.intimacyLevel)}` as any),
              })}
            </span>
            <span className="font-display font-semibold text-foreground/70">{persona.intimacyScore || 0}</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className="progress-bar h-full"
              style={{ width: `${Math.min(100, ((persona.intimacyScore || 0) / 1000) * 100)}%` }} />
          </div>
        </div>
      )}

      {pd.summary && isReady && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Eye className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-subtle line-clamp-1 italic">{pd.summary}</p>
        </div>
      )}

      {traits && isReady && !pd.summary && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Brain className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-subtle line-clamp-1">{traits}</p>
        </div>
      )}

      {catchphrases.length > 0 && isReady && (
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
          {catchphrases.slice(0, 3).map((phrase: string, i: number) => (
            <span key={i} className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-muted/40 text-muted-foreground border border-border truncate max-w-[100px]">
              “{phrase}”
            </span>
          ))}
        </div>
      )}

      {(pd.loveLanguage || pd.attachmentStyle) && isReady && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {pd.attachmentStyle && ATTACHMENT_ICONS[pd.attachmentStyle] && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
              {(() => { const AttachIcon = ATTACHMENT_ICONS[pd.attachmentStyle]; return <AttachIcon className="w-2.5 h-2.5" />; })()}
              {attachmentStyleLabel(pd.attachmentStyle, t)}
            </span>
          )}
          {pd.loveLanguage && LOVE_LANG_ICONS[normaliseLoveLanguage(pd.loveLanguage)] && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
              {(() => { const LoveIcon = LOVE_LANG_ICONS[normaliseLoveLanguage(pd.loveLanguage)]; return <LoveIcon className="w-2.5 h-2.5" />; })()}
              {loveLanguageLabel(pd.loveLanguage, t)}
            </span>
          )}
        </div>
      )}

      {isAnalyzing && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="animate-pulse-soft">{t(getAnalysisStage(persona.analysisProgress || 0))}</span>
            <span className="font-display">{persona.analysisProgress || 0}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="progress-bar h-full"
              style={{ width: `${persona.analysisProgress || 0}%` }} />
          </div>
        </div>
      )}

      {persona.lastMessage && !isAnalyzing && (
        <div className="mt-3 px-3 py-2 bg-muted/30 rounded-md">
          <p className="text-xs text-muted-foreground truncate">{persona.lastMessage.content}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{relativeTime(persona.lastMessage.createdAt, locale, t)}</p>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-border/60">
        {isGraduated ? (
          <>
            <Button size="sm"
              className="flex-1 rounded-md bg-mood-melancholy/15 text-mood-melancholy border border-mood-melancholy/30 hover:bg-mood-melancholy/25 shadow-none"
              onClick={() => awakenMutation.mutate({ id: persona.id })} disabled={awakenMutation.isPending}>
              <Sunrise className="w-3.5 h-3.5" />{awakenMutation.isPending ? t("lobby.card.awakening") : t("lobby.card.awaken")}
            </Button>
            {persona.farewellLetter && (
              <Button size="sm" variant="ghost" title={t("lobby.card.viewLetter")} className="text-muted-foreground hover:text-foreground rounded-md"
                onClick={() => setShowLetter(true)}>
                <BookOpen className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        ) : isReady ? (
          <Button size="sm" className="flex-1 rounded-md" onClick={onChat}>
            <MessageCircle className="w-3.5 h-3.5" />{t("lobby.card.chat")}
          </Button>
        ) : (
          <Button size="sm" className="flex-1 rounded-md" onClick={onUpload}>
            <Upload className="w-3.5 h-3.5" />{t("lobby.upload")}
          </Button>
        )}
        {onTogglePin && (
          <Button size="sm" variant="ghost" title={t("lobby.card.pin")}
            className={`rounded-md ${persona.isPinned ? "text-mood-warm hover:text-mood-warm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={onTogglePin}>
            <Pin className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" title={t("lobby.card.edit")} className="text-muted-foreground hover:text-foreground rounded-md" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" title={t("lobby.card.delete")} className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Portal：卡片上的 animate-fade-in-up（forwards 保留 transform）会把 fixed 弹层锚定到卡片内，故挂到 body */}
      {showLetter && persona.farewellLetter && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowLetter(false)}>
          <div className="absolute inset-0 bg-black/40" />
          {/**
           * A window that covers the page is a dialog.
           *
           * It used to be a hand-rolled overlay: the focus stayed on
           * the button behind it, Tab walked into the page under the
           * window, Escape did nothing, and the close button had no
           * name for a screen reader to read out. The chat's own
           * overlays already do all of this — see `useDialogFocus`.
           */}
          <div
            ref={letterDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={letterTitleId}
            className="relative bg-card border border-border rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-border/60">
              <div>
                <div className="kicker mb-1">{t("lobby.card.farewell")}</div>
                <h3 id={letterTitleId} className="card-title">{t("lobby.card.letterTitle", { name: persona.name })}</h3>
              </div>
              <button onClick={() => setShowLetter(false)} className="app-nav-icon" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <div className="surface p-5">
                <p className="letter-prose text-foreground/90 text-sm whitespace-pre-wrap">{persona.farewellLetter}</p>
                <p className="text-right text-muted-foreground text-xs mt-5">—— {persona.name}</p>
              </div>
              {persona.graduatedAt && (
                <p className="text-xs text-muted-foreground text-center mt-4">
                  {t("lobby.card.graduatedAt", { date: new Date(persona.graduatedAt).toLocaleDateString(locale) })}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── QUICK CHAT BAR ──────────────────────────────────────────────────────────

function QuickChatBar({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const { t } = useLocale();
  const readyPersonas = personas.filter((p: any) => p.analysisStatus === "ready" && p.graduationStatus !== "graduated");
  if (readyPersonas.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading
        kicker={t("lobby.quick.kicker")}
        title={t("lobby.quick.title")}
        right={<span className="text-xs text-muted-foreground mb-0.5">{t("lobby.quick.online", { count: readyPersonas.length })}</span>}
      />
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {readyPersonas.map((p: any) => {
          const emotion = emotionOf(p.emotionalState) || EMOTIONS.warm;
          const EmotionBadge = emotion.icon;
          const miss = getMissYouLevel(p.lastChatAt);
          return (
            <button key={p.id} onClick={() => onChat(p.id)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group relative">
              <div className="relative">
                <div className="mood-ring-sm" style={{ "--mood-color": emotionColor(p.emotionalState) } as CSSProperties}>
                  <PersonaAvatar name={p.name} className="w-12 h-12 rounded-full text-base" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-card border flex items-center justify-center"
                  style={{ borderColor: emotionColor(p.emotionalState), color: emotionColor(p.emotionalState) }}>
                  <EmotionBadge className="w-2.5 h-2.5" />
                </span>
                {miss && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-mood-nostalgic animate-pulse" />
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate max-w-[60px]">
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── MEMORY HIGHLIGHTS ───────────────────────────────────────────────────────

function MemoryHighlights({ personas }: { personas: any[] }) {
  const { t } = useLocale();
  const highlights = useMemo(() => {
    const items: Array<{ name: string; text: string; type: string }> = [];
    for (const p of personas) {
      const pd = (p.personaData as any) || {};
      if (pd.touchingMoments) items.push({ name: p.name, text: pd.touchingMoments, type: "touching" });
      if (pd.memories) items.push({ name: p.name, text: typeof pd.memories === "string" ? pd.memories.slice(0, 80) : "", type: "memory" });
    }
    return items.filter(i => i.text).slice(0, 4);
  }, [personas]);

  if (highlights.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading kicker={t("lobby.memories.kicker")} title={t("lobby.memories.title")} />
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {highlights.map((h, i) => (
          <div key={i} className="surface p-3.5 flex-shrink-0 w-[220px]">
            <div className="flex items-center gap-1.5 mb-2">
              <PersonaAvatar name={h.name} className="w-5 h-5 rounded-md text-[10px]" />
              <span className="text-[10px] font-medium text-foreground">{h.name}</span>
              <span className="text-[10px] text-muted-foreground/60">{h.type === "touching" ? t("lobby.memories.touching") : t("lobby.memories.shared")}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{h.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RECENT ACTIVITY TIMELINE ────────────────────────────────────────────────

function RecentActivity({ onNavigate }: { onNavigate: (personaId: number) => void }) {
  const { t, locale } = useLocale();
  const { data: activity } = trpc.persona.recentActivity.useQuery();
  if (!activity || activity.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading kicker={t("lobby.activity.kicker")} title={t("lobby.activity.title")} />
      <div>
        {activity.slice(0, 6).map((item: any, idx: number) => {
          const emotion = emotionOf(item.emotionalState) || EMOTIONS.warm;
          return (
            <button key={item.id} onClick={() => onNavigate(item.personaId)}
              className="w-full flex items-center gap-3 border-t border-border last:border-b px-1 py-3 hover:bg-muted/30 transition-colors text-left animate-fade-in-up"
              style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "both" }}>
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-full overflow-hidden">
                  <PersonaAvatar name={item.personaName} className="w-full h-full text-xs" />
                </div>
                {item.role === "assistant" && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card"
                    style={{ backgroundColor: emotionColor(item.emotionalState) }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{item.role === "user" ? t("lobby.activity.me") : item.personaName}</span>
                  <span className="text-[10px] text-muted-foreground/40">→</span>
                  <span className="text-xs text-muted-foreground">{item.role === "user" ? item.personaName : t("lobby.activity.me")}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{item.content}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{relativeTime(item.createdAt, locale, t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── TIPS SECTION ────────────────────────────────────────────────────────────

function TipsSection() {
  const { t } = useLocale();
  const tips = Array.from(t("lobby.tips"));
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * tips.length));
  const tip = tips[tipIdx];
  const Icon = TIP_ICONS[tipIdx] || Lightbulb;
  return (
    <div className="mb-8 border-t border-border pt-5 flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-display text-xs font-semibold text-foreground mb-0.5">{t("lobby.tip.title")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{tip}</p>
      </div>
      <button onClick={() => setTipIdx((tipIdx + 1) % tips.length)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-1">{t("lobby.tip.next")}</button>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({
  onCreate,
  onTryIt,
  sandboxPending,
}: {
  onCreate: () => void;
  onTryIt: () => void;
  sandboxPending: boolean;
}) {
  const { t } = useLocale();
  /**
   * The quote.
   *
   * The count was written as twelve — the number of quotes today. So
   * any copy change that made it thirteen would have shown "undefined"
   * one time in thirteen.
   */
  const quote = useMemo(() => {
    const quotes = Array.from(t("lobby.quotes"));
    if (quotes.length === 0) return "";
    return quotes[Math.floor(Math.random() * quotes.length)];
  }, [t]);
  return (
    <motion.div
      className="py-16 max-w-md"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.div variants={fadeUp} className="kicker kicker-accent mb-3">{t("lobby.emptyState.kicker")}</motion.div>
      <motion.h2 variants={fadeUp} className="page-title mb-3">
        {t("lobby.emptyState.title")}
      </motion.h2>
      <motion.p variants={fadeUp} className="text-sm text-muted-foreground mb-4 leading-relaxed">
        {t("lobby.emptyState.body")}
      </motion.p>
      <motion.p variants={fadeUp} className="font-display text-sm text-muted-subtle italic leading-relaxed">
        “{quote}”
      </motion.p>

      <motion.div variants={fadeUp} className="rule w-16 my-8" />

      <motion.div variants={fadeUp} className="flex items-center gap-2 sm:gap-3 mb-10 flex-wrap">
        {Array.from(t("lobby.emptyState.steps")).map((label, i) => (
          <div key={label} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <div className="w-5 h-px bg-border" />}
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-sm font-semibold text-cinnabar">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button onClick={onCreate} className="rounded-md px-8 h-11 gap-2">
          <Plus className="w-4 h-4" /> {t("lobby.emptyState.create")}
        </Button>
        {/* The first thing the app asks for is somebody else's chat
            history, and that is the step most people never get past. So
            there is a way in that needs nothing at all. */}
        <Button
          variant="ghost"
          onClick={onTryIt}
          disabled={sandboxPending}
          className="rounded-md h-11 px-5 gap-2 text-muted-foreground"
        >
          <Sparkles className="w-4 h-4" />
          {sandboxPending ? t("lobby.emptyState.trying") : t("lobby.emptyState.tryIt")}
        </Button>
      </motion.div>
      <motion.p variants={fadeUp} className="text-xs text-muted-foreground mt-3 max-w-md leading-relaxed">
        {t("lobby.emptyState.tryItNote")}
      </motion.p>
    </motion.div>
  );
}

// ─── CREATE DIALOG ───────────────────────────────────────────────────────────

function CreatePersonaDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: number) => void;
}) {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherSince, setTogetherSince] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  const createMutation = trpc.persona.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(t("lobby.createDialog.created", { name }));
      onCreated(data.id);
      setName(""); setRelationshipDesc(""); setTogetherSince(""); setShowEndDate(false); setEndDate("");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(t("lobby.createDialog.failed", { message: e.message })),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border rounded-xl max-w-md">
        <DialogHeader>
          <div className="kicker mb-1">{t("lobby.createDialog.kicker")}</div>
          <DialogTitle className="font-display text-lg text-foreground">{t("lobby.createDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">{t("lobby.createDialog.name")}</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder={t("lobby.createDialog.namePlaceholder")} className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">{t("lobby.createDialog.relationship")}</Label>
            <Input value={relationshipDesc} onChange={e => setRelationshipDesc(e.target.value)}
              placeholder={t("lobby.createDialog.relationshipPlaceholder")} className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">{t("lobby.createDialog.togetherSince")}</Label>
            <Input type="date" value={togetherSince} onChange={e => setTogetherSince(e.target.value)}
              className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={showEndDate} onChange={e => setShowEndDate(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary" />
              <span className="text-sm text-muted-foreground">{t("lobby.createDialog.separated")}</span>
            </label>
            {showEndDate && (
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="h-10 bg-muted/50 border-border rounded-xl mt-1.5" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-md">{t("common.cancel")}</Button>
          <Button onClick={() => { if (!name.trim()) return; createMutation.mutate({
            name: name.trim(),
            relationshipDesc: relationshipDesc.trim() || undefined,
            // The names the server knows. The dialog used to send
            // `togetherSince` and `endDate`, which the schema does not
            // have: zod strips the keys it does not recognise, so both
            // dates were dropped on the floor — the "together since" and
            // "separated on" the user filled in were never stored, and
            // the `as any` is what hid the mismatch from the compiler.
            togetherFrom: togetherSince || undefined,
            togetherTo: showEndDate && endDate ? endDate : undefined,
          }); }}
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-md">
            {createMutation.isPending ? t("common.creating") : t("common.create")}
          </Button>
        </DialogFooter>
        {/* Two other ways in: a ready-made persona, or a guided questionnaire
            for people who have no chat logs to upload. */}
        <div className="flex items-center justify-between gap-3 pt-1 text-xs">
          <button
            onClick={() => { onOpenChange(false); navigate("/persona/new/questionnaire"); }}
            className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            {t("lobby.createFromQuestionnaire")}
          </button>
          <button
            onClick={() => { onOpenChange(false); document.getElementById("lobby-template-library")?.scrollIntoView({ behavior: "smooth" }); }}
            className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            {t("lobby.createFromTemplate")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── TEMPLATE LIBRARY ─────────────────────────────────────────────────────────

/**
 * The template library.
 *
 * A template is a ready-made persona: the user starts from one instead of
 * uploading chat logs or filling in the questionnaire. The templates are
 * local — there is no remote market, because the product's promise is that
 * the user's data never leaves their machine.
 */
function TemplateLibrarySection({
  onCreated,
  onQuestionnaire,
}: {
  onCreated: (personaId: number) => void;
  onQuestionnaire: () => void;
}) {
  const { t } = useLocale();
  const { data: templates } = trpc.template.list.useQuery();
  const instantiate = trpc.template.instantiate.useMutation({
    onSuccess: (data: any) => onCreated(data.personaId),
    onError: (e: any) => toast.error(e.message),
  });

  const list = (templates ?? []) as any[];
  if (list.length === 0) return null;

  return (
    <section className="mt-8 pt-2" id="lobby-template-library">
      <SectionHeading kicker={t("lobby.directory.study")} title={t("lobby.templates")} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((template) => (
          <button
            key={template.id}
            onClick={() => instantiate.mutate({ templateId: template.id })}
            disabled={instantiate.isPending}
            className="text-left surface p-4 rounded-md border border-border hover:border-foreground/30 transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-2 mb-1">
              <Library className="w-3.5 h-3.5 text-muted-subtle" />
              <span className="text-sm font-medium text-foreground">{template.name}</span>
            </div>
            {template.description && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {template.description}
              </p>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={onQuestionnaire}
        className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
      >
        {t("lobby.createFromQuestionnaire")}
      </button>
    </section>
  );
}

// ─── MAIN LOBBY ──────────────────────────────────────────────────────────────

export default function Lobby() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, locale } = useLocale();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [showSort, setShowSort] = useState(false);
  /**
   * The sort menu.
   *
   * It used to stay open until the user picked an option or pressed
   * the button again — Escape did nothing, and a click somewhere else
   * on the page did nothing either.
   */
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showSort) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSort(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!sortMenuRef.current?.contains(e.target as Node)) setShowSort(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showSort]);
  /** The graduated personas are folded away by default. */
  const [showGraduated, setShowGraduated] = useState(false);
  /** The bulk selection. */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const { data: personas, refetch } = trpc.persona.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      const list = query.state.data;
      return list?.some((p: any) => p.analysisStatus === "analyzing") ? 3000 : false;
    },
  });

  const { data: stats } = trpc.persona.stats.useQuery(undefined, { enabled: isAuthenticated });

  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => { refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const togglePin = (persona: any) => {
    updateMutation.mutate({ id: persona.id, isPinned: !persona.isPinned });
  };

  const deleteMutation = trpc.persona.delete.useMutation({
    onSuccess: () => { toast.success(t("lobby.deleteDialog.deleted")); setDeleteTarget(null); refetch(); },
    onError: (e: any) => toast.error(t("lobby.deleteDialog.failed", { message: e.message })),
  });

  const filteredPersonas = useMemo(() => {
    if (!personas) return [];
    let list = personas as any[];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.relationshipDesc || "").toLowerCase().includes(q));
    }
    if (filterTab !== "all") {
      list = list.filter(p => p.analysisStatus === filterTab);
    }
    list = [...list].sort((a, b) => {
      // A pinned persona sits at the top whatever the sort is. The person
      // who pinned it wanted it in front of them.
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      switch (sortBy) {
        case "chats": return (b.chatCount || 0) - (a.chatCount || 0);
        case "name": return a.name.localeCompare(b.name, locale);
        case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: {
          const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
          const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
          return bTime - aTime;
        }
      }
    });
    return list;
  }, [personas, searchQuery, filterTab, sortBy, locale]);

  /** The graduated ones, folded away. */
  const graduatedPersonas = useMemo(
    () => filteredPersonas.filter((p: any) => p.graduationStatus === "graduated"),
    [filteredPersonas],
  );
  const livePersonas = useMemo(
    () => filteredPersonas.filter((p: any) => p.graduationStatus !== "graduated"),
    [filteredPersonas],
  );

  /* A persona the user can talk to without uploading anything. The first
     thing the app asks for is somebody else's chat history, and that is
     the step most people never get past.

     These two hooks are above the early return on purpose: they used to
     be below it, which is a rules-of-hooks violation — React would have
     thrown "rendered fewer hooks than expected" the first time the
     lobby re-rendered with `loading` true, which it does whenever the
     logout request is in flight. */
  const [sandboxPending, setSandboxPending] = useState(false);
  const createSandbox = trpc.persona.createSandbox.useMutation({
    onSuccess: (data) => { navigate(`/chat/${data.personaId}`); },
    onError: (e: any) => { toast.error(e.message); setSandboxPending(false); },
  });

  if (loading) {
    return <PageLoader />;
  }

  const hasPersonas = personas && personas.length > 0;

  const handleTryIt = () => {
    if (sandboxPending) return;
    setSandboxPending(true);
    createSandbox.mutate({});
  };
  const readyCount = personas?.filter((p: any) => p.analysisStatus === "ready").length || 0;
  const analyzingCount = personas?.filter((p: any) => p.analysisStatus === "analyzing").length || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <div className="app-nav-brand">
            <Wordmark />
          </div>
          <div className="app-nav-spacer" />
          {analyzingCount > 0 && (
            <span className="text-xs text-muted-foreground mr-3 hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
              {t("lobby.nav.analyzing", { count: analyzingCount })}
            </span>
          )}
          <div className="app-nav-actions">
            {user?.username && (
              <div className="app-nav-icon !bg-muted !cursor-default mr-0.5">
                <span className="text-[0.6875rem] font-semibold text-foreground">{user.username.charAt(0).toUpperCase()}</span>
              </div>
            )}
            {toggleTheme && (
              <button onClick={toggleTheme} className="app-nav-icon" title={t("lobby.nav.theme")} aria-label={t("lobby.nav.theme")}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
            <button onClick={() => navigate("/analytics")}
              className="app-nav-icon" title={t("lobby.nav.analytics")} aria-label={t("lobby.nav.analytics")}>
              <Activity className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/diary")}
              className="app-nav-icon" title={t("lobby.nav.diary")} aria-label={t("lobby.nav.diary")}>
              <BookOpen className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/settings")}
              className="app-nav-icon" title={t("lobby.nav.settings")} aria-label={t("lobby.nav.settings")}>
              <Settings className="w-4 h-4" />
            </button>
            {/* The logout is awaited. It used to be fired and forgotten,
                so a failure was an unhandled rejection in the console
                and the user was still moved to the login page — signed
                in, on a page they cannot use. */}
            <button onClick={() => { void logout().finally(() => navigate(getLoginUrl())); }}
              className="app-nav-icon" title={t("lobby.nav.logout")} aria-label={t("lobby.nav.logout")}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="container page-main flex-1">
        <HeroBanner username={user?.username} stats={stats} />

        {/* The user's own state, asked for in the first seconds of the
            visit. The app knew the persona's mood; it had no way of
            knowing this. */}
        <div className="mb-8 surface p-5 sm:p-6 animate-fade-in-up">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="section-title">{t("moodCheckIn.title")}</h2>
          </div>
          <MoodCheckIn />
        </div>

        {stats && (stats.totalPersonas > 0 || stats.totalChats > 0) && (
          <motion.div
            className="stat-grid grid-cols-2 sm:grid-cols-4 mb-10"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            {[
              { value: stats.totalPersonas as number, label: t("lobby.stats.personas") },
              { value: stats.totalChats as number, label: t("lobby.stats.chats") },
              { value: stats.todayChats as number, label: t("lobby.stats.todayChats") },
              { value: readyCount as number, label: t("lobby.stats.online") },
            ].map((s, i) => (
              <motion.div key={s.label} variants={fadeUp} className="stat-block">
                <StatCell value={s.value} label={s.label} />
              </motion.div>
            ))}
          </motion.div>
        )}

        {hasPersonas ? (
          <>
            {readyCount === 0 && analyzingCount > 0 && (
              <div className="mb-8 surface px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  {t("lobby.directory.allAnalyzing")}
                </p>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
              <TodayRecommendation personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
              <DailyMessages personas={personas as any[]} />
            </div>

            <RemindersPanel personas={personas as any[]} />

            <div className="mb-12">
              <SectionHeading
                kicker={t("lobby.directory.kicker")}
                title={t("lobby.directory.title")}
                right={
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="relative" ref={sortMenuRef}>
                      <button onClick={() => setShowSort(!showSort)}
                        /**
                         * The button says whether the menu is open.
                         *
                         * It did not, so a screen reader announced a
                         * plain button where there was a menu.
                         */
                        aria-expanded={showSort}
                        aria-haspopup="menu"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowUpDown className="w-3 h-3" />
                        {t(SORT_OPTIONS.find(s => s.key === sortBy)?.labelKey ?? "lobby.sort.recent")}
                      </button>
                      {showSort && (
                        <div role="menu" aria-label={t("lobby.sort.label")}
                          className="absolute right-0 top-6 surface py-1 z-20 min-w-[110px]">
                          {SORT_OPTIONS.map(opt => (
                            <button key={opt.key} role="menuitem"
                              onClick={() => { setSortBy(opt.key); setShowSort(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${
                                sortBy === opt.key ? "text-cinnabar font-medium" : "text-muted-foreground"
                              }`}>
                              {t(opt.labelKey)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="outline"
                      onClick={() => { setSelecting(v => !v); setSelected([]); }}
                      className="text-xs h-7 px-3 bg-transparent">
                      <CheckSquare className="w-3 h-3" /> {t("lobby.directory.select")}
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(true)}
                      className="text-xs h-7 px-3">
                      <Plus className="w-3 h-3" /> {t("lobby.directory.new")}
                    </Button>
                  </div>
                }
              />

              {personas.length > 2 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                  <input
                    type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t("lobby.directory.search")}
                    className="w-full h-10 pl-9 pr-4 text-sm bg-card border border-border rounded-md outline-none focus:border-foreground/40 placeholder:text-muted-foreground/40 transition-colors"
                  />
                </div>
              )}

              {/* The bulk bar. Acting on one persona at a time is fine
                  when there are two of them; with eight it is not. */}
              {selecting && (
                <div className="flex items-center gap-2 mb-4 surface px-3 py-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {t("lobby.directory.selected", { count: selected.length })}
                  </span>
                  <div className="app-nav-spacer" />
                  <Button size="sm" variant="outline" className="text-xs h-7 px-3 bg-transparent"
                    /**
                     * The button is put out of reach while the writes
                     * are running — so a second click does not fire
                     * every one of them again.
                     */
                    disabled={selected.length === 0 || updateMutation.isPending}
                    onClick={() => {
                      selected.forEach(id => updateMutation.mutate({ id, isPinned: true }));
                      setSelected([]);
                    }}>
                    <Pin className="w-3 h-3" /> {t("lobby.directory.pinSelected")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-3"
                    onClick={() => { setSelecting(false); setSelected([]); }}>
                    {t("common.cancel")}
                  </Button>
                </div>
              )}

              {personas.length > 2 && (
                <div className="flex gap-4 mb-5 border-b border-border flex-wrap">
                  {FILTER_TABS.map(tab => {
                    const count = tab.key === "all" ? personas.length : personas.filter((p: any) => p.analysisStatus === tab.key).length;
                    if (tab.key !== "all" && count === 0) return null;
                    return (
                      <button key={tab.key} onClick={() => setFilterTab(tab.key)}
                        className={`pb-2 -mb-px text-xs border-b-2 transition-colors ${
                          filterTab === tab.key
                            ? "border-cinnabar text-foreground font-medium"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}>
                        {t(tab.labelKey)} {count > 0 && <span className="ml-1 text-[10px] text-muted-foreground/60">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {livePersonas.map((p: any) => (
                  <PersonaCard key={p.id} persona={p}
                    onChat={() => navigate(`/chat/${p.id}`)}
                    onUpload={() => navigate(`/upload/${p.id}`)}
                    onEdit={() => navigate(`/persona/${p.id}/edit`)}
                    onDelete={() => setDeleteTarget(p)}
                    onTogglePin={() => togglePin(p)}
                    selectable={selecting}
                    selected={selected.includes(p.id)}
                    onToggleSelect={() => setSelected(prev =>
                      prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                    )} />
                ))}
                {filteredPersonas.length === 0 && searchQuery && (
                  <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                    {t("lobby.directory.noMatch")}
                  </div>
                )}
                {filteredPersonas.length === 0 && !searchQuery && filterTab !== "all" && (
                  <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                    {t("lobby.directory.emptyTab")}
                  </div>
                )}
              </div>

              {/* The graduated ones are folded away. They are still
                  there — the letter, the timeline, the page — but they do
                  not take up the room of the people you are still
                  talking to. */}
              {graduatedPersonas.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowGraduated(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showGraduated ? "" : "-rotate-90"}`} />
                    {t("lobby.directory.graduated", { count: graduatedPersonas.length })}
                  </button>
                  {showGraduated && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-3">
                      {graduatedPersonas.map((p: any) => (
                        <PersonaCard key={p.id} persona={p}
                          onChat={() => navigate(`/chat/${p.id}`)}
                          onUpload={() => navigate(`/upload/${p.id}`)}
                          onEdit={() => navigate(`/persona/${p.id}/edit`)}
                          onDelete={() => setDeleteTarget(p)}
                          onTogglePin={() => togglePin(p)}
                          selectable={selecting}
                          selected={selected.includes(p.id)}
                          onToggleSelect={() => setSelected(prev =>
                            prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                          )} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <RecentActivity onNavigate={(id) => navigate(`/chat/${id}`)} />

            <section className="mt-4 pt-2">
              <SectionHeading kicker={t("lobby.directory.study")} title={t("lobby.directory.records")} />
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                <ChatStreak />
                <EmotionalWeather personas={personas as any[]} />
                <ActivityHeatmap />
                <MiniCalendar />
                <MemoryHighlights personas={personas as any[]} />
                <AchievementBadges stats={stats} />
              </div>
              <QuickChatBar personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
              <PersonaConstellation personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
              <ConversationStarters personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
              <PersonaLeaderboard personas={personas as any[]} />
              <TemplateLibrarySection
                onCreated={(id) => { refetch(); navigate(`/chat/${id}`); }}
                onQuestionnaire={() => navigate("/persona/new/questionnaire")}
              />
              <TipsSection />
            </section>
          </>
        ) : (
          <>
            <EmptyState
              onCreate={() => setShowCreate(true)}
              onTryIt={handleTryIt}
              sandboxPending={sandboxPending}
            />
            {/**
             * The templates are here too.
             *
             * The "start from a template" button in the create dialog
             * scrolls to this section — and the section was only
             * rendered when the user already had a persona. So on the
             * empty state the button did nothing at all: the dialog
             * closed and nothing happened. And the empty state is
             * precisely the user who has no chat logs to upload and
             * needs a way in.
             */}
            <TemplateLibrarySection
              onCreated={(id) => { refetch(); navigate(`/chat/${id}`); }}
              onQuestionnaire={() => navigate("/persona/new/questionnaire")}
            />
          </>
        )}
      </main>

      <footer className="border-t border-border py-6">
        <div className="container mx-auto flex items-center justify-between text-xs text-muted-foreground/60">
          <Wordmark size="text-sm" />
          <span>{t("landing.footer.tagline")}</span>
        </div>
      </footer>

      <CreatePersonaDialog open={showCreate} onOpenChange={setShowCreate}
        onCreated={(id) => { refetch(); navigate(`/upload/${id}`); }} />

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-lg text-foreground">{t("lobby.deleteDialog.title")}</DialogTitle></DialogHeader>
          <p className="text-muted-foreground text-sm py-2 leading-relaxed">
            {t("lobby.deleteDialog.bodyLead")} <span className="text-foreground font-medium">{deleteTarget?.name}</span> {t("lobby.deleteDialog.bodyTail")}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="rounded-md">{t("common.cancel")}</Button>
            <Button variant="destructive" className="rounded-md"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
