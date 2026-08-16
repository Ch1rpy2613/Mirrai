import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ArrowLeft } from "lucide-react";
import {
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

/* 情绪色：取自设计系统 mood tokens，与日记页的情绪 chip 呼应 */
const EMOTION_COLORS: Record<string, string> = {
  warm: "var(--color-mood-warm)", playful: "var(--color-mood-playful)", nostalgic: "var(--color-mood-nostalgic)",
  melancholy: "var(--color-mood-melancholy)", happy: "var(--color-mood-happy)", distant: "var(--color-mood-distant)",
};
const EMOTION_LABELS: Record<string, string> = {
  warm: "温柔", playful: "俏皮", nostalgic: "思念", melancholy: "忧郁", happy: "开心", distant: "疏离",
};

const TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--color-foreground)",
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
            className="app-nav-back -ml-1" aria-label="返回">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-title-group">
            <div>
              <h1 className="app-nav-title">数据看板</h1>
              <p className="app-nav-subtitle">消息与情绪统计</p>
            </div>
          </div>
          <div className="app-nav-spacer" />
          <div className="flex gap-1 border-b border-border">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`text-xs px-3 py-2 -mb-px border-b-2 transition-colors ${days === d ? "border-cinnabar text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {d}天
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container page-main max-w-4xl space-y-6">
        <motion.div initial="hidden" animate="visible" variants={fadeUp}>
          <p className="kicker kicker-accent mb-3">回看</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">数据看板</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            消息、情绪与陪伴的痕迹，安静地记在这里。
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <StatCard label="总消息" value={stats.totalMessages} />
          <StatCard label="活跃天数" value={stats.activeDays} />
          <StatCard label="最长连续" value={`${stats.longestStreak}天`} />
          <StatCard label="日均消息" value={stats.avgPerDay} />
        </motion.div>

        <ChartCard title="每日消息量">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.messageVolume || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="count" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid md:grid-cols-2 gap-6">
          <ChartCard title="情绪分布趋势">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={emotionChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  {Object.keys(EMOTION_COLORS).map(key => (
                    <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={EMOTION_COLORS[key]} fill={EMOTION_COLORS[key]} fillOpacity={0.12} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-border/50">
              {Object.entries(EMOTION_LABELS).map(([key, label]) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5" style={{ background: EMOTION_COLORS[key] }} />
                  {label}
                </span>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="聊天时段分布">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={hourlyData.filter((_, i) => i % 2 === 0)}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="var(--color-muted-foreground)" />
                  <Radar dataKey="count" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <ChartCard title="分身互动排名">
          {(data?.personaEngagement || []).length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">暂无数据</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.personaEngagement || []).map((p: any, i: number) => {
                const max = Math.max(...(data?.personaEngagement || []).map((x: any) => Number(x.messageCount)));
                const pct = max > 0 ? (Number(p.messageCount) / max) * 100 : 0;
                return (
                  <div key={p.personaId} className="flex items-center gap-3">
                    <span className="font-display text-sm font-semibold text-muted-foreground w-4">{i + 1}</span>
                    <span className="text-sm text-foreground w-20 truncate">{p.name}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="progress-bar h-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">{p.messageCount}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
      </main>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={fadeUp}
      className="surface p-5 sm:p-6"
    >
      <h2 className="font-display text-lg font-semibold text-foreground mb-5">{title}</h2>
      {children}
    </motion.section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <motion.div variants={fadeUp} className="surface p-4 sm:p-5">
      <p className="font-display text-2xl sm:text-3xl font-semibold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-2">{label}</p>
    </motion.div>
  );
}
