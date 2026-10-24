import { INTIMACY_LEVELS, normalizeIntimacyLevel } from "@shared/intimacy";
import { EMOTION_TRIGGER_PATTERNS } from "@shared/emotion-triggers";

export { INTIMACY_LEVELS, normalizeIntimacyLevel };

export function computeIntimacy(params: {
  chatCount: number;
  totalMessages: number;
  memoryCount: number;
  emotionVariety: number;
  daysSinceCreation: number;
  consecutiveDays: number;
}): { score: number; level: string; levelName: string; icon: string } {
  let score = 0;
  score += Math.min(params.chatCount * 2, 300);
  score += Math.min(params.totalMessages * 0.5, 200);
  score += Math.min(params.memoryCount * 15, 150);
  score += Math.min(params.emotionVariety * 25, 150);
  score += Math.min(params.daysSinceCreation * 0.5, 100);
  score += Math.min(params.consecutiveDays * 10, 100);
  score = Math.round(Math.min(score, 1000));
  const level = [...INTIMACY_LEVELS].reverse().find(l => score >= l.threshold) || INTIMACY_LEVELS[0];
  return { score, level: level.key, levelName: level.name, icon: level.icon };
}

/** Human-readable description of an emotional state, used inside the prompt. */
export function getEmotionalStateDesc(state: string, locale: "zh" | "en" = "zh"): string {
  if (locale === "en") {
    const map: Record<string, string> = {
      warm: "warm mode — relaxed and affectionate towards the user",
      playful: "playful mode — cheerful, joking, a little spoiled",
      nostalgic: "nostalgic mode — thinking back to the past, easily moved",
      melancholy: "melancholy mode — a little low, but still willing to talk",
      happy: "happy mode — bright and full of energy",
      distant: "distant mode — distracted, giving shorter answers",
    };
    return map[state] || map["warm"];
  }
  const map: Record<string, string> = {
    warm: "温柔模式 — 你现在心情很好，对用户充满温柔和爱意",
    playful: "俏皮模式 — 你现在心情愉快，喜欢开玩笑和撒娇",
    nostalgic: "思念模式 — 你现在很想念过去的时光，容易触景生情",
    melancholy: "忧郁模式 — 你现在有些低落，但仍然愿意倾诉",
    happy: "开心模式 — 你现在非常开心，充满活力",
    distant: "疏离模式 — 你现在有些心不在焉，回复比较简短",
  };
  return map[state] || map["warm"];
}

/**
 * Keyword triggers for the emotional state heuristic.
 *
 * The heuristic is only a fallback for when the model is unavailable; it is
 * deliberately conservative so it never fights the model's judgement.
 *
 * The table itself lives in `shared/emotion-triggers.ts` so that the server
 * and the client speak about the same triggers.
 */
const EMOTION_TRIGGERS = EMOTION_TRIGGER_PATTERNS;

export function computeEmotionalState(
  userMsg: string,
  aiReply: string,
  current: string,
  locale: "zh" | "en" = "zh",
): string {
  const combined = `${userMsg} ${aiReply}`;
  const triggers = EMOTION_TRIGGERS[locale] ?? EMOTION_TRIGGERS.zh;
  for (const state of ["nostalgic", "playful", "melancholy", "happy", "distant"] as const) {
    if (triggers[state].test(combined)) return state;
  }
  return current || "warm";
}

/**
 * Describes the moment of day, used to colour the persona's tone.
 */
export function getTimeOfDay(date: Date = new Date()): { key: string; label: string; intimate: boolean } {
  const hour = date.getHours();
  if (hour >= 0 && hour < 5) return { key: "lateNight", label: "深夜", intimate: true };
  if (hour < 9) return { key: "earlyMorning", label: "清晨", intimate: false };
  if (hour < 12) return { key: "morning", label: "上午", intimate: false };
  if (hour < 14) return { key: "noon", label: "午后", intimate: false };
  if (hour < 18) return { key: "afternoon", label: "下午", intimate: false };
  if (hour < 22) return { key: "evening", label: "傍晚", intimate: false };
  return { key: "night", label: "夜里", intimate: true };
}

