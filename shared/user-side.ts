/**
 * The user's side of the relationship.
 *
 * The app was built to rebuild a person: their tone, their habits, their
 * history. It was never built to know the person who is talking to that
 * rebuild. Every table scoped by `userId` was a permission key, not a
 * description of a human being.
 *
 * These are the pieces that make the user a person the app knows: how they
 * want to be addressed, what they no longer want to hear about, and how
 * they have been doing.
 */

/**
 * How the user has been doing.
 *
 * These are the user's own, and they are deliberately not the persona's
 * six states. The persona's moods are what the app infers from the
 * conversation; these are what the user says about themselves.
 */
export type UserMood = "great" | "okay" | "low" | "down" | "anxious" | "numb";

export const USER_MOODS: readonly UserMood[] = [
  "great",
  "okay",
  "low",
  "down",
  "anxious",
  "numb",
];

export const DEFAULT_USER_MOOD: UserMood = "okay";

export function isUserMood(value: unknown): value is UserMood {
  return (
    typeof value === "string" && (USER_MOODS as readonly string[]).includes(value)
  );
}

/**
 * The user's own state, and how the persona should read it.
 *
 * The wording matters: the persona is not a therapist reading a chart, and
 * it is not a nurse checking a triage score. It is the person who knows
 * the user, noticing how they are.
 */
export const USER_MOOD_LABELS: Record<UserMood, { zh: string; en: string }> = {
  great: { zh: "很好", en: "great" },
  okay: { zh: "还行", en: "okay" },
  low: { zh: "有点低落", en: "a bit low" },
  down: { zh: "很难过", en: "really down" },
  anxious: { zh: "有点不安", en: "anxious" },
  numb: { zh: "说不上来", en: "not sure how to describe it" },
};

/**
 * What kind of thing happened in the relationship.
 *
 * The list is the user's own vocabulary for their own life, so it is
 * short. "triggered" is the one that needs the most care: it is the user
 * saying that something reminded them of something painful.
 */
export const RELATIONSHIP_EVENT_KINDS = [
  "together",
  "apart",
  "reunion",
  "breakup",
  "conflict",
  "reconciliation",
  "news",
  "meetup",
  "triggered",
] as const;

export type RelationshipEventKind = (typeof RELATIONSHIP_EVENT_KINDS)[number];

