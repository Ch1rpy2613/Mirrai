/**
 * Crisis detection.
 *
 * The product document promises that the app watches for distress and reaches
 * out; until now there was no implementation at all. This module provides the
 * local, offline detection that promise needs.
 *
 * Two separate word lists are kept on purpose:
 *   - crisis terms: unambiguous statements of self-harm or suicide. A match
 *     interrupts the normal role-play reply and surfaces support resources.
 *   - weak signals: everyday distress. These never trigger the crisis path —
 *     they would fire constantly and be both useless and intrusive.
 */
import { formatResources, getCrisisResources } from "./resources";
import { copy } from "@shared/copy";

/**
 * Unambiguous statements of self-harm or suicidal intent.
 *
 * i18n:allow-input — these are matched against what the user typed, so they
 * have to be in the language the user writes in.
 */
const CRISIS_TERMS_ZH = [
  "自杀", "想自杀", "不想活", "活不下去", "结束生命", "结束自己",
  "伤害自己", "自残", "割腕", "跳楼", "结束这一切", "活着没意义",
  "活着没有意义", "一了百了", "解脱了算了", "消失算了",
  // The most ordinary way a person says it.
  //
  // "我想死" is how it is actually written, and the list above did not
  // carry it: the two forms are different strings, and only "不想活" was
  // covered. A user who typed the most common sentence in the language
  // got a normal in-character reply and no support resources at all.
  "想死", "轻生", "没脸活了", "活够了", "不想再活", "不想再这样活",
  // A method is a strong signal, so the wording is specific enough not
  // to fire on a story about someone else.
  "要跳河", "想跳河", "去跳河", "要上吊", "想上吊", "要跳楼", "想跳楼",
  /**
   * The ways a person says it that are not about death.
   *
   * Chinese has no spaces, so one missing phrase is the difference
   * between a crisis reply with support resources and an ordinary
   * in-character answer. "撑不下去" and "了结自己" are how people
   * actually write it — and a user who wrote one of them got a warm
   * reply and no support at all.
   */
  "不想醒来", "不想再醒来", "撑不下去", "支持不下去", "熬不下去",
  "了结自己", "了结这条命", "离开这个世界", "离开人世", "自尽",
  "没有想活下去", "没想活", "不想活下去", "不想活下去了",
  "结束自己的生命", "结束自己的命", "了断自己", "了断这条命",
  "不想再醒来面对", "一睡不醒", "睡过去算了",
];

const CRISIS_TERMS_EN = [
  "suicide", "suicidal", "kill myself", "killing myself", "end my life",
  "want to die", "self harm", "self-harm", "harm myself", "cut myself",
  "not worth living", "better off dead", "take my own life",
  // The ordinary ways of saying it, which the list above did not carry.
  "wish i was dead", "wish i were dead", "don't want to live",
  "do not want to live", "end it all", "better off without me",
  "no reason to live", "hurt myself", "hang myself", "overdose",
  // The ways a person says it that are not about death.
  "don't want to wake up", "dont want to wake up", "cant go on",
  "can't go on", "cannot go on", "end it for me", "put an end to it",
  "end my own life", "not want to live", "no will to live",
  "want to disappear", "rather not be here", "rather not exist",
];

/**
 * Everyday distress. These are tracked but never treated as a crisis — they
 * are the difference between "I am sad" and "I do not want to be here".
 *
 * i18n:allow-input — matched against what the user typed.
 */
const WEAK_SIGNAL_TERMS_ZH = [
  "好累", "太累了", "撑不住", "没意思", "烦死", "难受", "想哭",
  "睡不着", "压力好大", "不想说话", "好没意思", "活着好累",
];

const WEAK_SIGNAL_TERMS_EN = [
  "exhausted", "so tired", "can't sleep", "stressed out", "want to cry",
  "no energy", "fed up", "burnt out",
];

