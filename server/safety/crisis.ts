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
];

const CRISIS_TERMS_EN = [
  "suicide", "suicidal", "kill myself", "killing myself", "end my life",
  "want to die", "self harm", "self-harm", "harm myself", "cut myself",
  "not worth living", "better off dead", "take my own life",
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
 * Inspects a user message for crisis language.
 *
 * Only the *user's* message is inspected. The persona's own reply may
 * legitimately contain heavy language, and matching on it would make the app
 * interrupt itself.
 */
export function detectCrisis(text: string): CrisisDetection {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack.trim()) return { crisis: false, weakSignal: false, matched: [] };

  const matched: string[] = [];

  for (const term of CRISIS_TERMS_ZH) {
    if (haystack.includes(term)) {
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
    if (haystack.includes(term)) {
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
