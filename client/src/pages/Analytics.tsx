import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft, MessageCircle, Calendar, Flame, TrendingUp } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const EMOTION_COLORS: Record<string, string> = {
  warm: "var(--color-chart-1)", playful: "var(--color-chart-2)", nostalgic: "var(--color-chart-3)",
  melancholy: "var(--color-muted-foreground)", happy: "var(--color-chart-5)", distant: "var(--color-chart-4)",
};
const EMOTION_LABELS: Record<string, string> = {
  warm: "温柔", playful: "俏皮", nostalgic: "思念", melancholy: "忧郁", happy: "开心", distant: "疏离",
};

export default function Analytics() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [days, setDays] = useState(30);

  const { data } = trpc.analytics.overview.useQuery({ days }, { enabled: isAuthenticated });

  const stats = data?.stats || { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };

  const emotionByDate: Record<string, any> = {};
  (data?.emotionTimeline || []).forEach((r: any) => {
    if (!emotionByDate[r.date]) emotionByDate[r.date] = { date: r.date };
    emotionByDate[r.date][r.emotionalState] = Number(r.count);
  });
  const emotionChartData = Object.values(emotionByDate);

  const hourlyData = Array.from({ length: 24 }, (_, h) => {
    const found = (data?.hourlyDistribution || []).find((r: any) => r.hour === h);
    return { hour: `${h}:00`, count: found ? Number(found.count) : 0 };
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <h1 className="app-nav-title">数据看板</h1>
          </div>
          <div className="app-nav-spacer" />
          <div className="flex bg-muted/70 border border-border/60 rounded-lg p-0.5">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${days === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {d}天
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="container py-6 max-w-4xl mx-auto space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<MessageCircle className="w-4 h-4" />} label="总消息" value={stats.totalMessages} />
          <StatCard icon={<Calendar className="w-4 h-4" />} label="活跃天数" value={stats.activeDays} />
          <StatCard icon={<Flame className="w-4 h-4" />} label="最长连续" value={`${stats.longestStreak}天`} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="日均消息" value={stats.avgPerDay} />
        </div>

        <div className="warm-card p-4">
          <p className="text-sm font-medium text-foreground mb-3">每日消息量</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.messageVolume || []}>
                <defs>
                  <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="count" stroke="var(--color-chart-1)" fill="url(#msgGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="warm-card p-4">
            <p className="text-sm font-medium text-foreground mb-3">情绪分布趋势</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={emotionChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  {Object.keys(EMOTION_COLORS).map(key => (
                    <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={EMOTION_COLORS[key]} fill={EMOTION_COLORS[key]} fillOpacity={0.4} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="warm-card p-4">
            <p className="text-sm font-medium text-foreground mb-3">聊天时段分布</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={hourlyData.filter((_, i) => i % 2 === 0)}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="var(--color-muted-foreground)" />
                  <Radar dataKey="count" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="warm-card p-4">
          <p className="text-sm font-medium text-foreground mb-3">Persona 互动排名</p>
          {(data?.personaEngagement || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {(data?.personaEngagement || []).map((p: any, i: number) => {
                const max = Math.max(...(data?.personaEngagement || []).map((x: any) => Number(x.messageCount)));
                const pct = max > 0 ? (Number(p.messageCount) / max) * 100 : 0;
                return (
                  <div key={p.personaId} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <span className="text-sm text-foreground w-20 truncate">{p.name}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right">{p.messageCount}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="warm-card p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
