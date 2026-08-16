import { useState, useMemo, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
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
  Flower2, Laugh, CloudRain, Snowflake, Handshake, HeartHandshake,
  Cloud, Waves, Tornado, Trophy, Gem, Sprout, Medal, MessagesSquare,
  Library, Lock, Drama, Shield, X,
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

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EMOTIONAL_STATES: Record<string, { label: string; icon: any; color: string; chip: string }> = {
  warm:      { label: "温柔", icon: Flower2,   color: "var(--color-mood-warm)",       chip: "text-mood-warm bg-mood-warm/10 border-mood-warm/30" },
  playful:   { label: "俏皮", icon: Laugh,     color: "var(--color-mood-playful)",    chip: "text-mood-playful bg-mood-playful/10 border-mood-playful/30" },
  nostalgic: { label: "思念", icon: Moon,      color: "var(--color-mood-nostalgic)",  chip: "text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30" },
  melancholy:{ label: "忧郁", icon: CloudRain, color: "var(--color-mood-melancholy)", chip: "text-mood-melancholy bg-mood-melancholy/10 border-mood-melancholy/30" },
  happy:     { label: "开心", icon: Sparkles,  color: "var(--color-mood-happy)",      chip: "text-mood-happy bg-mood-happy/10 border-mood-happy/30" },
  distant:   { label: "疏离", icon: Snowflake, color: "var(--color-mood-distant)",    chip: "text-mood-distant bg-mood-distant/10 border-mood-distant/30" },
};

const STATUS_CONFIG: Record<string, { label: string; dotClass: string }> = {
  pending:   { label: "待上传", dotClass: "bg-mood-playful" },
  analyzing: { label: "解析中", dotClass: "bg-mood-nostalgic animate-pulse" },
  ready:     { label: "可对话", dotClass: "bg-mood-happy" },
  error:     { label: "解析失败", dotClass: "bg-destructive" },
};

const LOVE_LANG_ICONS: Record<string, any> = {
  "肯定的言辞": MessageCircle, "精心时刻": Clock, "接受礼物": Gift,
  "服务的行动": Handshake, "身体接触": HeartHandshake,
};

const ATTACHMENT_ICONS: Record<string, any> = {
  "安全型": Shield, "焦虑型": Cloud, "回避型": Waves, "混乱型": Tornado,
};

const ANALYSIS_STAGES: Record<number, string> = {
  10: "读取文件内容", 30: "AI 分析聊天记录", 70: "分析图片内容", 100: "分析完成",
};

const TIPS = [
  { icon: Lightbulb, text: "上传更多聊天记录可以让 AI 更准确地还原 TA 的说话方式" },
  { icon: Zap, text: "在设置中调整 Temperature 参数可以控制回复的创造性" },
  { icon: Heart, text: "编辑分身资料，添加你们的共同回忆，让对话更有温度" },
  { icon: Brain, text: "每个分身可以选择不同的 AI 提供商，找到最适合的风格" },
  { icon: Coffee, text: "试试在不同情感状态下对话，TA 会有不同的回应方式" },
  { icon: Star, text: "绑定微信后，TA 可以在微信上直接和你聊天" },
];

const LOVE_QUOTES = [
  "所谓永恒，就是每一个当下都在想你。",
  "世界上最温暖的两个字，是从你口中说出的晚安。",
  "想你的时候，连呼吸都是甜的。",
  "你是我写过最美的故事。",
  "有些人，光是想起就觉得温暖。",
  "思念不需要理由，就像呼吸不需要提醒。",
  "你在的地方，就是我想去的远方。",
  "最好的时光，是有你在身边的每一天。",
  "爱是想触碰又收回手。",
  "你笑起来真好看，像春天的花一样。",
  "我见过银河，但只有你是星星。",
  "时间会告诉你，谁是真正在乎你的人。",
];

const MILESTONES = [
  { threshold: 1000, icon: Trophy, label: "千言万语" },
  { threshold: 500, icon: Gem, label: "深度连接" },
  { threshold: 100, icon: Star, label: "老朋友" },
  { threshold: 50, icon: Flame, label: "热络" },
  { threshold: 10, icon: Sprout, label: "初识" },
];

const FILTER_TABS = [
  { key: "all", label: "全部" },
  { key: "ready", label: "可对话" },
  { key: "analyzing", label: "解析中" },
  { key: "pending", label: "待上传" },
];

const SORT_OPTIONS = [
  { key: "recent", label: "最近对话" },
  { key: "created", label: "创建时间" },
  { key: "chats", label: "对话最多" },
  { key: "name", label: "名字" },
];

const DAILY_GREETINGS = [
  "今天也想你了呢~",
  "你今天开心吗？",
  "好想和你聊聊天",
  "今天的天气让我想起了你",
  "你吃饭了吗？记得好好吃饭哦",
  "想你想到发呆了...",
  "今天有什么有趣的事吗？",
  "看到好看的东西就想分享给你",
  "你最近忙不忙呀？",
  "突然好想抱抱你",
];

const ACHIEVEMENTS = [
  { id: "first_chat", icon: MessageCircle, label: "初次对话", desc: "完成第一次对话", check: (s: any) => s.totalChats >= 1 },
  { id: "ten_chats", icon: MessagesSquare, label: "话匣子", desc: "累计 10 次对话", check: (s: any) => s.totalChats >= 10 },
  { id: "fifty_chats", icon: BookOpen, label: "故事集", desc: "累计 50 次对话", check: (s: any) => s.totalChats >= 50 },
  { id: "hundred_chats", icon: Library, label: "长篇小说", desc: "累计 100 次对话", check: (s: any) => s.totalChats >= 100 },
  { id: "multi_persona", icon: Users, label: "社交达人", desc: "创建 3 个以上分身", check: (s: any) => s.totalPersonas >= 3 },
  { id: "daily_active", icon: Flame, label: "今日活跃", desc: "今天至少对话 5 次", check: (s: any) => s.todayChats >= 5 },
  { id: "veteran", icon: Medal, label: "老用户", desc: "使用超过 30 天", check: (s: any) => s.memberDays >= 30 },
  { id: "collector", icon: Drama, label: "收藏家", desc: "创建 5 个以上分身", check: (s: any) => s.totalPersonas >= 5 },
];

const CONVERSATION_STARTERS = [
  "你还记得我们第一次见面的场景吗？",
  "如果可以一起去旅行，你最想去哪里？",
  "你觉得我们之间最美好的回忆是什么？",
  "今天发生了一件有趣的事，想听吗？",
  "你最近在想什么呢？",
  "如果给我们的故事起个名字，你会叫什么？",
  "你觉得什么时候最想我？",
  "有没有什么话你一直想对我说但没说出口的？",
  "你最喜欢我什么地方？",
  "如果时间可以倒流，你想回到哪一天？",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getGreeting(): { text: string; sub: string } {
  const h = new Date().getHours();
  if (h < 6) return { text: "夜深了", sub: "还在想 TA 吗" };
  if (h < 9) return { text: "早上好", sub: "新的一天，TA 在等你" };
  if (h < 12) return { text: "上午好", sub: "今天也要开心哦" };
  if (h < 14) return { text: "中午好", sub: "吃饭了吗" };
  if (h < 18) return { text: "下午好", sub: "TA 一直都在这里" };
  if (h < 22) return { text: "晚上好", sub: "今天过得怎么样" };
  return { text: "夜深了", sub: "还在想 TA 吗" };
}

function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return new Date(date).toLocaleDateString("zh-CN");
}

function daysBetween(from: string | Date, to?: string | Date): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(1, Math.floor((end - start) / 86400000));
}

