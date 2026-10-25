/**
 * Turning questionnaire answers into a persona.
 *
 * The guided questionnaire exists for people who have no chat logs to upload.
 * The answers are mapped onto the same seven-layer persona structure the
 * distillation pipeline produces, so everything downstream — the prompt, the
 * memory anchors, the character card export — works the same way.
 */
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";
import { copy, type Locale } from "@shared/copy";

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

/**
 * The answers, in words.
 *
 * These end up in the persona's own description — the one the user reads
 * on the profile page and the one the model is given. They were Chinese
 * only, so an English user answered an English questionnaire and got a
 * Chinese person back.
 */
const COMMUNICATION_STYLE_KEYS: Record<string, string> = {
  gentle: "questionnaire.style.gentle",
  direct: "questionnaire.style.direct",
  playful: "questionnaire.style.playful",
  quiet: "questionnaire.style.quiet",
  detailed: "questionnaire.style.detailed",
  caring: "questionnaire.style.caring",
  irritable: "questionnaire.style.irritable",
  literary: "questionnaire.style.literary",
};

const CONFLICT_KEYS: Record<string, string> = {
  silent: "questionnaire.conflict.silent",
  direct: "questionnaire.conflict.direct",
  forget: "questionnaire.conflict.forget",
  cold: "questionnaire.conflict.cold",
  dramatic: "questionnaire.conflict.dramatic",
  apologetic: "questionnaire.conflict.apologetic",
};

const LOVE_LANGUAGE_KEYS: Record<string, string> = {
  words: "questionnaire.love.words",
  time: "questionnaire.love.time",
  gifts: "questionnaire.love.gifts",
  acts: "questionnaire.love.acts",
  touch: "questionnaire.love.touch",
  service: "questionnaire.love.service",
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
 *
 * The language follows the person: the answers they gave were in their
 * language, so the person that comes out of them should be too.
 */
export function buildPersonaFromAnswers(
  answers: QuestionnaireAnswers,
  locale: Locale = "zh",
): QuestionnaireResult {
  const name = (answers.name ?? "").trim() || "TA";

  const relationshipParts: string[] = [];
  if (answers.relationship?.trim()) relationshipParts.push(answers.relationship.trim());
  if (answers.togetherFrom?.trim()) {
    relationshipParts.push(
      copy(locale, "questionnaire.togetherFrom", { date: answers.togetherFrom.trim() }),
    );
  }
  const relationshipDesc =
    relationshipParts.join(locale === "en" ? ", " : "，") ||
    copy(locale, "questionnaire.importantPerson");

  const styles = (answers.communicationStyles ?? [])
    .map((key) => {
      const copyKey = COMMUNICATION_STYLE_KEYS[key];
      return copyKey ? copy(locale, copyKey) : key;
    })
    .filter(Boolean);
  const speakingStyle =
    styles.length > 0
      ? styles.join(locale === "en" ? "; " : "；")
      : copy(locale, "questionnaire.style.default");

  const catchphrases = (answers.catchphrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean);

  // The boundaries are part of who the person is: what they never want to
  // hear about. They belong with the personality traits, so they end up in
  // the persona data and, through it, in the system prompt.
  const personalityParts: string[] = [];
  if (answers.caresAbout?.trim()) personalityParts.push(answers.caresAbout.trim());
  if (answers.boundaries?.trim()) {
    personalityParts.push(
      copy(locale, "questionnaire.boundaries", { value: answers.boundaries.trim() }),
    );
  }
  if (answers.notes?.trim()) personalityParts.push(answers.notes.trim());
  const personality =
    personalityParts.join(locale === "en" ? ". " : "。") ||
    copy(locale, "questionnaire.defaultPersonality", { name });

  const conflictKey = CONFLICT_KEYS[answers.conflictStyle ?? ""];
  const conflictStyle =
    (conflictKey ? copy(locale, conflictKey) : answers.conflictStyle?.trim()) ||
    copy(locale, "prompt.unknown");
  const loveKey = LOVE_LANGUAGE_KEYS[answers.loveLanguage ?? ""];
  const loveLanguage =
    (loveKey ? copy(locale, loveKey) : answers.loveLanguage?.trim()) ||
    copy(locale, "prompt.unknown");

  const memories = answers.metStory?.trim() ?? "";

  const personaData = normalizePersonaData(
    {
      personality,
      speakingStyle,
      catchphrases,
      nickname: answers.nickname?.trim() || copy(locale, "questionnaire.defaultNickname"),
      memories,
      attachmentStyle: copy(locale, "questionnaire.attachmentToObserve"),
      loveLanguage,
      conflictStyle,
      touchingMoments: "",
      summary: copy(locale, "questionnaire.summary", { name, relationship: relationshipDesc }),
    },
    { name, locale },
  );

  return {
    name,
    relationshipDesc,
    togetherFrom: answers.togetherFrom?.trim() || null,
    personaData,
    answers,
  };
}
