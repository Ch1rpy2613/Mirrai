const EMOTION_COLORS: Record<string, string> = {
  warm: "#7CB69D", playful: "#F59E0B", nostalgic: "#8B5CF6",
  melancholy: "#6B7280", happy: "#EF4444", distant: "#3B82F6",
};

const EMOTION_LABELS: Record<string, string> = {
  warm: "🌸 温柔", playful: "😄 俏皮", nostalgic: "🌙 思念",
  melancholy: "🌧️ 忧郁", happy: "✨ 开心", distant: "❄️ 疏离",
};

const EMOTION_Y: Record<string, number> = {
  distant: 1, melancholy: 2, nostalgic: 3, warm: 4, playful: 5, happy: 6,
};

interface ExportParams {
  persona: { name: string; relationshipDesc?: string | null; createdAt: Date };
  messages: Array<{ role: string; content: string; emotionalState: string | null; createdAt: Date; messageType?: string | null }>;
  memories: Array<{ title: string; description?: string | null; category: string; date?: string | null; createdAt: Date }>;
  emotionSnapshots: Array<{ emotionalState: string; messageCount: number; date: string; createdAt: Date }>;
  diaryEntries: Array<{ date: string; summary: string | null; reflection?: string | null }>;
  intimacy: { score: number; level: string };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function buildEmotionSVG(snapshots: ExportParams["emotionSnapshots"]): string {
  if (snapshots.length < 2) return "";
  const W = 700, H = 200, PAD = 40;
  const plotW = W - PAD * 2, plotH = H - PAD * 2;
  const step = plotW / Math.max(snapshots.length - 1, 1);

  const points = snapshots.map((s, i) => {
    const x = PAD + i * step;
    const y = PAD + plotH - ((EMOTION_Y[s.emotionalState] || 4) - 1) / 5 * plotH;
    return { x, y, state: s.emotionalState, date: s.date };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${EMOTION_COLORS[p.state] || "#999"}" />
     <title>${p.date}: ${EMOTION_LABELS[p.state] || p.state}</title>`
  ).join("\n");

  const yLabels = Object.entries(EMOTION_Y).map(([state, val]) => {
    const y = PAD + plotH - (val - 1) / 5 * plotH;
    return `<text x="${PAD - 5}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${EMOTION_LABELS[state] || state}</text>`;
  }).join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:700px;height:auto">
    <polyline points="${polyline}" fill="none" stroke="#7CB69D" stroke-width="2" opacity="0.5"/>
    ${dots}
    ${yLabels}
    <text x="${PAD}" y="${H - 5}" font-size="10" fill="#aaa">${snapshots[0]?.date || ""}</text>
    <text x="${W - PAD}" y="${H - 5}" text-anchor="end" font-size="10" fill="#aaa">${snapshots[snapshots.length - 1]?.date || ""}</text>
  </svg>`;
}

export function generateChatExportHTML(params: ExportParams): string {
  const { persona, messages, memories, emotionSnapshots, diaryEntries, intimacy } = params;
  const dateRange = messages.length > 0
    ? `${formatDate(messages[0].createdAt)} — ${formatDate(messages[messages.length - 1].createdAt)}`
    : "暂无消息";

  const grouped = new Map<string, typeof messages>();
  for (const m of messages) {
    const day = formatDate(m.createdAt);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(m);
  }

  const messagesHtml = Array.from(grouped.entries()).map(([day, msgs]) => {
    const bubbles = msgs.map(m => {
      const isUser = m.role === "user";
      const emotionBadge = !isUser && m.emotionalState
        ? `<span class="badge" style="background:${EMOTION_COLORS[m.emotionalState] || "#999"}20;color:${EMOTION_COLORS[m.emotionalState] || "#999"}">${EMOTION_LABELS[m.emotionalState] || ""}</span>`
        : "";
      return `<div class="msg ${isUser ? "msg-user" : "msg-ai"}">
        ${emotionBadge}
        <div class="bubble ${isUser ? "bubble-user" : "bubble-ai"}">${escapeHtml(m.content)}</div>
        <span class="time">${formatTime(m.createdAt)}</span>
      </div>`;
    }).join("\n");
    return `<div class="day-group"><div class="day-label">${day}</div>${bubbles}</div>`;
  }).join("\n");

  const memoriesHtml = memories.length > 0 ? `<section class="section">
    <h2>记忆里程碑</h2>
    <div class="memories">${memories.map(m => `<div class="memory-card">
      <span class="mem-cat">${m.category === "milestone" ? "🏆 里程碑" : m.category === "anniversary" ? "💝 纪念日" : "💭 记忆"}</span>
      ${m.date ? `<span class="mem-date">${m.date}</span>` : ""}
      <p class="mem-title">${escapeHtml(m.title)}</p>
      ${m.description ? `<p class="mem-desc">${escapeHtml(m.description)}</p>` : ""}
    </div>`).join("\n")}</div>
  </section>` : "";

  const diaryHtml = diaryEntries.length > 0 ? `<section class="section">
    <h2>对话日记</h2>
    ${diaryEntries.slice(0, 10).map(d => `<div class="diary-entry">
      <span class="diary-date">${d.date}</span>
      ${d.summary ? `<p>${escapeHtml(d.summary)}</p>` : ""}
      ${d.reflection ? `<p class="reflection">${escapeHtml(d.reflection)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  const emotionSvg = buildEmotionSVG(emotionSnapshots);
  const emotionSection = emotionSvg ? `<section class="section">
    <h2>情感时间线</h2>
    ${emotionSvg}
  </section>` : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(persona.name)} — 对话记录</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;background:#fafafa;color:#1a1a1a;line-height:1.6;max-width:800px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
h2{font-size:1.1rem;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e5e5}
.header{text-align:center;padding:32px 0;border-bottom:1px solid #e5e5e5;margin-bottom:24px}
.meta{color:#888;font-size:0.85rem;margin-top:4px}
.stats{display:flex;gap:24px;justify-content:center;margin-top:16px}
.stat{text-align:center}
.stat-val{font-size:1.5rem;font-weight:700;color:#7CB69D}
.stat-label{font-size:0.75rem;color:#888}
.section{margin-bottom:32px}
.day-group{margin-bottom:20px}
.day-label{text-align:center;font-size:0.75rem;color:#aaa;margin:16px 0 8px;position:relative}
.day-label::before,.day-label::after{content:"";position:absolute;top:50%;width:30%;height:1px;background:#e5e5e5}
.day-label::before{left:0}.day-label::after{right:0}
.msg{display:flex;flex-direction:column;margin-bottom:8px;max-width:75%}
.msg-user{align-items:flex-end;margin-left:auto}
.msg-ai{align-items:flex-start}
.bubble{padding:8px 14px;border-radius:16px;font-size:0.9rem;word-break:break-word;white-space:pre-wrap}
.bubble-user{background:#7CB69D;color:#fff;border-bottom-right-radius:4px}
.bubble-ai{background:#f0f0f0;color:#1a1a1a;border-bottom-left-radius:4px}
.badge{font-size:0.7rem;padding:1px 8px;border-radius:10px;margin-bottom:2px;display:inline-block}
.time{font-size:0.65rem;color:#bbb;margin-top:2px;padding:0 4px}
.memories{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.memory-card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:12px}
.mem-cat{font-size:0.7rem;color:#888}.mem-date{font-size:0.7rem;color:#aaa;margin-left:8px}
.mem-title{font-size:0.85rem;font-weight:500;margin-top:4px}
.mem-desc{font-size:0.75rem;color:#666;margin-top:2px}
.diary-entry{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:12px;margin-bottom:8px}
.diary-date{font-size:0.75rem;color:#7CB69D;font-weight:500}
.diary-entry p{font-size:0.85rem;margin-top:4px}
.reflection{color:#888;font-style:italic}
.footer{text-align:center;color:#ccc;font-size:0.7rem;margin-top:40px;padding-top:16px;border-top:1px solid #e5e5e5}
@media print{body{max-width:100%;padding:12px}.bubble-user{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHtml(persona.name)}</h1>
  <p class="meta">${escapeHtml(persona.relationshipDesc || "")} · ${dateRange}</p>
  <div class="stats">
    <div class="stat"><div class="stat-val">${messages.length}</div><div class="stat-label">消息</div></div>
    <div class="stat"><div class="stat-val">${memories.length}</div><div class="stat-label">记忆</div></div>
    <div class="stat"><div class="stat-val">${intimacy.score}</div><div class="stat-label">${escapeHtml(intimacy.level)}</div></div>
  </div>
</div>
${emotionSection}
${memoriesHtml}
<section class="section">
  <h2>对话记录</h2>
  ${messagesHtml}
</section>
${diaryHtml}
<div class="footer">导出于 ${new Date().toLocaleString("zh-CN")} · Presence</div>
</body>
</html>`;
}
