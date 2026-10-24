/**
 * Turning questionnaire answers into a persona.
 *
 * The guided questionnaire exists for people who have no chat logs to upload.
 * The answers are mapped onto the same seven-layer persona structure the
 * distillation pipeline produces, so everything downstream — the prompt, the
 * memory anchors, the character card export — works the same way.
 */
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";

export interface QuestionnaireAnswers {
  /** The person's name. */
  name?: string;
  /** Who they are to the user. */
  relationship?: string;
  /** When the relationship started, `YYYY-MM` or `YYYY-MM-DD`. */
  togetherFrom?: string;
  /** How they met. */
  metStory?: string;
  /** Free-form tags describing how they communicate. */
  communicationStyles?: string[];
  /** Words and phrases they actually use. */
  catchphrases?: string[];
  /** What they care about. */
  caresAbout?: string;
  /** How they argue. */
  conflictStyle?: string;
  /** Their love language. */
  loveLanguage?: string;
  /** Things that are off-limits. */
  boundaries?: string;
  /** What the user calls them. */
  nickname?: string;
  /** Anything else. */
  notes?: string;
}

const COMMUNICATION_STYLE_TEXT: Record<string, string> = {
  gentle: "说话温和，语气轻，习惯先照顾对方的感受",
  direct: "说话直接，结论先行，不喜欢绕弯子",
  playful: "爱开玩笑，语气活泼，喜欢用玩笑掩饰真实情绪",
  quiet: "话不多，但每句都很认真",
  detailed: "喜欢把事情讲得很细，会交代前因后果",
  caring: "总是先问对方吃没吃、睡没睡，照顾人很自然",
  irritable: "容易急，说话冲，但事后会后悔",
  literary: "喜欢用比喻和意象，表达得含蓄",
};

const CONFLICT_TEXT: Record<string, string> = {
  silent: "吵起来会先沉默，等自己冷静了才说原因",
  direct: "当场把话说开，不喜欢拖着",
  forget: "不记仇，过了就过了",
  cold: "会冷战，不主动联系，等对方先低头",
  dramatic: "情绪很外放，会反复提起同一件事",
  apologetic: "习惯先道歉，哪怕不是自己的错",
};

const LOVE_LANGUAGE_TEXT: Record<string, string> = {
  words: "肯定的言语",
  time: "陪伴的时间",
  gifts: "具体的礼物",
  acts: "为对方做的实际的事",
  touch: "身体接触和亲密",
  service: "日常的服务与照顾",
};

export interface QuestionnaireResult {
  name: string;
  relationshipDesc: string;
  togetherFrom: string | null;
  personaData: PersonaData;
  /** The answers, for the record. */
  answers: QuestionnaireAnswers;
}

/**
 * Builds a persona from questionnaire answers.
 */
export function buildPersonaFromAnswers(answers: QuestionnaireAnswers): QuestionnaireResult {
  const name = (answers.name ?? "").trim() || "TA";

  const relationshipParts: string[] = [];
  if (answers.relationship?.trim()) relationshipParts.push(answers.relationship.trim());
  if (answers.togetherFrom?.trim()) relationshipParts.push(`从 ${answers.togetherFrom.trim()} 开始`);
  const relationshipDesc = relationshipParts.join("，") || "重要的人";

  const styles = (answers.communicationStyles ?? [])
    .map((key) => COMMUNICATION_STYLE_TEXT[key] ?? key)
    .filter(Boolean);
  const speakingStyle = styles.length > 0
    ? styles.join("；")
    : "说话自然，语气随性";

  const catchphrases = (answers.catchphrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean);

  // The boundaries are part of who the person is: what they never want to
  // hear about. They belong with the personality traits, so they end up in
  // the persona data and, through it, in the system prompt.
  const personalityParts: string[] = [];
  if (answers.caresAbout?.trim()) personalityParts.push(answers.caresAbout.trim());
  if (answers.boundaries?.trim()) {
    personalityParts.push(`雷区与边界：${answers.boundaries.trim()}`);
  }
  if (answers.notes?.trim()) personalityParts.push(answers.notes.trim());
  const personality = personalityParts.join("。") || `${name}是一个温柔体贴的人。`;

  const conflictStyle = CONFLICT_TEXT[answers.conflictStyle ?? ""] ?? answers.conflictStyle?.trim() ?? "未知";
  const loveLanguage = LOVE_LANGUAGE_TEXT[answers.loveLanguage ?? ""] ?? answers.loveLanguage?.trim() ?? "未知";

  const memories = answers.metStory?.trim() ?? "";

  const personaData = normalizePersonaData(
    {
      personality,
      speakingStyle,
      catchphrases,
      nickname: answers.nickname?.trim() || "宝贝",
      memories,
      attachmentStyle: "待观察",
      loveLanguage,
      conflictStyle,
      touchingMoments: "",
      summary: `${name}是${relationshipDesc}。`,
    },
    { name },
  );

  return {
    name,
    relationshipDesc,
    togetherFrom: answers.togetherFrom?.trim() || null,
    personaData,
    answers,
  };
}
