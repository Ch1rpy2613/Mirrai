import { intimacyLevelLabel } from "@shared/intimacy";

const EMOTION_COLORS: Record<string, string> = {
  warm: "#7CB69D", playful: "#F59E0B", nostalgic: "#8B5CF6",
  melancholy: "#6B7280", happy: "#EF4444", distant: "#3B82F6",
};

/**
 * The export's own words.
 *
 * The HTML export was hardcoded Chinese, so an English-speaking user
 * downloaded a keepsake they could not read. The wording follows the
 * language of the export.
 */
const EMOTION_LABELS: Record<string, { zh: string; en: string }> = {
  warm: { zh: "🌸 温柔", en: "🌸 Warm" },
  playful: { zh: "😄 俏皮", en: "😄 Playful" },
  nostalgic: { zh: "🌙 思念", en: "🌙 Nostalgic" },
  melancholy: { zh: "🌧️ 忧郁", en: "🌧️ Melancholy" },
  happy: { zh: "✨ 开心", en: "✨ Happy" },
  distant: { zh: "❄️ 疏离", en: "❄️ Distant" },
};

const COPY = {
  zh: {
    milestones: "记忆里程碑",
    events: "关系大事记",
    diaries: "对话日记",
    emotions: "情感时间线",
    letter: "告别信",
    letters: "信",
    transcript: "对话记录",
    milestone: "🏆 里程碑",
    anniversary: "💝 纪念日",
    memory: "💭 记忆",
    intimacy: "亲密度",
    messageCount: "消息",
    memoryCount: "记忆",
    exportedOn: "导出于",
    noMessages: "暂无消息",
    /** What kind of letter a row is. */
    letterNote: "（等 TA 回来再说）",
    letterKept: "（只写下来了，没有寄出）",
    letterWaiting: "（已寄出，等回信）",
    letterAnswered: "（已收到回信）",
    /**
     * The note under the diaries.
     *
     * It was missing from the Chinese table — so the export of a
     * persona with more than ten diaries threw, and the user got an
     * error and no file at all. The English table had it.
     */
    diaryMore: "（只显示最近 {shown} 篇，共 {total} 篇）",
  },
  en: {
    milestones: "Milestones",
    events: "The moments you marked",
    diaries: "Diaries",
    emotions: "Emotional timeline",
    letter: "The farewell letter",
    letters: "Letters",
    transcript: "Conversation",
    milestone: "🏆 Milestone",
    anniversary: "💝 Anniversary",
    memory: "💭 Memory",
    intimacy: "Intimacy",
    messageCount: "messages",
    memoryCount: "memories",
    exportedOn: "Exported on",
    noMessages: "No messages",
    diaryMore: "(the {shown} most recent of {total})",
    letterNote: "(a note for later)",
    letterKept: "(kept — never sent)",
    letterWaiting: "(sent — waiting for a reply)",
    letterAnswered: "(answered)",
  },
} as const;

type ExportLocale = keyof typeof COPY;

const EMOTION_Y: Record<string, number> = {
  distant: 1, melancholy: 2, nostalgic: 3, warm: 4, playful: 5, happy: 6,
};

interface ExportParams {
  persona: {
    name: string;
    relationshipDesc?: string | null;
    createdAt: Date;
    /** The farewell letter, when the persona has graduated. */
    farewellLetter?: string | null;
    graduatedAt?: Date | null;
  };
  messages: Array<{ role: string; content: string; emotionalState: string | null; createdAt: Date; messageType?: string | null }>;
  memories: Array<{ title: string; description?: string | null; category: string; date?: string | null; createdAt: Date }>;
  emotionSnapshots: Array<{ emotionalState: string; messageCount: number; date: string; createdAt: Date }>;
  diaryEntries: Array<{ date: string; summary: string | null; reflection?: string | null }>;
  /**
   * The relationship events.
   *
   * They were missing from the per-persona export — so the keepsake of
   * a relationship had the conversations and the memories and none of
   * the moments the user marked. The "export everything" bundle had
   * them; the one from the chat page did not.
   */
  events?: Array<{
    kind: string;
    title: string;
    detail?: string | null;
    happenedAt: Date;
  }>;
  /** The letters — what was written, and what came back. */
  letters?: Array<{
    body: string;
    kind: string;
    status: string;
    replyText?: string | null;
    repliedAt?: Date | null;
    createdAt: Date;
  }>;
  intimacy: { score: number; level: string };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d: Date | string, locale: ExportLocale = "zh"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function formatTime(d: Date | string, locale: ExportLocale = "zh"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", {
    hour: "2-digit", minute: "2-digit",
  });
}