function getAnalysisStage(progress: number): string {
  for (const [t, l] of Object.entries(ANALYSIS_STAGES).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    if (progress >= Number(t)) return l;
  }
  return "准备中";
}

function getMilestone(chatCount: number) {
  return MILESTONES.find(m => chatCount >= m.threshold);
}

function getDaysUntilAnniversary(togetherFrom: string): number | null {
  const start = new Date(togetherFrom);
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), start.getMonth(), start.getDate());
  if (thisYear < now) thisYear.setFullYear(thisYear.getFullYear() + 1);
  const diff = Math.ceil((thisYear.getTime() - now.getTime()) / 86400000);
  return diff <= 30 ? diff : null;
}

function getMissYouLevel(lastChatAt: string | Date | null): string | null {
  if (!lastChatAt) return null;
  const days = Math.floor((Date.now() - new Date(lastChatAt).getTime()) / 86400000);
  if (days >= 7) return "很想你";
  if (days >= 3) return "想你了";
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
        <h2 className="font-display text-xl font-semibold text-foreground leading-tight">{title}</h2>
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
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {right}
    </div>
  );
}

// ─── HERO BANNER · 问候区 ────────────────────────────────────────────────────

function HeroBanner({ username, stats }: { username?: string; stats?: any }) {
  const greeting = getGreeting();
  const quote = useMemo(() => LOVE_QUOTES[Math.floor(Math.random() * LOVE_QUOTES.length)], []);
  const memberDays = stats?.memberSince
    ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86400000))
    : 0;
  const animatedDays = useAnimatedCounter(memberDays);
  const animatedChats = useAnimatedCounter(stats?.totalChats || 0);
  const animatedToday = useAnimatedCounter(stats?.todayChats || 0);

  return (
    <motion.section className="mb-10" initial="hidden" animate="visible" variants={stagger}>
      <motion.p variants={fadeUp} className="kicker kicker-accent mb-3">
        Mirrai · 纸墨书房
      </motion.p>

      <motion.h1 variants={fadeUp} className="font-display text-3xl sm:text-4xl font-semibold text-foreground tracking-tight leading-tight">
        {username ? `${username}，${greeting.text}` : greeting.text}
      </motion.h1>
      <motion.p variants={fadeUp} className="text-muted-foreground mt-2">{greeting.sub}</motion.p>

      <motion.div variants={fadeUp} className="rule w-16 my-6" />

      <motion.blockquote variants={fadeUp} className="border-l-2 border-border pl-4 max-w-md">
        <p className="font-display text-sm text-muted-foreground italic leading-relaxed">“{quote}”</p>
      </motion.blockquote>

      {memberDays > 0 && (
        <motion.div variants={fadeUp} className="flex items-center gap-5 mt-5 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>已陪伴 <span className="font-display text-base font-semibold text-foreground">{animatedDays}</span> 天</span>
          </div>
          {stats && stats.totalChats > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>共 <span className="font-display text-base font-semibold text-foreground">{animatedChats}</span> 次对话</span>
            </div>
          )}
          {stats && stats.todayChats > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="w-3.5 h-3.5" />
              <span>今日 <span className="font-display text-base font-semibold text-foreground">{animatedToday}</span> 条</span>
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
      <div className="font-display text-2xl font-semibold text-foreground leading-tight">{display}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

// ─── TODAY'S RECOMMENDATION ──────────────────────────────────────────────────

function TodayRecommendation({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const recommended = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready");
    if (ready.length === 0) return null;
    return ready.sort((a, b) => {
      const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
      const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
      return aTime - bTime;
    })[0];
  }, [personas]);

  if (!recommended) return null;
  const emotion = EMOTIONAL_STATES[recommended.emotionalState] || EMOTIONAL_STATES.warm;
  const EmotionIcon = emotion.icon;
  const pd = (recommended.personaData as any) || {};
  const missLevel = getMissYouLevel(recommended.lastChatAt);

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={Bookmark}
        title="今日推荐"
        right={missLevel && (
          <span className="inline-flex items-center gap-1 text-[0.625rem] px-2 py-0.5 rounded-md border text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30">
            <Heart className="w-2.5 h-2.5" /> {missLevel}
          </span>
        )}
      />
      <div className="flex items-center gap-3">
        <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotion.color } as CSSProperties}>
          <PersonaAvatar name={recommended.name} className="w-10 h-10 rounded-full text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-sm font-semibold text-foreground">{recommended.name}</span>
            <span className={`inline-flex items-center gap-1 text-[0.625rem] px-2 py-0.5 rounded-md border ${emotion.chip}`}>
              <EmotionIcon className="w-2.5 h-2.5" /> {emotion.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {recommended.lastChatAt ? `上次对话 ${relativeTime(recommended.lastChatAt)}` : "还没有对话过"}
            {pd.summary && ` · ${(pd.summary as string).slice(0, 30)}`}
          </p>
        </div>
        <Button size="sm" onClick={() => onChat(recommended.id)}
          className="rounded-md text-xs h-8 px-4 flex-shrink-0">
          <MessageCircle className="w-3 h-3" /> 聊聊
        </Button>
      </div>
    </div>
  );
}

