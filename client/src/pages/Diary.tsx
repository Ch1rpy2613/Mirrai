import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Sparkles, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const EMOTION_EMOJI: Record<string, string> = {
  warm: "🌸", playful: "😄", nostalgic: "🌙", melancholy: "🌧️", happy: "✨", distant: "❄️",
};

function formatMonth(year: number, month: number) {
  return `${year}年${month + 1}月`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function DiaryCard({ entry, onDelete }: { entry: any; onDelete: (id: number) => void }) {
  const arcs: string[] = Array.isArray(entry.emotionalArc) ? entry.emotionalArc.map(String) : [];
  const highlights: string[] = Array.isArray(entry.highlights) ? entry.highlights.map(String) : [];
  const quotes: string[] = Array.isArray(entry.quotes) ? entry.quotes.map(String) : [];

  return (
    <div className="bg-card/90 border border-border rounded-xl p-5 space-y-4 animate-fade-in shadow-xs">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm leading-relaxed text-foreground">{entry.summary}</p>
          <p className="text-xs text-muted-foreground mt-1">{entry.messageCount} 条消息</p>
        </div>
        <button onClick={() => onDelete(entry.id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-1">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {arcs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">情绪弧线</p>
          <div className="flex gap-1.5 flex-wrap">
            {arcs.map((e, i) => (
              <span key={i} className="text-lg" title={e}>{EMOTION_EMOJI[e] || e}</span>
            ))}
          </div>
        </div>
      )}
      {highlights.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">亮点</p>
          <ul className="space-y-1">
            {highlights.map((h, i) => (
              <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>{h}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quotes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">金句</p>
          <div className="space-y-1.5">
            {quotes.map((q, i) => (
              <p key={i} className="text-sm italic text-foreground/70 border-l-2 border-primary/30 pl-3">"{q}"</p>
            ))}
          </div>
        </div>
      )}
      {entry.reflection && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">反思</p>
          <p className="text-sm text-foreground/80 leading-relaxed">{entry.reflection}</p>
        </div>
      )}
    </div>
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
      <header className="sticky top-0 z-30 app-header">
        <div className="container app-nav max-w-2xl">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <div>
              <h1 className="app-nav-title">对话日记</h1>
              <p className="app-nav-subtitle">回顾每天的对话</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
        </div>
      </header>

      <main className="flex-1 container max-w-2xl mx-auto py-6 px-4 space-y-6">
        {/* Persona selector */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {(personas || []).map((p: any) => (
            <button key={p.id} onClick={() => { setSelectedPersonaId(p.id); setSelectedDate(null); }}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-all ${selectedPersonaId === p.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
              {p.name}
            </button>
          ))}
        </div>

        {!selectedPersonaId && (
          <div className="text-center py-20 text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>选择一个分身查看日记</p>
          </div>
        )}

        {selectedPersonaId && (
          <>
            {/* Calendar */}
            <div className="bg-card/90 border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold">{formatMonth(year, month)}</span>
                <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
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
                      className={`relative aspect-square flex items-center justify-center rounded-lg text-sm transition-all
                        ${isSelected ? "bg-primary text-primary-foreground font-semibold" : isToday ? "ring-1 ring-primary/40 font-medium" : "hover:bg-muted"}`}>
                      {day}
                      {hasDiary && <span className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected date content */}
            {selectedDate && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{selectedDate}</h2>
                  {!dayEntry && (
                    <Button size="sm" onClick={() => handleGenerate(selectedDate)} disabled={generating}
                      className="rounded-full gap-1.5">
                      {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      生成日记
                    </Button>
                  )}
                </div>
                {dayEntry && (
                  <DiaryCard entry={dayEntry} onDelete={(id) => deleteMutation.mutate({ id })} />
                )}
              </div>
            )}

            {/* Recent entries list */}
            {!selectedDate && entries && entries.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">最近日记</h2>
                {entries.map((entry: any) => (
                  <button key={entry.id} onClick={() => setSelectedDate(entry.date)}
                    className="w-full text-left bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{entry.date}</span>
                      <span className="text-xs text-muted-foreground">{entry.personaName || ""}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{entry.summary}</p>
                    {Array.isArray(entry.emotionalArc) && entry.emotionalArc.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {entry.emotionalArc.slice(0, 5).map((e: unknown, i: number) => (
                          <span key={i} className="text-sm">{EMOTION_EMOJI[String(e)] || String(e)}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
