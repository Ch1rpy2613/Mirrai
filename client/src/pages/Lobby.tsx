import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Plus, MessageCircle, Upload, Trash2, Sparkles, Clock, LogOut,
  Settings, Leaf, Pencil, Users, CalendarDays, FileText,
  Wifi, Heart, Brain, Star, TrendingUp, Lightbulb,
  Zap, Coffee, Search, Quote, Flame, Gift,
  ArrowUpDown, Eye, Bookmark, Activity, Palette, Volume2, BookOpen,
  GraduationCap, Sunrise,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EMOTIONAL_STATES: Record<string, { label: string; emoji: string; color: string }> = {
  warm:      { label: "温柔", emoji: "🌸", color: "#D4956B" },
  playful:   { label: "俏皮", emoji: "😄", color: "#C4A840" },
  nostalgic: { label: "思念", emoji: "🌙", color: "#7B8EC4" },
  melancholy:{ label: "忧郁", emoji: "🌧️", color: "#8B7BC4" },
  happy:     { label: "开心", emoji: "✨", color: "#5A9E7F" },
  distant:   { label: "疏离", emoji: "❄️", color: "#8B8B8B" },
};

const STATUS_CONFIG: Record<string, { label: string; dotClass: string }> = {
  pending:   { label: "待上传", dotClass: "bg-amber-400" },
  analyzing: { label: "解析中", dotClass: "bg-blue-400 animate-pulse" },
  ready:     { label: "可对话", dotClass: "bg-emerald-500" },
  error:     { label: "解析失败", dotClass: "bg-red-400" },
};

const LOVE_LANG_ICONS: Record<string, string> = {
  "肯定的言辞": "💬", "精心时刻": "⏰", "接受礼物": "🎁",
  "服务的行动": "🤝", "身体接触": "🫂",
};

const ATTACHMENT_LABELS: Record<string, string> = {
  "安全型": "🛡️", "焦虑型": "💭", "回避型": "🌊", "混乱型": "🌀",
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
  { threshold: 1000, icon: "🏆", label: "千言万语" },
  { threshold: 500, icon: "💎", label: "深度连接" },
  { threshold: 100, icon: "🌟", label: "老朋友" },
  { threshold: 50, icon: "🔥", label: "热络" },
  { threshold: 10, icon: "🌱", label: "初识" },
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

const SEASONAL_PARTICLES: Record<string, string[]> = {
  spring: ["🌸", "🌷", "🦋", "🌿", "💐", "🐝"],
  summer: ["☀️", "🌻", "🍉", "🌊", "🐚", "🌴"],
  autumn: ["🍂", "🍁", "🎃", "🌾", "🍄", "🌰"],
  winter: ["❄️", "⛄", "🌨️", "🎄", "✨", "🕯️"],
};

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
  { id: "first_chat", icon: "💬", label: "初次对话", desc: "完成第一次对话", check: (s: any) => s.totalChats >= 1 },
  { id: "ten_chats", icon: "🗣️", label: "话匣子", desc: "累计 10 次对话", check: (s: any) => s.totalChats >= 10 },
  { id: "fifty_chats", icon: "📖", label: "故事集", desc: "累计 50 次对话", check: (s: any) => s.totalChats >= 50 },
  { id: "hundred_chats", icon: "📚", label: "长篇小说", desc: "累计 100 次对话", check: (s: any) => s.totalChats >= 100 },
  { id: "multi_persona", icon: "👥", label: "社交达人", desc: "创建 3 个以上分身", check: (s: any) => s.totalPersonas >= 3 },
  { id: "daily_active", icon: "🔥", label: "今日活跃", desc: "今天至少对话 5 次", check: (s: any) => s.todayChats >= 5 },
  { id: "veteran", icon: "🏅", label: "老用户", desc: "使用超过 30 天", check: (s: any) => s.memberDays >= 30 },
  { id: "collector", icon: "🎭", label: "收藏家", desc: "创建 5 个以上分身", check: (s: any) => s.totalPersonas >= 5 },
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

function getSeason(): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
}

function getGreeting(): { text: string; sub: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 6) return { text: "夜深了", sub: "还在想 TA 吗", emoji: "🌙" };
  if (h < 9) return { text: "早上好", sub: "新的一天，TA 在等你", emoji: "🌅" };
  if (h < 12) return { text: "上午好", sub: "今天也要开心哦", emoji: "☀️" };
  if (h < 14) return { text: "中午好", sub: "吃饭了吗", emoji: "🍵" };
  if (h < 18) return { text: "下午好", sub: "TA 一直都在这里", emoji: "🌤️" };
  if (h < 22) return { text: "晚上好", sub: "今天过得怎么样", emoji: "🌆" };
  return { text: "夜深了", sub: "还在想 TA 吗", emoji: "🌙" };
}

