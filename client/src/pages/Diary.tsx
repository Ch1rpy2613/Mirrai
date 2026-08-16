import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, ChevronLeft, ChevronRight, PenLine, Trash2, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const MOOD_LABELS: Record<string, string> = {
  warm: "温柔", playful: "俏皮", nostalgic: "思念", melancholy: "忧郁", happy: "开心", distant: "疏离",
};

/* 静态类名映射：Tailwind 需在源码中看到完整类名才会生成对应样式 */
const MOOD_CHIP: Record<string, string> = {
  warm: "bg-mood-warm/10 text-mood-warm border-mood-warm/25",
  playful: "bg-mood-playful/10 text-mood-playful border-mood-playful/25",
  nostalgic: "bg-mood-nostalgic/10 text-mood-nostalgic border-mood-nostalgic/25",
  melancholy: "bg-mood-melancholy/10 text-mood-melancholy border-mood-melancholy/25",
  happy: "bg-mood-happy/10 text-mood-happy border-mood-happy/25",
  distant: "bg-mood-distant/10 text-mood-distant border-mood-distant/25",
};

function formatMonth(year: number, month: number) {
  return `${year}年${month + 1}月`;
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${y}年${m}月${d}日`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function MoodChip({ mood, small }: { mood: string; small?: boolean }) {
  const cls = MOOD_CHIP[mood] ?? "bg-muted/60 text-muted-foreground border-border/60";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${small ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs"} ${cls}`}>
      <span className="w-1 h-1 bg-current" />
      {MOOD_LABELS[mood] ?? mood}
    </span>
  );
}