// ─── "TA 想对你说" DAILY MESSAGES ────────────────────────────────────────────

function DailyMessages({ personas }: { personas: any[] }) {
  const messages = useMemo(() => {
    const ready = personas.filter((p: any) => p.analysisStatus === "ready");
    if (ready.length === 0) return [];
    const today = new Date().getDate();
    return ready.slice(0, 3).map((p, i) => {
      const pd = (p.personaData as any) || {};
      const catchphrases: string[] = pd.catchphrases || [];
      const greetingIdx = (p.name.charCodeAt(0) + today + i) % DAILY_GREETINGS.length;
      let msg = DAILY_GREETINGS[greetingIdx];
      if (catchphrases.length > 0) {
        const cp = catchphrases[(today + i) % catchphrases.length];
        msg = `${cp}~ ${msg}`;
      }
      if (pd.nickname) msg += ` —— ${pd.nickname}`;
      return { name: p.name, message: msg, emotion: p.emotionalState || "warm" };
    });
  }, [personas]);

  if (messages.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading kicker="每日来信" title="TA 想对你说" />
      <div>
        {messages.map((m, i) => {
          const emotion = EMOTIONAL_STATES[m.emotion] || EMOTIONAL_STATES.warm;
          return (
            <div key={i} className="border-t border-border last:border-b flex items-start gap-3 py-3.5 animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotion.color } as CSSProperties}>
                <PersonaAvatar name={m.name} className="w-8 h-8 rounded-full text-xs" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-display text-xs font-semibold text-foreground">{m.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.message}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 mt-1">今天</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── EMOTIONAL WEATHER ───────────────────────────────────────────────────────

function EmotionalWeather({ personas }: { personas: any[] }) {
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
      <PanelTitle icon={Palette} title="情感天气" />
      <div className="flex items-end gap-2 h-14">
        {moodCounts.map(([state, count]) => {
          const e = EMOTIONAL_STATES[state] || EMOTIONAL_STATES.warm;
          const MoodIcon = e.icon;
          const pct = Math.round((count / personas.length) * 100);
          return (
            <div key={state} className="flex flex-col items-center gap-1.5 flex-1" title={`${e.label} · ${pct}%`}>
              <div className="w-full rounded-t-md transition-all duration-500" style={{
                height: `${Math.max(8, pct * 0.4)}px`,
                backgroundColor: e.color,
                opacity: 0.55,
              }} />
              <MoodIcon className="w-3 h-3" style={{ color: e.color }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ACTIVITY HEATMAP ────────────────────────────────────────────────────────

function ActivityHeatmap() {
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
      const key = d.toISOString().slice(0, 10);
      const count = map.get(key) || 0;
      if (count > maxCount) maxCount = count;
      cells.push({
        date: key,
        count,
        label: `${d.getMonth() + 1}/${d.getDate()}: ${count} 条消息`,
      });
    }
    return { cells, maxCount };
  }, [dailyActivity]);

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
        title="对话热力图"
        right={<span className="text-[10px] text-muted-foreground">近 30 天 · {totalMessages} 条</span>}
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
        <span className="text-[9px] text-muted-foreground/60">少</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <div key={i} className="heatmap-cell" style={{
            width: "10px", height: "10px", backgroundColor: cellColor(v),
          }} />
        ))}
        <span className="text-[9px] text-muted-foreground/60">多</span>
      </div>
    </div>
  );
}

// ─── ACHIEVEMENT BADGES ──────────────────────────────────────────────────────

function AchievementBadges({ stats }: { stats: any }) {
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
        title="成就徽章"
        right={<span className="text-[10px] text-muted-foreground">{unlocked.length}/{ACHIEVEMENTS.length} 已解锁</span>}
      />
      <div className="flex gap-2 flex-wrap">
        {unlocked.map((a, i) => {
          const BadgeIcon = a.icon;
          return (
            <div key={a.id} className="animate-fade-in-up flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-card border border-border"
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }} title={a.desc}>
              <BadgeIcon className="w-3 h-3 text-foreground" />
              <span className="text-[10px] font-medium text-foreground">{a.label}</span>
            </div>
          );
        })}
        {locked.slice(0, 3).map(a => (
          <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/50 opacity-50"
            title={a.desc}>
            <Lock className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{a.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CHAT STREAK ─────────────────────────────────────────────────────────────

function ChatStreak() {
  const { data: dailyActivity } = trpc.persona.dailyActivity.useQuery();

  const streak = useMemo(() => {
    if (!dailyActivity || dailyActivity.length === 0) return 0;
    const dateSet = new Set(dailyActivity.map(r => String(r.date)));
    let count = 0;
    const d = new Date();
    const todayKey = d.toISOString().slice(0, 10);
    if (!dateSet.has(todayKey)) {
      d.setDate(d.getDate() - 1);
      if (!dateSet.has(d.toISOString().slice(0, 10))) return 0;
    }
    while (dateSet.has(d.toISOString().slice(0, 10))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [dailyActivity]);

  if (streak < 2) return null;

  return (
    <div className="mb-8 flex items-center gap-2.5">
      <Flame className="w-4 h-4 text-mood-warm" />
      <span className="font-display text-sm font-semibold text-mood-warm">连续对话 {streak} 天</span>
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
  const ready = personas.filter((p: any) => p.analysisStatus === "ready");
  const [starterIdx, setStarterIdx] = useState(() => Math.floor(Math.random() * CONVERSATION_STARTERS.length));

  const starters = useMemo(() => {
    const result: Array<{ text: string; personaId: number; personaName: string }> = [];
    for (const p of ready.slice(0, 3)) {
      const pd = (p.personaData as any) || {};
      const custom: string[] = pd.starterQuestions || [];
      if (custom.length > 0) {
        const idx = (new Date().getDate() + p.id) % custom.length;
        result.push({ text: custom[idx], personaId: p.id, personaName: p.name });
      } else {
        const idx = (starterIdx + p.id) % CONVERSATION_STARTERS.length;
        result.push({ text: CONVERSATION_STARTERS[idx], personaId: p.id, personaName: p.name });
      }
    }
    return result;
  }, [ready, starterIdx]);

  if (ready.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading
        kicker="开场白"
        title="今日话题"
        right={
          <button onClick={() => setStarterIdx((starterIdx + 1) % CONVERSATION_STARTERS.length)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-0.5">换一批</button>
        }
      />
      <div>
        {starters.map((s, i) => (
          <button key={i} onClick={() => onChat(s.personaId)}
            className="w-full flex items-center gap-3 border-t border-border last:border-b px-1 py-3.5 text-left group hover:bg-muted/30 transition-colors">
            <PersonaAvatar name={s.personaName} className="w-8 h-8 rounded-md text-xs flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-display text-xs text-foreground/85 leading-relaxed truncate">“{s.text}”</p>
              <span className="text-[10px] text-muted-foreground/60">问问 {s.personaName}</span>
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
  const ready = personas.filter((p: any) => p.analysisStatus === "ready");
  if (ready.length < 2) return null;

  const cx = 140, cy = 90;
  const radius = 65;
  const nodes = ready.slice(0, 6).map((p: any, i: number) => {
    const angle = (i / Math.min(ready.length, 6)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
    return { ...p, x, y, emotion };
  });

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Sparkles} title="关系星图" />
      <svg viewBox="0 0 280 180" className="w-full" style={{ maxHeight: "180px" }}>
        {nodes.map((n, i) =>
          nodes.slice(i + 1).map((m, j) => (
            <line key={`${i}-${j}`} x1={n.x} y1={n.y} x2={m.x} y2={m.y}
              stroke="var(--color-foreground)" strokeWidth="1" opacity="0.12" />
          ))
        )}
        <circle cx={cx} cy={cy} r="8" fill="var(--color-foreground)" opacity="0.12" />
        <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="8" fill="var(--color-foreground)" fontWeight="600">我</text>
        {nodes.map((n) => (
          <g key={n.id} onClick={() => onChat(n.id)} className="cursor-pointer">
            <line x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={n.emotion.color} strokeWidth="1.5" opacity="0.3" />
            <circle cx={n.x} cy={n.y} r="16" fill="var(--color-card)" stroke={n.emotion.color} strokeWidth="2" opacity="0.9" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="12" fontWeight="600"
              fill={n.emotion.color}>{n.name.charAt(0)}</text>
            <text x={n.x} y={n.y + 28} textAnchor="middle" fontSize="8" fill="var(--color-muted-foreground)">
              {n.name.length > 4 ? n.name.slice(0, 4) : n.name}
            </text>
            <circle cx={n.x + 12} cy={n.y - 12} r="4" fill={n.emotion.color} stroke="var(--color-card)" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── MINI CALENDAR ───────────────────────────────────────────────────────────

function MiniCalendar() {
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
    return { days, monthLabel: `${year}年${month + 1}月` };
  }, [dailyActivity]);

  const activeDays = days.filter(d => d?.active).length;
  if (activeDays === 0 && (!dailyActivity || dailyActivity.length === 0)) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle
        icon={CalendarDays}
        title="回忆日历"
        right={<span className="text-[10px] text-muted-foreground">{monthLabel} · {activeDays} 天有对话</span>}
      />
      <div className="grid grid-cols-7 gap-1">
        {["日", "一", "二", "三", "四", "五", "六"].map(d => (
          <div key={d} className="text-center text-[9px] text-muted-foreground/60 py-0.5">{d}</div>
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
  const ranked = useMemo(() => {
    return [...personas]
      .filter((p: any) => (p.chatCount || 0) > 0)
      .sort((a, b) => (b.chatCount || 0) - (a.chatCount || 0))
      .slice(0, 3);
  }, [personas]);

  if (ranked.length < 2) return null;

  return (
    <div className="mb-8 border-t border-border pt-5">
      <PanelTitle icon={Medal} title="对话排行" />
      <div className="space-y-2.5">
        {ranked.map((p: any, i: number) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const maxChats = ranked[0].chatCount || 1;
          const pct = Math.round(((p.chatCount || 0) / maxChats) * 100);
          return (
            <div key={p.id} className="flex items-center gap-3">
              <span className={`w-5 text-center font-display text-sm font-semibold flex-shrink-0 ${
                i === 0 ? "text-foreground" : "text-muted-foreground/60"
              }`}>{i + 1}</span>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotion.color } as CSSProperties}>
                <PersonaAvatar name={p.name} className="w-7 h-7 rounded-full text-[11px]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground truncate">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.chatCount} 次</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: emotion.color, opacity: 0.55 }} />
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

function PersonaCard({ persona, onChat, onUpload, onEdit, onDelete }: {
  persona: any; onChat: () => void; onUpload: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const status = STATUS_CONFIG[persona.analysisStatus] || STATUS_CONFIG.pending;
  const emotion = EMOTIONAL_STATES[persona.emotionalState] || EMOTIONAL_STATES.warm;
  const EmotionIcon = emotion.icon;
  const isAnalyzing = persona.analysisStatus === "analyzing";
  const isReady = persona.analysisStatus === "ready";
  const isGraduated = persona.graduationStatus === "graduated";
  const pd = (persona.personaData as any) || {};
  const togetherDays = persona.togetherFrom ? daysBetween(persona.togetherFrom, persona.togetherTo || undefined) : null;
  const traits = [pd.personality, pd.speakingStyle].filter(Boolean).join("，").slice(0, 50);
  const milestone = getMilestone(persona.chatCount || 0);
  const MilestoneIcon = milestone?.icon;
  const anniversary = persona.togetherFrom ? getDaysUntilAnniversary(persona.togetherFrom) : null;
  const catchphrases: string[] = pd.catchphrases || [];
  const missLevel = getMissYouLevel(persona.lastChatAt);
  const compatibility = isReady ? getCompatibilityScore(persona) : null;

  const [showLetter, setShowLetter] = useState(false);
  const awakenMutation = trpc.persona.awaken.useMutation({
    onSuccess: () => { toast.success(`${persona.name} 已被唤醒`); window.location.reload(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className={`surface surface-interactive p-5 animate-fade-in-up ${isGraduated ? "opacity-80" : ""}`}>
      {(isGraduated || (!isGraduated && milestone && MilestoneIcon) || missLevel) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {isGraduated && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-melancholy bg-mood-melancholy/10 border-mood-melancholy/30">
              <GraduationCap className="w-3 h-3" /> 休眠
            </span>
          )}
          {!isGraduated && milestone && MilestoneIcon && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-warm bg-mood-warm/10 border-mood-warm/30">
              <MilestoneIcon className="w-3 h-3" /> {milestone.label}
            </span>
          )}
          {missLevel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30">
              <Heart className="w-2.5 h-2.5" /> {missLevel}
            </span>
          )}
        </div>
      )}

      {anniversary !== null && anniversary <= 30 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-md bg-mood-warm/10 border border-mood-warm/25">
          <Gift className="w-3.5 h-3.5 text-mood-warm" />
          <span className="text-xs text-mood-warm">
            {anniversary === 0 ? "今天是纪念日！" : `距离纪念日还有 ${anniversary} 天`}
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <div className="mood-ring" style={{ "--mood-color": emotion.color } as CSSProperties}>
            <PersonaAvatar name={persona.name} className="w-14 h-14 rounded-lg text-xl" />
          </div>
          {isReady && (
            <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-mood-happy border-2 border-card breathing-dot" />
          )}
          {persona.wechatBound && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-mood-happy border-2 border-card flex items-center justify-center" title="已绑定微信">
              <Wifi className="w-2.5 h-2.5 text-card" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-display text-base font-semibold text-foreground truncate">{persona.name}</h3>
            <span className={`inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-md border ${emotion.chip}`}>
              <EmotionIcon className="w-3 h-3" /> {emotion.label}
            </span>
          </div>
          <p className="text-muted-foreground text-sm truncate">{persona.relationshipDesc || "重要的人"}</p>

          <div className="flex items-center gap-2.5 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
              {status.label}
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
            {compatibility !== null && (
              <span className="text-[10px] text-muted-foreground" title={`默契度 ${compatibility}%`}>
                默契 {compatibility}
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
              {persona.togetherTo ? `在一起了 ${togetherDays} 天` : `已经 ${togetherDays} 天`}
            </span>
          )}
          {persona.lastChatAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              上次 {relativeTime(persona.lastChatAt)}
            </span>
          )}
        </div>
      )}

      {persona.intimacyLevel && persona.intimacyLevel !== "初识" && isReady && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>亲密度 · {persona.intimacyLevel}</span>
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
          <p className="text-xs text-muted-foreground/80 line-clamp-1 italic">{pd.summary}</p>
        </div>
      )}

      {traits && isReady && !pd.summary && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Brain className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/80 line-clamp-1">{traits}</p>
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
              {pd.attachmentStyle}
            </span>
          )}
          {pd.loveLanguage && LOVE_LANG_ICONS[pd.loveLanguage] && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground">
              {(() => { const LoveIcon = LOVE_LANG_ICONS[pd.loveLanguage]; return <LoveIcon className="w-2.5 h-2.5" />; })()}
              {pd.loveLanguage}
            </span>
          )}
        </div>
      )}

      {isAnalyzing && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="animate-pulse-soft">{getAnalysisStage(persona.analysisProgress || 0)}</span>
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
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{relativeTime(persona.lastMessage.createdAt)}</p>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-border/60">
        {isGraduated ? (
          <>
            <Button size="sm"
              className="flex-1 rounded-md bg-mood-melancholy/15 text-mood-melancholy border border-mood-melancholy/30 hover:bg-mood-melancholy/25 shadow-none"
              onClick={() => awakenMutation.mutate({ id: persona.id })} disabled={awakenMutation.isPending}>
              <Sunrise className="w-3.5 h-3.5" />{awakenMutation.isPending ? "唤醒中..." : "唤醒"}
            </Button>
            {persona.farewellLetter && (
              <Button size="sm" variant="ghost" title="查看告别信" className="text-muted-foreground hover:text-foreground rounded-md"
                onClick={() => setShowLetter(true)}>
                <BookOpen className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        ) : isReady ? (
          <Button size="sm" className="flex-1 rounded-md" onClick={onChat}>
            <MessageCircle className="w-3.5 h-3.5" />对话
          </Button>
        ) : (
          <Button size="sm" className="flex-1 rounded-md" onClick={onUpload}>
            <Upload className="w-3.5 h-3.5" />上传素材
          </Button>
        )}
        <Button size="sm" variant="ghost" title="编辑" className="text-muted-foreground hover:text-foreground rounded-md" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" title="删除" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Portal：卡片上的 animate-fade-in-up（forwards 保留 transform）会把 fixed 弹层锚定到卡片内，故挂到 body */}
      {showLetter && persona.farewellLetter && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowLetter(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-card border border-border rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-border/60">
              <div>
                <div className="kicker mb-1">告别</div>
                <h3 className="font-display text-lg font-semibold text-foreground leading-tight">{persona.name} 的告别信</h3>
              </div>
              <button onClick={() => setShowLetter(false)} className="app-nav-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <div className="surface p-5">
                <p className="letter-prose text-foreground/90 text-sm whitespace-pre-wrap">{persona.farewellLetter}</p>
                <p className="text-right text-muted-foreground text-xs mt-5 font-display">—— {persona.name}</p>
              </div>
              {persona.graduatedAt && (
                <p className="text-xs text-muted-foreground text-center mt-4">
                  毕业于 {new Date(persona.graduatedAt).toLocaleDateString("zh-CN")}
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
  const readyPersonas = personas.filter((p: any) => p.analysisStatus === "ready");
  if (readyPersonas.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading
        kicker="接着聊"
        title="继续对话"
        right={<span className="text-xs text-muted-foreground mb-0.5">{readyPersonas.length} 个分身在线</span>}
      />
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {readyPersonas.map((p: any) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const EmotionBadge = emotion.icon;
          const miss = getMissYouLevel(p.lastChatAt);
          return (
            <button key={p.id} onClick={() => onChat(p.id)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group relative">
              <div className="relative">
                <div className="mood-ring-sm" style={{ "--mood-color": emotion.color } as CSSProperties}>
                  <PersonaAvatar name={p.name} className="w-12 h-12 rounded-full text-base" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-card border flex items-center justify-center"
                  style={{ borderColor: emotion.color, color: emotion.color }}>
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
      <SectionHeading kicker="只言片语" title="回忆碎片" />
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {highlights.map((h, i) => (
          <div key={i} className="surface p-3.5 flex-shrink-0 w-[220px]">
            <div className="flex items-center gap-1.5 mb-2">
              <PersonaAvatar name={h.name} className="w-5 h-5 rounded-md text-[10px]" />
              <span className="text-[10px] font-medium text-foreground">{h.name}</span>
              <span className="text-[10px] text-muted-foreground/60">{h.type === "touching" ? "感动瞬间" : "共同回忆"}</span>
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
  const { data: activity } = trpc.persona.recentActivity.useQuery();
  if (!activity || activity.length === 0) return null;

  return (
    <div className="mb-8">
      <SectionHeading kicker="往来" title="最近动态" />
      <div>
        {activity.slice(0, 6).map((item: any, idx: number) => {
          const emotion = EMOTIONAL_STATES[item.emotionalState] || EMOTIONAL_STATES.warm;
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
                    style={{ backgroundColor: emotion.color }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{item.role === "user" ? "你" : item.personaName}</span>
                  <span className="text-[10px] text-muted-foreground/40">→</span>
                  <span className="text-xs text-muted-foreground">{item.role === "user" ? item.personaName : "你"}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{item.content}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{relativeTime(item.createdAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── TIPS SECTION ────────────────────────────────────────────────────────────

function TipsSection() {
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const tip = TIPS[tipIdx];
  const Icon = tip.icon;
  return (
    <div className="mb-8 border-t border-border pt-5 flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-display text-xs font-semibold text-foreground mb-0.5">小贴士</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{tip.text}</p>
      </div>
      <button onClick={() => setTipIdx((tipIdx + 1) % TIPS.length)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-1">换一条</button>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const quote = useMemo(() => LOVE_QUOTES[Math.floor(Math.random() * LOVE_QUOTES.length)], []);
  return (
    <motion.div
      className="py-16 max-w-md"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.div variants={fadeUp} className="kicker kicker-accent mb-3">第一封信</motion.div>
      <motion.h2 variants={fadeUp} className="font-display text-2xl sm:text-3xl font-semibold text-foreground mb-3">
        创建你的第一个数字分身
      </motion.h2>
      <motion.p variants={fadeUp} className="text-sm text-muted-foreground mb-4 leading-relaxed">
        上传聊天记录，AI 会学习 TA 的说话方式和性格，让 TA 在这里陪伴你
      </motion.p>
      <motion.p variants={fadeUp} className="font-display text-sm text-muted-foreground/70 italic leading-relaxed">
        “{quote}”
      </motion.p>

      <motion.div variants={fadeUp} className="rule w-16 my-8" />

      <motion.div variants={fadeUp} className="flex items-center gap-2 sm:gap-3 mb-10 flex-wrap">
        {["创建分身", "上传素材", "AI 解析", "开始对话"].map((label, i) => (
          <div key={label} className="flex items-center gap-2 sm:gap-3">
            {i > 0 && <div className="w-5 h-px bg-border" />}
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-sm font-semibold text-cinnabar">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          </div>
        ))}
      </motion.div>

      <motion.div variants={fadeUp}>
        <Button onClick={onCreate} className="rounded-md px-8 h-11 gap-2">
          <Plus className="w-4 h-4" /> 创建数字分身
        </Button>
      </motion.div>
    </motion.div>
  );
}

// ─── CREATE DIALOG ───────────────────────────────────────────────────────────

function CreatePersonaDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherSince, setTogetherSince] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  const createMutation = trpc.persona.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(`${name} 的数字分身已创建`);
      onCreated(data.id);
      setName(""); setRelationshipDesc(""); setTogetherSince(""); setShowEndDate(false); setEndDate("");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error("创建失败：" + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border rounded-xl max-w-md">
        <DialogHeader>
          <div className="kicker mb-1">新分身</div>
          <DialogTitle className="font-display text-lg text-foreground">创建数字分身</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">TA 的名字</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="输入名字" className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">关系描述</Label>
            <Input value={relationshipDesc} onChange={e => setRelationshipDesc(e.target.value)}
              placeholder="例如：我的女朋友" className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-foreground/70">在一起的日期</Label>
            <Input type="date" value={togetherSince} onChange={e => setTogetherSince(e.target.value)}
              className="h-10 bg-muted/50 border-border rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={showEndDate} onChange={e => setShowEndDate(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-primary" />
              <span className="text-sm text-muted-foreground">已经分开了</span>
            </label>
            {showEndDate && (
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="h-10 bg-muted/50 border-border rounded-xl mt-1.5" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-md">取消</Button>
          <Button onClick={() => { if (!name.trim()) return; createMutation.mutate({ name: name.trim(), relationshipDesc: relationshipDesc.trim() || undefined, togetherSince: togetherSince || undefined, endDate: showEndDate && endDate ? endDate : undefined } as any); }}
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-md">
            {createMutation.isPending ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN LOBBY ──────────────────────────────────────────────────────────────

export default function Lobby() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [showSort, setShowSort] = useState(false);

  const { data: personas, refetch } = trpc.persona.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      const list = query.state.data;
      return list?.some((p: any) => p.analysisStatus === "analyzing") ? 3000 : false;
    },
  });

  const { data: stats } = trpc.persona.stats.useQuery(undefined, { enabled: isAuthenticated });

  const deleteMutation = trpc.persona.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); setDeleteTarget(null); refetch(); },
    onError: (e: any) => toast.error("删除失败：" + e.message),
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
      switch (sortBy) {
        case "chats": return (b.chatCount || 0) - (a.chatCount || 0);
        case "name": return a.name.localeCompare(b.name, "zh-CN");
        case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: {
          const aTime = a.lastChatAt ? new Date(a.lastChatAt).getTime() : 0;
          const bTime = b.lastChatAt ? new Date(b.lastChatAt).getTime() : 0;
          return bTime - aTime;
        }
      }
    });
    return list;
  }, [personas, searchQuery, filterTab, sortBy]);

  if (loading) {
    return <PageLoader />;
  }

  const hasPersonas = personas && personas.length > 0;
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
              {analyzingCount} 个解析中
            </span>
          )}
          <div className="app-nav-actions">
            {user?.username && (
              <div className="app-nav-icon !bg-muted !cursor-default mr-0.5">
                <span className="text-[0.6875rem] font-semibold text-foreground">{user.username.charAt(0).toUpperCase()}</span>
              </div>
            )}
            {toggleTheme && (
              <button onClick={toggleTheme} className="app-nav-icon" title="切换主题" aria-label="切换主题">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
            <button onClick={() => navigate("/analytics")}
              className="app-nav-icon" title="数据看板" aria-label="数据看板">
              <Activity className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/diary")}
              className="app-nav-icon" title="对话日记" aria-label="对话日记">
              <BookOpen className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/settings")}
              className="app-nav-icon" title="设置" aria-label="设置">
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={() => { logout(); navigate(getLoginUrl()); }}
              className="app-nav-icon" title="退出登录" aria-label="退出登录">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-3xl flex-1">
        <HeroBanner username={user?.username} stats={stats} />

        {stats && (stats.totalPersonas > 0 || stats.totalChats > 0) && (
          <motion.div
            className="grid grid-cols-2 sm:grid-cols-4 mb-10 border-y border-border"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            {[
              { value: stats.totalPersonas as number, label: "数字分身" },
              { value: stats.totalChats as number, label: "总对话" },
              { value: stats.todayChats as number, label: "今日对话" },
              { value: readyCount as number, label: "在线分身" },
            ].map((s, i) => (
              <motion.div key={s.label} variants={fadeUp} className="stat-cell">
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
                  所有分身正在解析中，完成后即可开始对话
                </p>
              </div>
            )}
            <TodayRecommendation personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
            <DailyMessages personas={personas as any[]} />

            <div className="mb-12">
              <SectionHeading
                kicker="分身名录"
                title="我的分身"
                right={
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="relative">
                      <button onClick={() => setShowSort(!showSort)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowUpDown className="w-3 h-3" />
                        {SORT_OPTIONS.find(s => s.key === sortBy)?.label}
                      </button>
                      {showSort && (
                        <div className="absolute right-0 top-6 surface py-1 z-20 min-w-[110px]">
                          {SORT_OPTIONS.map(opt => (
                            <button key={opt.key} onClick={() => { setSortBy(opt.key); setShowSort(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${
                                sortBy === opt.key ? "text-cinnabar font-medium" : "text-muted-foreground"
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" onClick={() => setShowCreate(true)}
                      className="text-xs h-7 px-3">
                      <Plus className="w-3 h-3" /> 新建
                    </Button>
                  </div>
                }
              />

              {personas.length > 2 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                  <input
                    type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索分身..."
                    className="w-full h-10 pl-9 pr-4 text-sm bg-card border border-border rounded-md outline-none focus:border-foreground/40 placeholder:text-muted-foreground/40 transition-colors"
                  />
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
                        {tab.label} {count > 0 && <span className="ml-1 text-[10px] text-muted-foreground/60">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {filteredPersonas.map((p: any) => (
                  <PersonaCard key={p.id} persona={p}
                    onChat={() => navigate(`/chat/${p.id}`)}
                    onUpload={() => navigate(`/upload/${p.id}`)}
                    onEdit={() => navigate(`/persona/${p.id}/edit`)}
                    onDelete={() => setDeleteTarget(p)} />
                ))}
                {filteredPersonas.length === 0 && searchQuery && (
                  <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                    没有找到匹配的分身
                  </div>
                )}
                {filteredPersonas.length === 0 && !searchQuery && filterTab !== "all" && (
                  <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                    该分类下暂无分身
                  </div>
                )}
              </div>
            </div>

            <RecentActivity onNavigate={(id) => navigate(`/chat/${id}`)} />

            <section className="mt-4 pt-2">
              <SectionHeading kicker="书房" title="记录与天气" />
              <div className="grid sm:grid-cols-2 gap-x-10">
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
              <TipsSection />
            </section>
          </>
        ) : (
          <EmptyState onCreate={() => setShowCreate(true)} />
        )}
      </main>

      <footer className="border-t border-border py-6">
        <div className="container max-w-3xl mx-auto flex items-center justify-between text-xs text-muted-foreground/60">
          <Wordmark size="text-sm" />
          <span>让思念有回应</span>
        </div>
      </footer>

      <CreatePersonaDialog open={showCreate} onOpenChange={setShowCreate}
        onCreated={(id) => { refetch(); navigate(`/upload/${id}`); }} />

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-lg text-foreground">确认删除</DialogTitle></DialogHeader>
          <p className="text-muted-foreground text-sm py-2 leading-relaxed">
            确定要删除 <span className="text-foreground font-medium">{deleteTarget?.name}</span> 的数字分身吗？所有对话记录和上传文件都将被删除，且无法恢复。
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="rounded-md">取消</Button>
            <Button variant="destructive" className="rounded-md"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