function buildEmotionSVG(
  snapshots: ExportParams["emotionSnapshots"],
  locale: ExportLocale = "zh",
): string {
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
     <title>${escapeHtml(p.date)}: ${escapeHtml(EMOTION_LABELS[p.state]?.[locale] || p.state)}</title>`
  ).join("\n");

  const yLabels = Object.entries(EMOTION_Y).map(([state, val]) => {
    const y = PAD + plotH - (val - 1) / 5 * plotH;
    return `<text x="${PAD - 5}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${EMOTION_LABELS[state]?.[locale] || state}</text>`;
  }).join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:700px;height:auto">
    <polyline points="${polyline}" fill="none" stroke="#7CB69D" stroke-width="2" opacity="0.5"/>
    ${dots}
    ${yLabels}
    <text x="${PAD}" y="${H - 5}" font-size="10" fill="#aaa">${escapeHtml(snapshots[0]?.date || "")}</text>
    <text x="${W - PAD}" y="${H - 5}" text-anchor="end" font-size="10" fill="#aaa">${escapeHtml(snapshots[snapshots.length - 1]?.date || "")}</text>
  </svg>`;
}

export function generateChatExportHTML(
  params: ExportParams,
  locale: ExportLocale = "zh",
): string {
  const { persona, messages, memories, emotionSnapshots, diaryEntries, intimacy } = params;
  const copy = COPY[locale];
  const dateRange = messages.length > 0
    ? `${formatDate(messages[0].createdAt, locale)} — ${formatDate(messages[messages.length - 1].createdAt, locale)}`
    : copy.noMessages;

  const grouped = new Map<string, typeof messages>();
  for (const m of messages) {
    const day = formatDate(m.createdAt, locale);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(m);
  }

  const messagesHtml = Array.from(grouped.entries()).map(([day, msgs]) => {
    const bubbles = msgs.map(m => {
      const isUser = m.role === "user";
      const emotionBadge = !isUser && m.emotionalState
        ? `<span class="badge" style="background:${EMOTION_COLORS[m.emotionalState] || "#999"}20;color:${EMOTION_COLORS[m.emotionalState] || "#999"}">${EMOTION_LABELS[m.emotionalState]?.[locale] || ""}</span>`
        : "";
      return `<div class="msg ${isUser ? "msg-user" : "msg-ai"}">
        ${emotionBadge}
        <div class="bubble ${isUser ? "bubble-user" : "bubble-ai"}">${escapeHtml(m.content)}</div>
        <span class="time">${formatTime(m.createdAt, locale)}</span>
      </div>`;
    }).join("\n");
    return `<div class="day-group"><div class="day-label">${day}</div>${bubbles}</div>`;
  }).join("\n");

  const memoriesHtml = memories.length > 0 ? `<section class="section">
    <h2>${copy.milestones}</h2>
    <div class="memories">${memories.map(m => `<div class="memory-card">
      <span class="mem-cat">${m.category === "milestone" ? copy.milestone : m.category === "anniversary" ? copy.anniversary : copy.memory}</span>
      ${m.date ? `<span class="mem-date">${escapeHtml(m.date)}</span>` : ""}
      <p class="mem-title">${escapeHtml(m.title)}</p>
      ${m.description ? `<p class="mem-desc">${escapeHtml(m.description)}</p>` : ""}
    </div>`).join("\n")}</div>
  </section>` : "";

  /**
   * The newest diaries.
   *
   * The entries arrive oldest first, and the export took the first ten
   * of them — so a user with forty-five diaries got the first ten days
   * ever diarised and nothing about the last thirty-five. No count, no
   * marker: the file simply did not have them.
   *
   * And the sibling export (the Markdown one) has all of them — so the
   * two "export my data" buttons disagreed with each other.
   */
  const shownDiaries = diaryEntries.slice(-10);
  const diaryHtml = diaryEntries.length > 0 ? `<section class="section">
    <h2>${copy.diaries}</h2>
    ${diaryEntries.length > shownDiaries.length
      ? `<p class="section-note">${copy.diaryMore.replace("{shown}", String(shownDiaries.length)).replace("{total}", String(diaryEntries.length))}</p>`
      : ""}
    ${shownDiaries.map(d => `<div class="diary-entry">
      <span class="diary-date">${escapeHtml(d.date)}</span>
      ${d.summary ? `<p>${escapeHtml(d.summary)}</p>` : ""}
      ${d.reflection ? `<p class="reflection">${escapeHtml(d.reflection)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  const emotionSvg = buildEmotionSVG(emotionSnapshots, locale);
  const emotionSection = emotionSvg ? `<section class="section">
    <h2>${copy.emotions}</h2>
    ${emotionSvg}
  </section>` : "";

  // The farewell letter is the one artefact the graduation mechanism
  // produces, and it used to be reachable only online — waking the persona
  // destroyed it, and the export left it out. It belongs in the keepsake.
  // The letters. They are the artefact somebody would most want to keep:
  // what was written at two in the morning, and the reply that came a
  // day later.
  const lettersHtml = (params.letters ?? []).length > 0 ? `<section class="section">
    <h2>${copy.letters}</h2>
    ${(params.letters ?? []).map((l) => `<div class="diary-entry">
      <span class="diary-date">${formatDate(l.createdAt, locale)}</span>
      ${
      /**
       * What kind of letter it was.
       *
       * Every row was rendered the same way — so a note for later looked
       * like a letter, and a letter that was kept (and never sent)
       * looked like one that had been answered. The Markdown export
       * marks the notes; this one did not.
       */
      l.kind === "todo" ? `<span class="diary-date">${copy.letterNote}</span>` : ""}
      ${l.kind !== "todo" && l.status === "private" ? `<span class="diary-date">${copy.letterKept}</span>` : ""}
      ${l.kind !== "todo" && l.status === "waiting" ? `<span class="diary-date">${copy.letterWaiting}</span>` : ""}
      ${l.kind !== "todo" && l.status === "answered" ? `<span class="diary-date">${copy.letterAnswered}</span>` : ""}
      <p>${escapeHtml(l.body)}</p>
      ${l.replyText ? `<p class="reflection">${escapeHtml(l.replyText)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  /**
   * The moments the user marked.
   *
   * They were missing from this export — the "export everything"
   * bundle had them, and the keepsake of a relationship had the
   * conversations and the memories and none of the moments.
   */
  const eventsHtml = (params.events ?? []).length > 0 ? `<section class="section">
    <h2>${copy.events}</h2>
    ${(params.events ?? []).map((e) => `<div class="diary-entry">
      <span class="diary-date">${formatDate(e.happenedAt, locale)}</span>
      <p><strong>${escapeHtml(e.title)}</strong></p>
      ${e.detail ? `<p class="reflection">${escapeHtml(e.detail)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  const letterHtml = persona.farewellLetter ? `<section class="section">
    <h2>${copy.letter}</h2>
    <div class="farewell">
      <p class="farewell-text">${escapeHtml(persona.farewellLetter)}</p>
      ${persona.graduatedAt ? `<p class="farewell-date">${formatDate(persona.graduatedAt, locale)}</p>` : ""}
    </div>
  </section>` : "";

  return `<!DOCTYPE html>
<html lang="${locale === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(persona.name)} — ${copy.transcript}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;background:#fafafa;color:#1a1a1a;line-height:1.6;max-width:800px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
h2{font-size:1.1rem;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e5e5}
.section-note{color:#888;font-size:0.9rem;margin:-6px 0 12px}
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
.farewell{background:#fff;border:1px solid #e5e5e5;border-left:3px solid #c8a27a;border-radius:12px;padding:16px}
.farewell-text{font-size:0.95rem;line-height:1.9;white-space:pre-wrap}
.farewell-date{font-size:0.75rem;color:#999;margin-top:10px;text-align:right}
.footer{text-align:center;color:#ccc;font-size:0.7rem;margin-top:40px;padding-top:16px;border-top:1px solid #e5e5e5}
@media print{body{max-width:100%;padding:12px}.bubble-user{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHtml(persona.name)}</h1>
  <p class="meta">${escapeHtml(persona.relationshipDesc || "")} · ${dateRange}</p>
  <div class="stats">
    <div class="stat"><div class="stat-val">${messages.length}</div><div class="stat-label">${copy.messageCount}</div></div>
    <div class="stat"><div class="stat-val">${memories.length}</div><div class="stat-label">${copy.memoryCount}</div></div>
    <div class="stat"><div class="stat-val">${intimacy.score}</div><div class="stat-label">${escapeHtml(intimacyLevelLabel(intimacy.level, locale))}</div></div>
  </div>
</div>
${emotionSection}
${memoriesHtml}
${letterHtml}
${eventsHtml}
${lettersHtml}
<section class="section">
  <h2>${copy.transcript}</h2>
  ${messagesHtml}
</section>
${diaryHtml}
<div class="footer">${copy.exportedOn} ${new Date().toLocaleString(locale === "en" ? "en-US" : "zh-CN")} · Mirrai</div>
</body>
</html>`;
}