export function isRelationshipEventKind(
  value: unknown,
): value is RelationshipEventKind {
  return (
    typeof value === "string" &&
    (RELATIONSHIP_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The kinds that mean the relationship itself has changed shape.
 *
 * The app's behaviour follows these: a breakup stops the anniversaries,
 * a reconciliation brings them back.
 */
export const RELATIONSHIP_PHASE_EVENTS: readonly RelationshipEventKind[] = [
  "together",
  "apart",
  "reunion",
  "breakup",
  "reconciliation",
];

export interface UserContext {
  /** The user's own name, if they gave one. */
  name?: string | null;
  /** How they want to be addressed. */
  addressStyle?: string | null;
  /** What the persona should not bring up. */
  boundaries?: string | null;
  /** The user's time zone, as an IANA name. */
  timezone?: string | null;
}

/**
 * The block of the system prompt that tells the persona who it is talking
 * to.
 *
 * Without it the persona knows everything about the other person and
 * nothing about the one in front of it — which is why it said "宝贝" to
 * someone who had asked to be left alone, and why it said it was
 * afternoon when the user was in the middle of the night.
 */
export function buildUserContextBlock(
  context: UserContext,
  options: { locale?: "zh" | "en"; mood?: UserMood | null } = {},
): string {
  const locale = options.locale ?? "zh";
  const parts: string[] = [];

  const name = context.name?.trim();
  const address = context.addressStyle?.trim();
  const boundaries = context.boundaries?.trim();

  if (locale === "en") {
    if (name) parts.push(`The person you are talking to is ${name}.`);
    if (address) parts.push(`Call them "${address}".`);
    if (boundaries) {
      parts.push(`They have asked you not to bring up: ${boundaries}. Respect that even if it comes up.`);
    }
    if (options.mood) {
      const label = USER_MOOD_LABELS[options.mood].en;
      parts.push(
        `They recently said they are feeling ${label}. Let it colour how you speak — do not make a production of it, and do not offer advice unless they ask.`,
      );
    }
  } else {
    if (name) parts.push(`你现在在和 ${name} 说话。`);
    if (address) parts.push(`称呼对方「${address}」。`);
    if (boundaries) {
      parts.push(`对方说过不要提起这些：${boundaries}。即使话题绕到那里，也避开。`);
    }
    if (options.mood) {
      const label = USER_MOOD_LABELS[options.mood].zh;
      parts.push(
        `对方最近说自己${label}。让这一点影响你的语气——但别把这件事变成一个话题，也别主动给建议，除非对方开口问。`,
      );
    }
  }

  if (parts.length === 0) return "";
  const heading = locale === "en" ? "【About the person you are talking to】" : "【关于对话者】";
  return `${heading}\n${parts.join("\n")}`;
}

/**
 * The relationship phase, as the events record it.
 *
 * The phase used to be written once by the distillation pipeline and never
 * touched again, so a persona whose relationship had ended kept speaking
 * as if the two of them were together.
 */
export function resolveRelationshipPhase(
  events: Array<{ kind: string; happenedAt?: Date | string | null }>,
): RelationshipEventKind | null {
  const relevant = events
    .filter((event) =>
      (RELATIONSHIP_PHASE_EVENTS as readonly string[]).includes(event.kind),
    )
    .sort((a, b) => {
      const at = a.happenedAt ? new Date(a.happenedAt).getTime() : 0;
      const bt = b.happenedAt ? new Date(b.happenedAt).getTime() : 0;
      return at - bt;
    });
  const last = relevant[relevant.length - 1];
  return last ? (last.kind as RelationshipEventKind) : null;
}

/**
 * How each kind of event is described to the persona.
 *
 * The wording is the persona's own — it is told what happened, and it
 * reacts in character. The point is that the persona is not left speaking
 * from a snapshot of the relationship taken on the day it was built.
 */
const EVENT_LABELS: Record<RelationshipEventKind, { zh: string; en: string }> = {
  together: { zh: "我们在一起了", en: "we got back together" },
  apart: { zh: "我们暂时分开了", en: "we are apart for a while" },
  reunion: { zh: "我们复合了", en: "we got back together" },
  breakup: { zh: "我们分手了", en: "we broke up" },
  conflict: { zh: "我们吵了一架", en: "we had a fight" },
  reconciliation: { zh: "我们和好了", en: "we made up" },
  news: { zh: "有件事想告诉你", en: "there is something to tell you" },
  meetup: { zh: "我们见面了", en: "we met up" },
  triggered: { zh: "我今天想起了一些难受的事", en: "something painful came up today" },
};

/**
 * The block of the system prompt that tells the persona what has been
 * happening in the relationship.
 *
 * The events are the user's own record. They are presented as facts the
 * persona knows — because the user is the one who told it, and a persona
 * that does not listen to what it is told is not a persona at all.
 */
/**
 * How long a trigger stays a trigger.
 *
 * The restraint instruction has to expire. A trigger from six months
 * ago is a memory; if the instruction never expired, every message for
 * ever would carry "the user is hurting, do not push" — which is not
 * restraint, it is a permanent tone, and it would stop the persona
 * from ever being warm again.
 */
export const TRIGGER_FRESHNESS_DAYS = 3;

export function buildRelationshipSection(
  events: Array<{
    kind: string;
    title: string;
    detail?: string | null;
    happenedAt?: Date | string | null;
  }>,
  phase: RelationshipEventKind | null,
  locale: "zh" | "en" = "zh",
  now: Date = new Date(),
): string {
  if (!events || events.length === 0) return "";

  const parts: string[] = [];
  for (const event of events.slice(0, 8)) {
    const kind = isRelationshipEventKind(event.kind) ? event.kind : null;
    const label = kind ? EVENT_LABELS[kind][locale] : null;
    const when = event.happenedAt ? formatWhen(event.happenedAt, locale) : null;
    const line = label
      ? `${when ? `${when}，` : ""}${label}：${event.title}`
      : event.title;
    const detail = event.detail?.trim();
    parts.push(detail ? `- ${line}\n  ${detail}` : `- ${line}`);
  }

  if (phase) {
    const heading = locale === "en"
      ? "Where things stand now"
      : "现在的关系状态";
    const phaseLine = locale === "en"
      ? PHASE_LABELS_EN[phase]
      : PHASE_LABELS_ZH[phase];
    parts.push(`（${heading}：${phaseLine}）`);
  }

  const title = locale === "en" ? "【What has been happening】" : "【最近发生的事】";
  const note = locale === "en"
    ? "- These are things the user told you. You know them, and you do not have to be told twice."
    : "- 这些是对方告诉你的事。你已经知道了，不用对方再说一遍。";

  /**
   * The instruction for a trigger.
   *
   * "I saw them get back together" / "he blocked me" / "I saw her posts" —
   * none of these are crisis words, so a keyword list never catches them.
   * When the user says that something hurt, the persona has to do very
   * little: acknowledge it, and not push. Anything more becomes a reason
   * to keep thinking about it, which is the opposite of the point.
   */
  const triggered = events.some((event) => {
    if (event.kind !== "triggered") return false;
    if (!event.happenedAt) return true;
    const then = new Date(event.happenedAt).getTime();
    if (Number.isNaN(then)) return true;
    const days = (now.getTime() - then) / 86_400_000;
    return days <= TRIGGER_FRESHNESS_DAYS;
  });
  const restraint = triggered
    ? locale === "en"
      ? "- The user is hurting. Acknowledge it and stop there. Do not ask what happened, do not offer advice, do not encourage them to let go, and do not bring the past up yourself."
      : "- 用户现在难受。只承认这件事，就到这里。不要追问细节，不要给建议，不要劝放下，也不要自己把话题拉回过去。"
    : "";

  return `${title}\n${parts.join("\n")}\n${note}${restraint ? `\n${restraint}` : ""}`;
}

const PHASE_LABELS_ZH: Record<RelationshipEventKind, string> = {
  together: "你们在一起",
  apart: "你们暂时分开",
  reunion: "你们复合了",
  breakup: "你们分手了",
  conflict: "你们还在闹别扭",
  reconciliation: "你们和好了",
  news: "你们之间有新的消息",
  meetup: "你们最近见过面",
  triggered: "有些事还没有过去",
};

const PHASE_LABELS_EN: Record<RelationshipEventKind, string> = {
  together: "you are together",
  apart: "you are apart for a while",
  reunion: "you got back together",
  breakup: "you broke up",
  conflict: "there is still a fight between you",
  reconciliation: "you made up",
  news: "there is news between you",
  meetup: "you met up recently",
  triggered: "some things have not been settled",
};

/** A short, human date for an event. */
function formatWhen(value: Date | string, locale: "zh" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return locale === "en" ? "today" : "今天";
  if (days === 1) return locale === "en" ? "yesterday" : "昨天";
  if (days < 7) return locale === "en" ? `${days} days ago` : `${days} 天前`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return locale === "en" ? `${weeks} week${weeks > 1 ? "s" : ""} ago` : `${weeks} 周前`;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Whether the two of them can currently reach each other.
 *
 * A distance is not a breakup. The app had no way to say that, so "we
 * are apart" and "we broke up" were the same thing — and a person who
 * was simply out of touch was treated as though it were over.
 */
export type Reachability = "reachable" | "unreachable";

export const REACHABILITIES: readonly Reachability[] = ["reachable", "unreachable"];

export function isReachability(value: unknown): value is Reachability {
  return (
    typeof value === "string" &&
    (REACHABILITIES as readonly string[]).includes(value)
  );
}

/**
 * The line that goes into the prompt when the two of them are out of
 * touch.
 *
 * The register changes: somebody you cannot reach gets a letter, not a
 * text message. That is not a punishment — it is what the situation
 * actually sounds like.
 */
export function buildReachabilityNote(
  reachability: Reachability,
  locale: "zh" | "en" = "zh",
): string {
  if (reachability !== "unreachable") return "";
  return locale === "en"
    ? "【You cannot reach each other right now】\\n- The two of you are out of touch. Write like a letter, not a text message: more considered, fewer questions, and no assumption that anything was read.\\n- Do not ask when they will be back. They will come back when they come back."
    : "【你们现在联系不上】\\n- 你们暂时联系不上。说话要像写信，不像发消息：多想一点，少问几句，不要假设对方已经看到了。\\n- 不要问 TA 什么时候回来。TA 回来的时候自然会回来。";
}

/**
 * The memory ids a message recorded.
 *
 * The value is a JSON array of ids, written down when the turn happened.
 * A malformed value is treated as no memories rather than an error: it
 * is a note, not a document.
 */
export function parseRecalledIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((n) => (typeof n === "number" ? n : Number(n)))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}