function generateAvatar(name: string): string {
  const colors = [
    ["#7CB69D", "#5A9E7F"], ["#D4A574", "#C08B5C"],
    ["#8BAEC4", "#6B96B0"], ["#C4A0C4", "#A882A8"],
    ["#A8C490", "#8FB076"], ["#D4B896", "#C0A07E"],
  ];
  const idx = name.charCodeAt(0) % colors.length;
  const [c1, c2] = colors[idx];
  const char = name.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient></defs>
    <rect width="80" height="80" rx="20" fill="url(#g)"/>
    <text x="40" y="52" font-family="sans-serif" font-size="32" font-weight="600" fill="white" text-anchor="middle">${char}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
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

// ─── FLOATING PARTICLES (SEASONAL) ──────────────────────────────────────────

function FloatingParticles() {
  const season = getSeason();
  const particles = SEASONAL_PARTICLES[season];
  return (
    <div className="lobby-particles" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className="lobby-particle" style={{
          left: `${8 + i * 12}%`,
          animationDelay: `${i * 1.1}s`,
          animationDuration: `${5 + i * 1.3}s`,
          fontSize: `${10 + (i % 3) * 4}px`,
          opacity: 0.12 + (i % 3) * 0.04,
        }}>
          {particles[i % particles.length]}
        </span>
      ))}
    </div>
  );
}