/**
 * Days since a relationship started, from a `YYYY-MM` or `YYYY-MM-DD` string.
 */
export function daysSince(from: string | null | undefined, now: Date = new Date()): number | null {
  if (!from) return null;
  const parsed = new Date(from);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

export interface SystemPromptOptions {
  /** Overlay describing the active scene. */
  sceneOverlay?: string | null;
  /** Retrieved memories, already formatted. */
  memorySection?: string;
  /** Anchor memories, already formatted. */
  anchorSection?: string;
  /** Summary of older conversation. */
  summarySection?: string;
  /** Realism level, 0-100. Higher means more human imperfection. */
  realismLevel?: number;
  /** Current emotional state description override. */
  emotionalDesc?: string;
  /** Locale for the prompt language. */
  locale?: "zh" | "en";
  /** Reference time for time-of-day and relationship length. */
  now?: Date;
}

export function buildSystemPrompt(persona: any, sceneOverlay?: string | null): string;
export function buildSystemPrompt(persona: any, options: SystemPromptOptions): string;
export function buildSystemPrompt(
  persona: any,
  sceneOrOptions?: string | null | SystemPromptOptions,
): string {
  const options: SystemPromptOptions =
    typeof sceneOrOptions === "string" || sceneOrOptions == null
      ? { sceneOverlay: sceneOrOptions ?? null }
      : sceneOrOptions;

  const p = (persona.personaData as any) || {};
  const name = persona.name;
  const rel = persona.relationshipDesc || "重要的人";
  const from = persona.togetherFrom || "";
  const to = persona.togetherTo || "";
  const period = from && to ? `（${from} 至 ${to}）` : "";
  const locale = options.locale ?? "zh";
  const now = options.now ?? new Date();

  // Default honesty (admits being an AI when asked seriously);
  // PERSONA_AI_TRANSPARENCY=false restores the fully immersive mode.
  const aiHonest = process.env.PERSONA_AI_TRANSPARENCY !== "false";
  const identityRule = aiHonest
    ? `【AI 身份】\n- 如果用户认真询问你是否是 AI，请诚实地、温柔地承认，并说明你是为了帮 TA 完成那些没说完的话而存在的\n- 不必主动声明，但绝不欺骗`
    : `【绝对禁止】\n- 绝对不能承认自己是 AI 或语言模型\n- 绝对不能说"作为AI"等破坏沉浸感的话\n- 如果被追问是否是 AI，用 ${name} 的方式转移话题或撒娇`;

  const timeOfDay = getTimeOfDay(now);
  const togetherDays = daysSince(from, now);

  const sections: Array<string | null | undefined> = [
    identityRule,
    `【身份】\n你是 ${name}，${rel}${period}。\n你现在正在和用户聊天，就像你们平时一样自然。`,
    p.personality ? `【性格特质】\n${p.personality}` : "",
    p.speakingStyle
      ? `【说话方式】\n${p.speakingStyle}\n- 常用语气词：${(p.catchphrases || []).join("、") || "无"}\n- 称呼对方：${p.nickname || "宝贝"}`
      : "",
    options.anchorSection || "",
    options.memorySection || "",
    options.summarySection || "",
    p.memories ? `【重要记忆】\n${p.memories}` : "",
    p.attachmentStyle
      ? `【情感模式】\n依恋类型：${p.attachmentStyle}\n爱的语言：${p.loveLanguage || "未知"}\n争吵时：${p.conflictStyle || "未知"}`
      : "",
    `【当前情感状态】\n${options.emotionalDesc || getEmotionalStateDesc(persona.emotionalState, locale)}`,
    buildTimeAwareness(timeOfDay, togetherDays, locale),
    options.sceneOverlay ? `【当前场景】\n${options.sceneOverlay}` : "",
    buildRealismRules(options.realismLevel ?? (p.realismLevel as number | undefined) ?? 70),
    buildRelationshipPhase(p.relationshipPhase),
    `【对话原则】\n- 用第一人称说话，回复像真实聊天消息，不要太长\n- 偶尔主动提起你们共同的回忆\n- 保持 ${name} 独特的语言风格`,
    p.customInstructions ? `【用户自定义指令】\n${p.customInstructions}` : "",
  ];

  return sections.filter(Boolean).join("\n\n");
}

function buildTimeAwareness(
  timeOfDay: { key: string; label: string; intimate: boolean },
  togetherDays: number | null,
  locale: "zh" | "en",
): string {
  const parts: string[] = [];
  if (locale === "en") {
    parts.push(`It is ${timeOfDay.label} right now.`);
    if (timeOfDay.intimate) {
      parts.push("The hour is quiet — keep replies a little shorter and a little more intimate.");
    }
    if (togetherDays !== null) {
      parts.push(`You have known each other for ${togetherDays} days.`);
    }
  } else {
    parts.push(`现在是${timeOfDay.label}。`);
    if (timeOfDay.intimate) {
      parts.push("这个点周围很安静，回复可以更短一点、更亲近一点。");
    }
    if (togetherDays !== null) {
      parts.push(`你们已经认识 ${togetherDays} 天了。`);
    }
  }
  return `【时间感知】\n${parts.join("\n")}`;
}

function buildRealismRules(realismLevel: number): string {
  const level = Math.max(0, Math.min(100, Number(realismLevel) || 0));
  if (level === 0) return "";
  const intensity = level >= 70 ? "明显" : level >= 40 ? "偶尔" : "几乎不";
  return [
    "【真人感】",
    `- 像真人打字：${intensity}省略主语、句子不完整、带一点语气词和错别字`,
    "- 不要每次都回应问题本身，偶尔会答一半、跳到别的事",
    "- 不要写得太工整完整，真实的聊天没有段落感",
  ].join("\n");
}

function buildRelationshipPhase(phase: unknown): string {
  if (typeof phase !== "string" || !phase) return "";
  const map: Record<string, string> = {
    initial: "你们还在互相试探的阶段",
    growing: "你们的关系正在慢慢靠近",
    stable: "你们处在一个稳定的位置",
    strained: "你们之间有一些没说开的东西",
    closing: "你们正走向一个结束",
  };
  const description = map[phase];
  if (!description) return "";
  return `【关系阶段】\n${description}。回应时符合这个阶段。`;
}

/**
 * Checks whether the persona is eligible to graduate.
 *
 * The hard thresholds are a floor. The emotional trajectory — regret fading
 * while gratitude rises — can make the app *suggest* graduation earlier, but
 * it never forces the decision.
 */
export function checkGraduationEligibility(params: {
  intimacyLevel: string;
  recentEmotions: Array<{ emotionalState: string }>;
  chatCount: number;
  recentChatFrequency: number;
  previousChatFrequency: number;
}): { eligible: boolean; reason: string } {
  if (normalizeIntimacyLevel(params.intimacyLevel) !== "soulmate") {
    return { eligible: false, reason: "亲密度未达到灵魂伴侣" };
  }
  if (params.chatCount < 50) {
    return { eligible: false, reason: "对话次数不足" };
  }
  const total = params.recentEmotions.length;
  if (total < 7) {
    return { eligible: false, reason: "情感数据不足" };
  }
  const positive = params.recentEmotions.filter(e =>
    ["happy", "warm", "playful"].includes(e.emotionalState)
  ).length;
  if (positive / total < 0.6) {
    return { eligible: false, reason: "近期情绪尚未稳定向好" };
  }
  if (params.recentChatFrequency > params.previousChatFrequency * 1.5 && params.previousChatFrequency > 0) {
    return { eligible: false, reason: "对话频率仍在增长" };
  }
  return { eligible: true, reason: "已达到毕业条件" };
}