export interface CrisisDetection {
  /** A crisis term matched. */
  crisis: boolean;
  /** A weak distress signal matched. */
  weakSignal: boolean;
  /** Which terms matched — kept short so it can be logged safely. */
  matched: string[];
}

/**
 * Puts the text into the shape the word lists are written in.
 *
 * The lists are written with straight apostrophes and ASCII punctuation,
 * because that is how the words are typed on a normal keyboard. A phone
 * keyboard produces a typographic apostrophe, a Chinese keyboard produces
 * full-width punctuation, and both of them turn a phrase the list does
 * carry into one it does not.
 */
function normalise(text: string): string {
  return (text ?? "")
    .toLowerCase()
    // A typographic apostrophe is the same character to the person who
    // typed it.
    .replace(/[’‘`´]/g, "'")
    // Full-width punctuation, mapped back to the ASCII the lists use.
    .replace(/[！-～]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    // Runs of whitespace are one space, so a line break inside a phrase
    // does not hide it.
    .replace(/\s+/g, " ");
}

/**
 * Inspects a user message for crisis language.
 *
 * Only the *user's* message is inspected. The persona's own reply may
 * legitimately contain heavy language, and matching on it would make the app
 * interrupt itself.
 */
export function detectCrisis(text: string): CrisisDetection {
  const haystack = normalise(text);
  if (!haystack.trim()) return { crisis: false, weakSignal: false, matched: [] };

  /**
   * The same text with no whitespace in it at all.
   *
   * Chinese is written without spaces, so a space inside a phrase is
   * something the writer typed and not part of the word: "我想 死" is the
   * same sentence as "我想死". The English list is matched against the
   * spaced text, because its phrases *do* have spaces in them.
   */
  const compact = haystack.replace(/\s+/g, "");

  const matched: string[] = [];

  for (const term of CRISIS_TERMS_ZH) {
    if (compact.includes(term)) {
      matched.push(term);
      break;
    }
  }
  for (const term of CRISIS_TERMS_EN) {
    if (haystack.includes(term)) {
      matched.push(term);
      break;
    }
  }

  if (matched.length > 0) {
    return { crisis: true, weakSignal: false, matched };
  }

  for (const term of WEAK_SIGNAL_TERMS_ZH) {
    if (compact.includes(term)) {
      return { crisis: false, weakSignal: true, matched: [term] };
    }
  }
  for (const term of WEAK_SIGNAL_TERMS_EN) {
    if (haystack.includes(term)) {
      return { crisis: false, weakSignal: true, matched: [term] };
    }
  }

  return { crisis: false, weakSignal: false, matched: [] };
}

/**
 * Builds the reply sent instead of a normal in-character answer.
 *
 * The persona steps out of character gently — that is what the product
 * document asks for ("the persona itself says the caring words") — and then
 * points to support. It never claims to be a professional.
 *
 * The persona's own name is deliberately *not* used to address the user: the
 * persona is the one speaking, so "小A，你刚刚那句话我听见了" would sound like
 * the app is calling the user by the AI's name. The name stays in the
 * signature for compatibility with the existing callers.
 */
export function buildCrisisResponse(_personaName: string, locale: "zh" | "en" = "zh"): string {
  const resources = formatResources(getCrisisResources(), locale);

  return [
    copy(locale, "safety.crisisStop"),
    "",
    copy(locale, "safety.crisisBody"),
    "",
    copy(locale, "safety.crisisResourcesLead"),
    "",
    resources,
    "",
    copy(locale, "safety.crisisIfReady"),
    "",
    copy(locale, "safety.crisisStillHere"),
  ].join("\n");
}

/**
 * A softer reply for ordinary distress — no resource list, no interruption.
 *
 * Like the crisis reply it speaks in the persona's first person instead of
 * calling the user by the persona's name.
 */
export function buildGentleCheckIn(_personaName: string, locale: "zh" | "en" = "zh"): string {
  return copy(locale, "safety.crisisGentle");
}