function DiaryCard({ entry, onDelete }: { entry: any; onDelete: (id: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const arcs: string[] = Array.isArray(entry.emotionalArc) ? entry.emotionalArc.map(String) : [];
  const highlights: string[] = Array.isArray(entry.highlights) ? entry.highlights.map(String) : [];
  const quotes: string[] = Array.isArray(entry.quotes) ? entry.quotes.map(String) : [];

  return (
    <article className="surface p-6 sm:p-7 space-y-5 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="w-3.5 h-3.5" />
          {entry.messageCount} 条消息
        </span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">删除这篇日记？</span>
            <button onClick={() => onDelete(entry.id)}
              className="text-xs px-2.5 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/25 hover:bg-destructive/15 transition-colors">
              删除
            </button>
            <button onClick={() => setConfirming(false)}
              className="text-xs px-2.5 py-1 rounded-md text-muted-foreground border border-border/60 hover:text-foreground transition-colors">
              取消
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} aria-label="删除日记"
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="letter-prose text-[0.9375rem] sm:text-base text-foreground/90">{entry.summary}</p>

      {arcs.length > 0 && (
        <div>
          <p className="kicker mb-2.5">情绪弧线</p>
          <div className="flex gap-1.5 flex-wrap">
            {arcs.map((e, i) => <MoodChip key={i} mood={e} />)}
          </div>
        </div>
      )}
      {highlights.length > 0 && (
        <div>
          <p className="kicker mb-2.5">亮点</p>
          <ul className="space-y-1.5">
            {highlights.map((h, i) => (
              <li key={i} className="text-sm text-foreground/80 flex items-start gap-2 leading-relaxed">
                <span className="w-1 h-1 bg-cinnabar mt-[0.55rem] flex-shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {quotes.length > 0 && (
        <div>
          <p className="kicker mb-2.5">金句</p>
          <div className="space-y-2.5">
            {quotes.map((q, i) => (
              <p key={i} className="letter-prose text-[0.9375rem] text-foreground/80 border-l-2 border-cinnabar/50 pl-4">"{q}"</p>
            ))}
          </div>
        </div>
      )}
      {entry.reflection && (
        <div>
          <p className="kicker mb-2.5">反思</p>
          <p className="letter-prose text-sm text-foreground/80">{entry.reflection}</p>
        </div>
      )}
    </article>
  );
}

export default function Diary() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(null);

  const { data: personas } = trpc.persona.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: diaryDates, refetch: refetchDates } = trpc.diary.getDates.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: entries, refetch: refetchEntries } = trpc.diary.list.useQuery(
    { personaId: selectedPersonaId || 0 },
    { enabled: isAuthenticated && !!selectedPersonaId }
  );
  const { data: dayEntry } = trpc.diary.getByDate.useQuery(
    { personaId: selectedPersonaId || 0, date: selectedDate || "" },
    { enabled: isAuthenticated && !!selectedPersonaId && !!selectedDate }
  );

  const generateMutation = trpc.diary.generate.useMutation({
    onSuccess: () => { toast.success("日记生成成功"); refetchDates(); refetchEntries(); },
    onError: (e: any) => toast.error("生成失败：" + e.message),
  });

  const deleteMutation = trpc.diary.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); setSelectedDate(null); refetchDates(); refetchEntries(); },
    onError: (e: any) => toast.error(e.message),
  });

  const datesSet = new Set((diaryDates || []).map((d: any) => d.date));
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const handleGenerate = async (date: string) => {
    if (!selectedPersonaId) return;
    setGenerating(true);
    try {
      await generateMutation.mutateAsync({ personaId: selectedPersonaId, date });
      setSelectedDate(date);
    } finally { setGenerating(false); }
  };

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav max-w-2xl">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1" aria-label="返回">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <div>
              <h1 className="app-nav-title">对话日记</h1>
              <p className="app-nav-subtitle">每日回顾</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
        </div>
      </header>

      <main className="flex-1 container max-w-2xl page-main space-y-6">
        <motion.div variants={fadeUp} initial="hidden" animate="visible">
          <p className="kicker kicker-accent mb-3">每日回顾</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">对话日记</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            把一天的对话收成一封信，留给以后的自己。
          </p>
        </motion.div>

        {/* Persona selector */}
        <motion.div variants={fadeUp} initial="hidden" animate="visible" className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide">
          {(personas || []).map((p: any) => (
            <button key={p.id} onClick={() => { setSelectedPersonaId(p.id); setSelectedDate(null); }}
              className={`flex-shrink-0 px-3 sm:px-4 py-2.5 -mb-px text-sm border-b-2 transition-colors ${selectedPersonaId === p.id ? "border-cinnabar text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {p.name}
            </button>
          ))}
        </motion.div>

        {!selectedPersonaId && (
          <motion.div variants={fadeUp} initial="hidden" animate="visible" className="surface p-10 sm:p-14 text-center">
            <p className="kicker kicker-accent mb-3">尚未开卷</p>
            <p className="font-display text-lg font-semibold text-foreground">
              {(personas || []).length === 0 ? "还没有分身，先去大厅创建一位" : "选择一个分身查看日记"}
            </p>
            {(personas || []).length === 0 && (
              <Button className="mt-6" onClick={() => navigate("/")}>回到大厅</Button>
            )}
          </motion.div>
        )}

        {selectedPersonaId && (
          <>
            {/* Calendar */}
            <motion.section variants={fadeUp} initial="hidden" animate="visible" className="surface p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="app-nav-icon" aria-label="上个月">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-display text-base font-semibold text-foreground">{formatMonth(year, month)}</span>
                <button onClick={nextMonth} className="app-nav-icon" aria-label="下个月">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
                {["日", "一", "二", "三", "四", "五", "六"].map(d => <div key={d}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const hasDiary = datesSet.has(dateStr);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  return (
                    <button key={day} onClick={() => setSelectedDate(dateStr)}
                      className={`cal-cell relative aspect-square flex items-center justify-center rounded-md text-sm
                        ${isSelected ? "bg-primary text-primary-foreground font-semibold" : isToday ? "border border-foreground/40 font-medium text-foreground" : "text-foreground/80 hover:bg-muted"}`}>
                      {day}
                      {hasDiary && <span className={`absolute bottom-1 w-1 h-1 ${isSelected ? "bg-primary-foreground" : "bg-cinnabar"}`} />}
                    </button>
                  );
                })}
              </div>
            </motion.section>

            {/* Selected date content */}
            {selectedDate && (
              <motion.section
                key={selectedDate}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="space-y-4"
              >
                <div className="flex items-end justify-between gap-3">
                  <h2 className="font-display text-2xl font-semibold text-foreground">{formatDate(selectedDate)}</h2>
                  {!dayEntry && (
                    <Button size="sm" onClick={() => handleGenerate(selectedDate)} disabled={generating}
                      className="gap-1.5">
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
                      写下这一天
                    </Button>
                  )}
                </div>
                {dayEntry && (
                  <DiaryCard entry={dayEntry} onDelete={(id) => deleteMutation.mutate({ id })} />
                )}
              </motion.section>
            )}

            {/* Recent entries list */}
            {!selectedDate && entries && entries.length > 0 && (
              <motion.section variants={fadeUp} initial="hidden" animate="visible" className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold text-foreground">最近日记</h2>
                  <span className="kicker">近期</span>
                </div>
                {entries.map((entry: any) => (
                  <button key={entry.id} onClick={() => setSelectedDate(entry.date)}
                    className="surface surface-interactive w-full text-left p-5">
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="font-display text-base font-semibold text-foreground">{entry.date}</span>
                      <span className="text-xs text-muted-foreground">{entry.personaName || ""}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{entry.summary}</p>
                    {Array.isArray(entry.emotionalArc) && entry.emotionalArc.length > 0 && (
                      <div className="flex gap-1.5 mt-3 flex-wrap">
                        {entry.emotionalArc.slice(0, 5).map((e: unknown, i: number) => (
                          <MoodChip key={i} mood={String(e)} small />
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </motion.section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
