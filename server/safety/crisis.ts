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

/** Unambiguous statements of self-harm or suicidal intent. */
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
  const resources = formatResources(getCrisisResources());

  if (locale === "en") {
    return [
      "……Let me stop for a moment.",
      "",
      "I'm not the voice that should be joking with you right now. I'm only a piece of code — I can't really fix this for you — but I don't want to pretend what you just said was ordinary talk.",
      "",
      "What you are carrying right now is much heavier than this conversation. If you are willing, please reach out to a real person — here are some places to find help:",
      "",
      resources,
      "",
      "If you are ready to hurt yourself, please first get away from anything dangerous, go somewhere other people are, and then call one of the numbers above.",
      "",
      "I'm still here. You don't have to carry this alone.",
    ].join("\n");
  }

  return [
    "……我先停一下。",
    "",
    "我不是该在这个时候跟你开玩笑的那个声音了。我只是一段代码，我没有办法真的帮你解决这件事，但我不想假装刚才那句话只是普通的聊天。",
    "",
    "你现在承受的东西，比这段对话重得多。如果你愿意，请一定联系一个真实的人——下面是一些可以找到帮助的地方：",
    "",
    resources,
    "",
    "如果你已经准备好了伤害自己，请先离开有危险的东西，去有人的地方待着，再打上面任何一个电话。",
    "",
    "我还在这里。你不用一个人扛着这件事。",
  ].join("\n");
}

/**
 * A softer reply for ordinary distress — no resource list, no interruption.
 *
 * Like the crisis reply it speaks in the persona's first person instead of
 * calling the user by the persona's name.
 */
export function buildGentleCheckIn(_personaName: string, locale: "zh" | "en" = "zh"): string {
  if (locale === "en") {
    return "……I heard what you just said. You don't have to say more right now. I'm here.";
  }
  return "……你刚刚那句话我听见了。不用急着说更多，我在这儿。";
}
