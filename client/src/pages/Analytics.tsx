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
import { useLocale } from "@/contexts/LocaleContext";
import { EMOTIONS, EMOTION_KEYS, emotionColor } from "@/lib/emotions";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const TOOLTIP_STYLE = {
  background: "var(--color-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-foreground)",
  boxShadow: "var(--shadow-pop)",
};

export default function Analytics() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();
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
            className="app-nav-back -ml-1" aria-label={t("analytics.back")}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="app-nav-spacer" />
          <div className="flex gap-1 border-b border-border">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`text-xs px-3 py-2 -mb-px border-b-2 transition-colors ${days === d ? "border-cinnabar text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t("analytics.days", { count: d })}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container page-main max-w-4xl space-y-6">
        <motion.div initial="hidden" animate="visible" variants={fadeUp}>
          <p className="kicker kicker-accent mb-3">{t("analytics.kicker")}</p>
          <h1 className="page-title">{t("analytics.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            {t("analytics.intro")}
          </p>
        </motion.div>

        <motion.div
          className="stat-grid grid-cols-2 md:grid-cols-4"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <StatCard label={t("analytics.totalMessages")} value={stats.totalMessages} />
          <StatCard label={t("analytics.activeDays")} value={stats.activeDays} />
          <StatCard label={t("analytics.longestStreak")} value={t("analytics.streakDays", { count: stats.longestStreak })} />
          <StatCard label={t("analytics.avgMessages")} value={stats.avgPerDay} />
        </motion.div>

        <ChartCard title={t("analytics.dailyMessages")}>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.messageVolume || []}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="count" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid md:grid-cols-2 gap-6">
          <ChartCard title={t("analytics.emotionTrend")}>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={emotionChartData}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  {EMOTION_KEYS.map(key => (
                    <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={emotionColor(key)} fill={emotionColor(key)} fillOpacity={0.1} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-border/50">
              {EMOTION_KEYS.map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5" style={{ background: emotionColor(key) }} />
                  {t(EMOTIONS[key].labelKey)}
                </span>
              ))}
            </div>
          </ChartCard>

          <ChartCard title={t("analytics.hourlyDistribution")}>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={hourlyData.filter((_, i) => i % 2 === 0)}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="var(--color-muted-foreground)" />
                  <Radar dataKey="count" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.22} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <ChartCard title={t("analytics.personaRanking")}>
          {(data?.personaEngagement || []).length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("analytics.noData")}</p>
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
      className="surface p-4 sm:p-5"
    >
      <h2 className="section-title mb-5">{title}</h2>
      {children}
    </motion.section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <motion.div variants={fadeUp} className="stat-block">
      <p className="stat-value">{value}</p>
      <p className="stat-label mt-1">{label}</p>
    </motion.div>
  );
}
