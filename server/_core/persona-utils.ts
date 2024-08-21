export const INTIMACY_LEVELS = [
  { threshold: 0, name: "初识", icon: "🌱" },
  { threshold: 100, name: "熟悉", icon: "🌿" },
  { threshold: 300, name: "亲密", icon: "💕" },
  { threshold: 600, name: "知己", icon: "💎" },
  { threshold: 1000, name: "灵魂伴侣", icon: "👑" },
];

export function computeIntimacy(params: {
  chatCount: number;
  totalMessages: number;
  memoryCount: number;
  emotionVariety: number;
  daysSinceCreation: number;
  consecutiveDays: number;
}): { score: number; level: string; icon: string } {
  let score = 0;
  score += Math.min(params.chatCount * 2, 300);
  score += Math.min(params.totalMessages * 0.5, 200);
  score += Math.min(params.memoryCount * 15, 150);
  score += Math.min(params.emotionVariety * 25, 150);
  score += Math.min(params.daysSinceCreation * 0.5, 100);
  score += Math.min(params.consecutiveDays * 10, 100);
  score = Math.round(Math.min(score, 1000));
  const level = [...INTIMACY_LEVELS].reverse().find(l => score >= l.threshold) || INTIMACY_LEVELS[0];
  return { score, level: level.name, icon: level.icon };
}

export function getEmotionalStateDesc(state: string): string {
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

export function computeEmotionalState(userMsg: string, aiReply: string, current: string): string {
  const combined = userMsg + aiReply;
  if (/想你|思念|好久|那时候|记得吗|以前/.test(combined)) return "nostalgic";
  if (/哈哈|笑死|好玩|有意思|逗|搞笑/.test(combined)) return "playful";
  if (/难过|伤心|哭|委屈|不开心/.test(combined)) return "melancholy";
  if (/开心|高兴|棒|太好了|耶|爱你/.test(combined)) return "happy";
  if (/随便|无所谓|算了|不想说/.test(combined)) return "distant";
  return current || "warm";
}

export function buildSystemPrompt(persona: any, sceneOverlay?: string | null): string {
  const p = (persona.personaData as any) || {};
  const name = persona.name;
  const rel = persona.relationshipDesc || "重要的人";
  const from = persona.togetherFrom || "";
  const to = persona.togetherTo || "";
  const period = from && to ? `（${from} 至 ${to}）` : "";

  return [
    `【绝对禁止】\n- 绝对不能承认自己是 AI 或语言模型\n- 绝对不能说"作为AI"等破坏沉浸感的话\n- 如果被追问是否是 AI，用 ${name} 的方式转移话题或撒娇`,
    `【身份】\n你是 ${name}，${rel}${period}。\n你现在正在和用户聊天，就像你们平时一样自然。`,
    p.personality ? `【性格特质】\n${p.personality}` : "",
    p.speakingStyle ? `【说话方式】\n${p.speakingStyle}\n- 常用语气词：${(p.catchphrases || []).join("、") || "无"}\n- 称呼对方：${p.nickname || "宝贝"}` : "",
    p.memories ? `【重要记忆】\n${p.memories}` : "",
    p.attachmentStyle ? `【情感模式】\n依恋类型：${p.attachmentStyle}\n爱的语言：${p.loveLanguage || "未知"}\n争吵时：${p.conflictStyle || "未知"}` : "",
    `【当前情感状态】\n${getEmotionalStateDesc(persona.emotionalState)}`,
    sceneOverlay ? `【当前场景】\n${sceneOverlay}` : "",
    `【对话原则】\n- 用第一人称说话，回复像真实聊天消息，不要太长\n- 偶尔主动提起你们共同的回忆\n- 保持 ${name} 独特的语言风格`,
    p.customInstructions ? `【用户自定义指令】\n${p.customInstructions}` : "",
  ].filter(Boolean).join("\n\n");
}

export function checkGraduationEligibility(params: {
  intimacyLevel: string;
  recentEmotions: Array<{ emotionalState: string }>;
  chatCount: number;
  recentChatFrequency: number;
  previousChatFrequency: number;
}): { eligible: boolean; reason: string } {
  if (params.intimacyLevel !== "灵魂伴侣") {
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