// ─── HERO BANNER ─────────────────────────────────────────────────────────────

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
    <div className="lobby-hero rounded-xl p-5 sm:p-6 mb-6 relative overflow-hidden">
      <div className="lobby-hero-dots" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">{greeting.emoji}</span>
          <h1 className="text-xl font-semibold text-foreground">
            {username ? `${username}，${greeting.text}` : greeting.text}
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">{greeting.sub}</p>

        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-card/60 border border-border/50 rounded-xl backdrop-blur-sm">
          <Quote className="w-3.5 h-3.5 text-primary/40 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/80 italic leading-relaxed">{quote}</p>
        </div>

        {memberDays > 0 && (
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5 text-primary" />
              <span>已陪伴 <span className="text-foreground font-medium count-up">{animatedDays}</span> 天</span>
            </div>
            {stats && stats.totalChats > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageCircle className="w-3.5 h-3.5 text-primary" />
                <span>共 <span className="text-foreground font-medium count-up">{animatedChats}</span> 次对话</span>
              </div>
            )}
            {stats && stats.todayChats > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                <span>今日 <span className="text-foreground font-medium count-up">{animatedToday}</span> 条</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── STAT CARDS (ANIMATED) ───────────────────────────────────────────────────

function StatCard({ icon: Icon, value, label, accent }: {
  icon: any; value: string | number; label: string; accent?: boolean;
}) {
  const animated = useAnimatedCounter(typeof value === "number" ? value : 0);
  const display = typeof value === "number" ? animated : value;
  return (
    <div className={`warm-card p-4 flex items-center gap-3 ${accent ? "ring-1 ring-primary/20" : ""}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${accent ? "bg-primary/15" : "bg-primary/10"}`}>
        <Icon className={`w-4 h-4 ${accent ? "text-primary" : "text-primary/70"}`} />
      </div>
      <div>
        <div className="text-lg font-semibold text-foreground leading-tight">{display}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
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
  const pd = (recommended.personaData as any) || {};
  const missLevel = getMissYouLevel(recommended.lastChatAt);

  return (
    <div className="mb-6 recommend-glow warm-card p-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full -translate-y-8 translate-x-8" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <Bookmark className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-medium text-foreground">今日推荐</h3>
          {missLevel && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
              {missLevel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="mood-ring-sm" style={{ "--mood-color": emotion.color } as any}>
            <img src={generateAvatar(recommended.name)} alt="" className="w-10 h-10 rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{recommended.name}</span>
              <span className="text-xs text-muted-foreground">{emotion.emoji} {emotion.label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {recommended.lastChatAt ? `上次对话 ${relativeTime(recommended.lastChatAt)}` : "还没有对话过"}
              {pd.summary && ` · ${(pd.summary as string).slice(0, 30)}`}
            </p>
          </div>
          <Button size="sm" onClick={() => onChat(recommended.id)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs h-8 px-3">
            <MessageCircle className="w-3 h-3 mr-1" /> 聊聊
          </Button>
        </div>
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
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="w-3.5 h-3.5 text-primary/60" />
        <h2 className="text-sm font-medium text-foreground">TA 想对你说</h2>
      </div>
      <div className="space-y-2">
        {messages.map((m, i) => {
          const emotion = EMOTIONAL_STATES[m.emotion] || EMOTIONAL_STATES.warm;
          return (
            <div key={i} className="flex items-start gap-3 px-4 py-3 bg-card/70 rounded-xl border border-border/60 animate-fade-in-up backdrop-blur-sm"
              style={{ animationDelay: `${i * 100}ms` }}>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotion.color } as any}>
                <img src={generateAvatar(m.name)} alt="" className="w-8 h-8 rounded-full" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground">{m.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{m.message}</p>
              </div>
              <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 mt-1">今天</span>
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
    <div className="warm-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Palette className="w-3.5 h-3.5 text-primary/60" />
        <h3 className="text-xs font-medium text-foreground">情感天气</h3>
      </div>
      <div className="flex items-end gap-2 h-12">
        {moodCounts.map(([state, count]) => {
          const e = EMOTIONAL_STATES[state] || EMOTIONAL_STATES.warm;
          const pct = Math.round((count / personas.length) * 100);
          return (
            <div key={state} className="flex flex-col items-center gap-1 flex-1">
              <div className="w-full rounded-t-md transition-all duration-500" style={{
                height: `${Math.max(8, pct * 0.4)}px`,
                backgroundColor: e.color,
                opacity: 0.6,
              }} />
              <span className="text-[9px] text-muted-foreground">{e.emoji}</span>
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

  return (
    <div className="mb-6 warm-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-primary/60" />
          <h3 className="text-xs font-medium text-foreground">对话热力图</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">近 30 天 · {totalMessages} 条</span>
      </div>
      <div className="flex gap-[3px] flex-wrap">
        {cells.map((cell) => {
          const intensity = cell.count === 0 ? 0 : Math.max(0.15, cell.count / maxCount);
          return (
            <div key={cell.date} className="heatmap-cell" title={cell.label}
              style={{
                width: "14px", height: "14px",
                backgroundColor: cell.count === 0
                  ? "oklch(0.94 0.008 80)"
                  : `oklch(0.52 ${0.10 * intensity} 155 / ${0.2 + intensity * 0.8})`,
              }} />
          );
        })}
      </div>
      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[9px] text-muted-foreground/50">少</span>
        {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
          <div key={i} className="heatmap-cell" style={{
            width: "10px", height: "10px",
            backgroundColor: v === 0
              ? "oklch(0.94 0.008 80)"
              : `oklch(0.52 ${0.10 * v} 155 / ${0.2 + v * 0.8})`,
          }} />
        ))}
        <span className="text-[9px] text-muted-foreground/50">多</span>
      </div>
    </div>
  );
}

// ─── TYPING INDICATOR ────────────────────────────────────────────────────────

function TypingIndicator({ personas }: { personas: any[] }) {
  const [visible, setVisible] = useState(false);
  const [personaIdx, setPersonaIdx] = useState(0);
  const ready = useMemo(() => personas.filter((p: any) => p.analysisStatus === "ready"), [personas]);

  useEffect(() => {
    if (ready.length === 0) return;
    const showTimer = setTimeout(() => {
      setPersonaIdx(Math.floor(Math.random() * ready.length));
      setVisible(true);
    }, 3000 + Math.random() * 5000);
    const hideTimer = setTimeout(() => setVisible(false), 8000 + Math.random() * 4000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, [ready.length]);

  if (!visible || ready.length === 0) return null;
  const p = ready[personaIdx % ready.length];
  const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 animate-fade-in">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-card/95 backdrop-blur-sm rounded-full border border-border shadow-lg">
        <div className="mood-ring-sm" style={{ "--mood-color": emotion.color } as any}>
          <img src={generateAvatar(p.name)} alt="" className="w-6 h-6 rounded-full" />
        </div>
        <span className="text-xs text-muted-foreground">{p.name} 正在想你</span>
        <span className="flex gap-0.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </span>
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
    <div className="mb-6 warm-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏆</span>
          <h3 className="text-xs font-medium text-foreground">成就徽章</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">{unlocked.length}/{ACHIEVEMENTS.length} 已解锁</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {unlocked.map((a, i) => (
          <div key={a.id} className="badge-unlock flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/5 border border-primary/15"
            style={{ animationDelay: `${i * 100}ms` }} title={a.desc}>
            <span className="text-sm">{a.icon}</span>
            <span className="text-[10px] font-medium text-primary/80">{a.label}</span>
          </div>
        ))}
        {locked.slice(0, 3).map(a => (
          <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-muted/40 border border-border/50 opacity-40"
            title={a.desc}>
            <span className="text-sm grayscale">🔒</span>
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
    <div className="mb-6 flex items-center justify-center gap-2 px-4 py-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
      <span className="text-lg fire-flicker">🔥</span>
      <span className="text-sm font-medium text-amber-700 dark:text-amber-300">连续对话 {streak} 天</span>
      <div className="flex gap-0.5 ml-1">
        {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
          <div key={i} className="w-1.5 h-3 rounded-full bg-orange-400" style={{ opacity: 0.3 + (i / 7) * 0.7 }} />
        ))}
      </div>
    </div>
  );
}

// ─── CONVERSATION STARTERS ───────────────────────────────────────────────────

function ConversationStarters({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const ready = personas.filter((p: any) => p.analysisStatus === "ready");
  const [starterIdx, setStarterIdx] = useState(() => Math.floor(Math.random() * CONVERSATION_STARTERS.length));

  if (ready.length === 0) return null;

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

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">💡</span>
          <h2 className="text-sm font-medium text-foreground">今日话题</h2>
        </div>
        <button onClick={() => setStarterIdx((starterIdx + 1) % CONVERSATION_STARTERS.length)}
          className="text-[10px] text-primary/60 hover:text-primary">换一批</button>
      </div>
      <div className="space-y-2">
        {starters.map((s, i) => (
          <button key={i} onClick={() => onChat(s.personaId)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-card/70 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-card transition-all text-left group">
            <img src={generateAvatar(s.personaName)} alt="" className="w-8 h-8 rounded-lg flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground leading-relaxed truncate">"{s.text}"</p>
              <span className="text-[10px] text-muted-foreground/50">问问 {s.personaName}</span>
            </div>
            <MessageCircle className="w-3.5 h-3.5 text-primary/30 group-hover:text-primary/60 transition-colors flex-shrink-0" />
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
    <div className="mb-6 warm-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">🌌</span>
        <h3 className="text-xs font-medium text-foreground">关系星图</h3>
      </div>
      <svg viewBox="0 0 280 180" className="w-full" style={{ maxHeight: "180px" }}>
        {nodes.map((n, i) =>
          nodes.slice(i + 1).map((m, j) => (
            <line key={`${i}-${j}`} x1={n.x} y1={n.y} x2={m.x} y2={m.y}
              stroke="oklch(0.52 0.10 155 / 0.12)" strokeWidth="1" className="constellation-line"
              style={{ animationDelay: `${(i + j) * 0.5}s` }} />
          ))
        )}
        <circle cx={cx} cy={cy} r="8" fill="oklch(0.52 0.10 155 / 0.15)" />
        <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="8" fill="oklch(0.52 0.10 155)" fontWeight="600">我</text>
        {nodes.map((n, i) => (
          <g key={n.id} onClick={() => onChat(n.id)} className="cursor-pointer">
            <line x1={cx} y1={cy} x2={n.x} y2={n.y}
              stroke={n.emotion.color} strokeWidth="1.5" opacity="0.3" />
            <circle cx={n.x} cy={n.y} r="16" fill="white" stroke={n.emotion.color} strokeWidth="2" opacity="0.9" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="12" fontWeight="600"
              fill={n.emotion.color}>{n.name.charAt(0)}</text>
            <text x={n.x} y={n.y + 28} textAnchor="middle" fontSize="8" fill="oklch(0.55 0.02 60)">
              {n.name.length > 4 ? n.name.slice(0, 4) : n.name}
            </text>
            <circle cx={n.x + 12} cy={n.y - 12} r="5" fill="white" stroke={n.emotion.color} strokeWidth="1" />
            <text x={n.x + 12} y={n.y - 9.5} textAnchor="middle" fontSize="6">{n.emotion.emoji}</text>
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
    <div className="mb-6 warm-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-3.5 h-3.5 text-primary/60" />
          <h3 className="text-xs font-medium text-foreground">回忆日历</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">{monthLabel} · {activeDays} 天有对话</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["日", "一", "二", "三", "四", "五", "六"].map(d => (
          <div key={d} className="text-center text-[9px] text-muted-foreground/50 py-0.5">{d}</div>
        ))}
        {days.map((d, i) => (
          <div key={i} className={`cal-cell aspect-square rounded-md flex items-center justify-center text-[10px] ${
            !d ? "" :
            d.today ? "bg-primary text-primary-foreground font-bold ring-2 ring-primary/30" :
            d.active ? "bg-primary/15 text-primary font-medium" :
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

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="mb-6 warm-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🏅</span>
        <h3 className="text-xs font-medium text-foreground">对话排行</h3>
      </div>
      <div className="space-y-2">
        {ranked.map((p: any, i: number) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const maxChats = ranked[0].chatCount || 1;
          const pct = Math.round(((p.chatCount || 0) / maxChats) * 100);
          return (
            <div key={p.id} className="flex items-center gap-3">
              <span className="text-sm w-5 text-center">{medals[i]}</span>
              <div className="mood-ring-sm flex-shrink-0" style={{ "--mood-color": emotion.color } as any}>
                <img src={generateAvatar(p.name)} alt="" className="w-7 h-7 rounded-full" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium text-foreground truncate">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.chatCount} 次</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: emotion.color, opacity: 0.6 }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RELATIONSHIP DEPTH RING ─────────────────────────────────────────────────

function DepthRing({ value, size = 32 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="depth-ring">
      <circle cx={size / 2} cy={size / 2} r={r} className="depth-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="depth-ring-fill"
        strokeDasharray={circumference} strokeDashoffset={offset} />
    </svg>
  );
}

// ─── FLOATING ACTION BUTTON ──────────────────────────────────────────────────

function FloatingActionButton({ onCreate, onNavigateSettings }: {
  onCreate: () => void; onNavigateSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2">
      {open && (
        <>
          <button onClick={() => { onCreate(); setOpen(false); }}
            className="fab-item flex items-center gap-2 px-4 py-2.5 bg-card rounded-xl border border-border shadow-lg hover:shadow-xl transition-shadow"
            style={{ animationDelay: "0ms" }}>
            <Plus className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium text-foreground">新建分身</span>
          </button>
          <button onClick={() => { onNavigateSettings(); setOpen(false); }}
            className="fab-item flex items-center gap-2 px-4 py-2.5 bg-card rounded-xl border border-border shadow-lg hover:shadow-xl transition-shadow"
            style={{ animationDelay: "50ms" }}>
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">设置</span>
          </button>
        </>
      )}
      <button onClick={() => setOpen(!open)}
        className={`w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl flex items-center justify-center transition-all ${open ? "rotate-45" : ""}`}>
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );
}

// ─── PERSONA CARD (ENHANCED) ─────────────────────────────────────────────────

function PersonaCard({ persona, onChat, onUpload, onEdit, onDelete }: {
  persona: any; onChat: () => void; onUpload: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const status = STATUS_CONFIG[persona.analysisStatus] || STATUS_CONFIG.pending;
  const emotion = EMOTIONAL_STATES[persona.emotionalState] || EMOTIONAL_STATES.warm;
  const avatar = generateAvatar(persona.name);
  const isAnalyzing = persona.analysisStatus === "analyzing";
  const isReady = persona.analysisStatus === "ready";
  const isGraduated = persona.graduationStatus === "graduated";
  const pd = (persona.personaData as any) || {};
  const togetherDays = persona.togetherFrom ? daysBetween(persona.togetherFrom, persona.togetherTo || undefined) : null;
  const traits = [pd.personality, pd.speakingStyle].filter(Boolean).join("，").slice(0, 50);
  const milestone = getMilestone(persona.chatCount || 0);
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
    <div className={`warm-card gradient-border-card p-5 animate-fade-in-up group relative ${isGraduated ? "opacity-70" : ""}`}>
      {isGraduated && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-500 font-medium z-10">
          <GraduationCap className="w-3 h-3" /> 休眠
        </div>
      )}

      {!isGraduated && milestone && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-300 font-medium z-10">
          <span>{milestone.icon}</span> {milestone.label}
        </div>
      )}

      {missLevel && (
        <div className="absolute -top-2 -left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-[10px] text-rose-500 font-medium z-10 animate-pulse-soft">
          💭 {missLevel}
        </div>
      )}

      {anniversary !== null && anniversary <= 30 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <Gift className="w-3.5 h-3.5 text-rose-400" />
          <span className="text-xs text-rose-600 dark:text-rose-300">
            {anniversary === 0 ? "今天是纪念日！🎉" : `距离纪念日还有 ${anniversary} 天`}
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <div className="mood-ring" style={{ "--mood-color": emotion.color } as any}>
            <img src={avatar} alt="" className="w-14 h-14 rounded-2xl" />
          </div>
          {isReady && (
            <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-card breathing-dot" />
          )}
          {persona.wechatBound && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center">
              <Wifi className="w-2.5 h-2.5 text-white" />
            </div>
          )}
          {compatibility !== null && (
            <div className="absolute -bottom-2 -left-2 z-10" title={`默契度 ${compatibility}%`}>
              <div className="relative">
                <DepthRing value={compatibility} size={28} />
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-primary"
                  style={{ transform: "rotate(90deg)" }}>{compatibility}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground truncate">{persona.name}</h3>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border state-bg-${persona.emotionalState || "warm"}`}>
              {emotion.emoji} {emotion.label}
            </span>
            {persona.intimacyLevel && persona.intimacyLevel !== "初识" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary" title={`亲密度 ${persona.intimacyScore || 0}`}>
                {persona.intimacyLevel}
              </span>
            )}
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
              <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium">
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
              <Heart className="w-3 h-3 text-rose-400" />
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

      {pd.summary && isReady && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Eye className="w-3 h-3 text-primary/40 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/70 line-clamp-1 italic">{pd.summary}</p>
        </div>
      )}

      {traits && isReady && !pd.summary && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Brain className="w-3 h-3 text-primary/50 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground/80 line-clamp-1">{traits}</p>
        </div>
      )}

      {catchphrases.length > 0 && isReady && (
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
          {catchphrases.slice(0, 3).map((phrase: string, i: number) => (
            <span key={i} className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-primary/5 text-primary/70 border border-primary/10 truncate max-w-[100px]">
              "{phrase}"
            </span>
          ))}
        </div>
      )}

      {(pd.loveLanguage || pd.attachmentStyle) && isReady && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {pd.attachmentStyle && ATTACHMENT_LABELS[pd.attachmentStyle] && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
              {ATTACHMENT_LABELS[pd.attachmentStyle]} {pd.attachmentStyle}
            </span>
          )}
          {pd.loveLanguage && LOVE_LANG_ICONS[pd.loveLanguage] && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
              {LOVE_LANG_ICONS[pd.loveLanguage]} {pd.loveLanguage}
            </span>
          )}
        </div>
      )}

      {isAnalyzing && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="shimmer-text">{getAnalysisStage(persona.analysisProgress || 0)}</span>
            <span>{persona.analysisProgress || 0}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/70 rounded-full transition-all duration-500"
              style={{ width: `${persona.analysisProgress || 0}%` }} />
          </div>
        </div>
      )}

      {persona.lastMessage && !isAnalyzing && (
        <div className="mt-3 px-3 py-2 bg-muted/30 rounded-xl">
          <p className="text-xs text-muted-foreground truncate">{persona.lastMessage.content}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{relativeTime(persona.lastMessage.createdAt)}</p>
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-3 border-t border-border">
        {isGraduated ? (
          <>
            <Button size="sm" className="flex-1 bg-violet-500 hover:bg-violet-600 text-white rounded-xl"
              onClick={() => awakenMutation.mutate({ id: persona.id })} disabled={awakenMutation.isPending}>
              <Sunrise className="w-3.5 h-3.5 mr-1.5" />{awakenMutation.isPending ? "唤醒中..." : "唤醒"}
            </Button>
            {persona.farewellLetter && (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl"
                onClick={() => setShowLetter(true)}>
                <BookOpen className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        ) : isReady ? (
          <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl" onClick={onChat}>
            <MessageCircle className="w-3.5 h-3.5 mr-1.5" />对话
          </Button>
        ) : (
          <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl" onClick={onUpload}>
            <Upload className="w-3.5 h-3.5 mr-1.5" />上传素材
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {showLetter && persona.farewellLetter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowLetter(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-violet-500" />
                <h3 className="font-medium text-foreground">{persona.name} 的告别信</h3>
              </div>
              <button onClick={() => setShowLetter(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="bg-muted/30 border border-border rounded-xl p-5">
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{persona.farewellLetter}</p>
              <p className="text-right text-muted-foreground text-xs mt-4">—— {persona.name}</p>
            </div>
            {persona.graduatedAt && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                毕业于 {new Date(persona.graduatedAt).toLocaleDateString("zh-CN")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── QUICK CHAT BAR ──────────────────────────────────────────────────────────

function QuickChatBar({ personas, onChat }: { personas: any[]; onChat: (id: number) => void }) {
  const readyPersonas = personas.filter((p: any) => p.analysisStatus === "ready");
  if (readyPersonas.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">继续对话</h2>
        <span className="text-xs text-muted-foreground">{readyPersonas.length} 个分身在线</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {readyPersonas.map((p: any) => {
          const emotion = EMOTIONAL_STATES[p.emotionalState] || EMOTIONAL_STATES.warm;
          const miss = getMissYouLevel(p.lastChatAt);
          return (
            <button key={p.id} onClick={() => onChat(p.id)}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 group relative">
              <div className="relative">
                <div className="mood-ring-sm" style={{ "--mood-color": emotion.color } as any}>
                  <img src={generateAvatar(p.name)} alt=""
                    className="w-12 h-12 rounded-full group-hover:scale-105 transition-transform" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 text-sm">{emotion.emoji}</span>
                {miss && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
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
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
        <h2 className="text-sm font-medium text-foreground">回忆碎片</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {highlights.map((h, i) => (
          <div key={i} className="warm-card p-3 flex-shrink-0 w-[220px]">
            <div className="flex items-center gap-1.5 mb-2">
              <img src={generateAvatar(h.name)} alt="" className="w-5 h-5 rounded-md" />
              <span className="text-[10px] font-medium text-foreground">{h.name}</span>
              <span className="text-[10px] text-muted-foreground/50">{h.type === "touching" ? "感动瞬间" : "共同回忆"}</span>
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
    <div className="mb-6">
      <h2 className="text-sm font-medium text-foreground mb-3">最近动态</h2>
      <div className="warm-card divide-y divide-border overflow-hidden">
        {activity.slice(0, 6).map((item: any, idx: number) => {
          const emotion = EMOTIONAL_STATES[item.emotionalState] || EMOTIONAL_STATES.warm;
          return (
            <button key={item.id} onClick={() => onNavigate(item.personaId)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              style={{ animationDelay: `${idx * 50}ms` }}>
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-full overflow-hidden">
                  <img src={generateAvatar(item.personaName)} alt="" className="w-full h-full" />
                </div>
                {item.role === "assistant" && (
                  <span className="absolute -bottom-0.5 -right-0.5 text-[8px]">{emotion.emoji}</span>
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
              <span className="text-[10px] text-muted-foreground/40 flex-shrink-0">{relativeTime(item.createdAt)}</span>
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
    <div className="mb-6 warm-card p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-amber-600" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium text-foreground/80 mb-0.5">小贴士</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{tip.text}</p>
      </div>
      <button onClick={() => setTipIdx((tipIdx + 1) % TIPS.length)}
        className="text-[10px] text-primary/60 hover:text-primary flex-shrink-0 mt-1">换一条</button>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const quote = useMemo(() => LOVE_QUOTES[Math.floor(Math.random() * LOVE_QUOTES.length)], []);
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-primary animate-float" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center animate-float" style={{ animationDelay: "0.5s" }}>
          <Heart className="w-4 h-4 text-rose-400" />
        </div>
        <div className="absolute -bottom-1 -left-3 w-7 h-7 rounded-full bg-sky-500/10 flex items-center justify-center animate-float" style={{ animationDelay: "1s" }}>
          <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
        </div>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">创建你的第一个数字分身</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        上传聊天记录，AI 会学习 TA 的说话方式和性格，让 TA 在这里陪伴你
      </p>
      <p className="text-xs text-muted-foreground/60 italic mb-8 max-w-[260px]">"{quote}"</p>
      <div className="flex items-center gap-3 mb-8 text-muted-foreground">
        {[
          { icon: Plus, label: "创建分身", num: "1" },
          { icon: Upload, label: "上传素材", num: "2" },
          { icon: Brain, label: "AI 解析", num: "3" },
          { icon: MessageCircle, label: "开始对话", num: "4" },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            {i > 0 && <div className="w-6 h-px bg-border" />}
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
                  <step.icon className="w-4 h-4" />
                </div>
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-medium">
                  {step.num}
                </span>
              </div>
              <span className="text-[10px]">{step.label}</span>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={onCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-6">
        <Plus className="w-4 h-4 mr-2" /> 创建数字分身
      </Button>
    </div>
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
      <DialogContent className="bg-card border-border rounded-2xl max-w-md">
        <DialogHeader><DialogTitle className="text-foreground">创建数字分身</DialogTitle></DialogHeader>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl">取消</Button>
          <Button onClick={() => { if (!name.trim()) return; createMutation.mutate({ name: name.trim(), relationshipDesc: relationshipDesc.trim() || undefined, togetherSince: togetherSince || undefined, endDate: showEndDate && endDate ? endDate : undefined } as any); }}
            disabled={!name.trim() || createMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
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
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse-soft">
          <Leaf className="w-4 h-4 text-primary" />
        </div>
      </div>
    );
  }

  const hasPersonas = personas && personas.length > 0;
  const readyCount = personas?.filter((p: any) => p.analysisStatus === "ready").length || 0;
  const analyzingCount = personas?.filter((p: any) => p.analysisStatus === "analyzing").length || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      <div className="gradient-mesh-bg" />
      <FloatingParticles />

      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <div className="app-nav-brand">
            <div className="app-nav-mark">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <span className="app-nav-title tracking-tight">Presence</span>
          </div>
          <div className="app-nav-spacer" />
          {analyzingCount > 0 && (
            <span className="text-xs text-primary mr-3 hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {analyzingCount} 个解析中
            </span>
          )}
          <div className="app-nav-actions">
            {user?.username && (
              <div className="app-nav-icon !bg-primary/8 !border-primary/12 !cursor-default mr-0.5">
                <span className="text-[0.6875rem] font-semibold text-primary">{user.username.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <button onClick={() => navigate("/analytics")}
              className="app-nav-icon" title="数据看板">
              <Activity className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/diary")}
              className="app-nav-icon" title="对话日记">
              <BookOpen className="w-4 h-4" />
            </button>
            <button onClick={() => navigate("/settings")}
              className="app-nav-icon" title="设置">
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={() => { logout(); navigate(getLoginUrl()); }}
              className="app-nav-icon" title="退出登录">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="container py-6 max-w-3xl mx-auto flex-1 relative z-10">
        <HeroBanner username={user?.username} stats={stats} />

        {stats && (stats.totalPersonas > 0 || stats.totalChats > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard icon={Users} value={stats.totalPersonas} label="数字分身" />
            <StatCard icon={MessageCircle} value={stats.totalChats} label="总对话" accent={stats.totalChats > 0} />
            <StatCard icon={TrendingUp} value={stats.todayChats} label="今日对话" accent={stats.todayChats > 0} />
            <StatCard icon={Star} value={readyCount} label="在线分身" />
          </div>
        )}

        {hasPersonas ? (
          <>
            <ChatStreak />
            <TodayRecommendation personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
            <DailyMessages personas={personas as any[]} />
            <EmotionalWeather personas={personas as any[]} />
            <QuickChatBar personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
            <PersonaConstellation personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
            <ConversationStarters personas={personas as any[]} onChat={(id) => navigate(`/chat/${id}`)} />
            <ActivityHeatmap />
            <MiniCalendar />
            <MemoryHighlights personas={personas as any[]} />
            <AchievementBadges stats={stats} />

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-foreground">我的分身</h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button onClick={() => setShowSort(!showSort)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <ArrowUpDown className="w-3 h-3" />
                      {SORT_OPTIONS.find(s => s.key === sortBy)?.label}
                    </button>
                    {showSort && (
                      <div className="absolute right-0 top-6 bg-card border border-border rounded-xl shadow-lg py-1 z-20 min-w-[100px]">
                        {SORT_OPTIONS.map(opt => (
                          <button key={opt.key} onClick={() => { setSortBy(opt.key); setShowSort(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${
                              sortBy === opt.key ? "text-primary font-medium" : "text-muted-foreground"
                            }`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreate(true)}
                    className="text-xs text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl h-7 px-2">
                    <Plus className="w-3 h-3 mr-1" /> 新建
                  </Button>
                </div>
              </div>

              {personas.length > 2 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                  <input
                    type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索分身..."
                    className="w-full h-9 pl-9 pr-3 text-sm bg-muted/30 border border-border rounded-xl outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/40"
                  />
                </div>
              )}

              {personas.length > 2 && (
                <div className="flex gap-1.5 mb-4">
                  {FILTER_TABS.map(tab => {
                    const count = tab.key === "all" ? personas.length : personas.filter((p: any) => p.analysisStatus === tab.key).length;
                    if (tab.key !== "all" && count === 0) return null;
                    return (
                      <button key={tab.key} onClick={() => setFilterTab(tab.key)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          filterTab === tab.key
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:bg-muted/50"
                        }`}>
                        {tab.label} {count > 0 && <span className="ml-1 text-[10px] opacity-60">{count}</span>}
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
                  <div className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                    没有找到匹配的分身
                  </div>
                )}
              </div>
            </div>

            <RecentActivity onNavigate={(id) => navigate(`/chat/${id}`)} />
            <PersonaLeaderboard personas={personas as any[]} />
            <TipsSection />
          </>
        ) : (
          <EmptyState onCreate={() => setShowCreate(true)} />
        )}
      </main>

      <footer className="border-t border-border/40 py-6 relative z-10">
        <div className="container max-w-3xl mx-auto flex items-center justify-between text-xs text-muted-foreground/40">
          <div className="flex items-center gap-1.5">
            <Leaf className="w-3 h-3" />
            <span>Presence</span>
          </div>
          <span>让思念有回应</span>
        </div>
      </footer>

      {hasPersonas && <TypingIndicator personas={personas as any[]} />}
      {hasPersonas && <FloatingActionButton onCreate={() => setShowCreate(true)} onNavigateSettings={() => navigate("/settings")} />}

      <CreatePersonaDialog open={showCreate} onOpenChange={setShowCreate}
        onCreated={(id) => { refetch(); navigate(`/upload/${id}`); }} />

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">确认删除</DialogTitle></DialogHeader>
          <p className="text-muted-foreground text-sm py-2">
            确定要删除 <span className="text-foreground font-medium">{deleteTarget?.name}</span> 的数字分身吗？所有对话记录和上传文件都将被删除，且无法恢复。
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="rounded-xl">取消</Button>
            <Button variant="destructive" className="rounded-xl"
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
