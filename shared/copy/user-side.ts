/**
 * The words the persona is given about the person it is talking to.
 *
 * These are the blocks that go into the prompt: who the person is, what
 * they have said not to mention, how the relationship stands now, and what
 * has been happening. They are not shown to the user, but they are still
 * words the app says, and the persona has to hear them in its own language.
 *
 * They used to be written as an `if` on the locale, with the Chinese on
 * one side and the English on the other. That worked, but it meant the two
 * languages could drift apart without anything noticing, and it meant the
 * words were in the code rather than in the one place the words live.
 */
import type { CopyTable } from "./index";

export const USER_SIDE = {
  // ── About the person ─────────────────────────────────────────────────────
  "userSide.heading": {
    zh: "【关于对话者】",
    en: "【About the person you are talking to】",
  },
  "userSide.talkingTo": {
    zh: "你现在在和 {{name}} 说话。",
    en: "The person you are talking to is {{name}}.",
  },
  "userSide.address": {
    zh: "称呼对方「{{address}}」。",
    en: 'Call them "{{address}}".',
  },
  "userSide.boundaries": {
    zh: "对方说过不要提起这些：{{boundaries}}。即使话题绕到那里，也避开。",
    en: "They have asked you not to bring up: {{boundaries}}. Respect that even if it comes up.",
  },
  "userSide.mood": {
    zh: "对方最近说自己{{label}}。让这一点影响你的语气——但别把这件事变成一个话题，也别主动给建议，除非对方开口问。",
    en: "They recently said they are feeling {{label}}. Let it colour how you speak — do not make a production of it, and do not offer advice unless they ask.",
  },

  // ── Where the relationship stands ────────────────────────────────────────
  "userSide.phaseHeading": {
    zh: "现在的关系状态",
    en: "Where things stand now",
  },
  "userSide.phase.together": { zh: "你们在一起", en: "you are together" },
  "userSide.phase.apart": { zh: "你们暂时分开", en: "you are apart for a while" },
  "userSide.phase.reunion": { zh: "你们复合了", en: "you got back together" },
  "userSide.phase.breakup": { zh: "你们分手了", en: "you broke up" },
  "userSide.phase.conflict": { zh: "你们还在闹别扭", en: "there is still a fight between you" },
  "userSide.phase.reconciliation": { zh: "你们和好了", en: "you made up" },
  "userSide.phase.news": { zh: "你们之间有新的消息", en: "there is news between you" },
  "userSide.phase.meetup": { zh: "你们最近见过面", en: "you met up recently" },
  "userSide.phase.triggered": { zh: "有些事还没有过去", en: "some things have not been settled" },

  // ── What has been happening ──────────────────────────────────────────────
  "userSide.eventsTitle": {
    zh: "【最近发生的事】",
    en: "【What has been happening】",
  },
  "userSide.eventsNote": {
    zh: "- 这些是对方告诉你的事。你已经知道了，不用对方再说一遍。",
    en: "- These are things the user told you. You know them, and you do not have to be told twice.",
  },
  "userSide.triggeredRestraint": {
    zh: "- 用户现在难受。只承认这件事，就到这里。不要追问细节，不要给建议，不要劝放下，也不要自己把话题拉回过去。",
    en: "- The user is hurting. Acknowledge it and stop there. Do not ask what happened, do not offer advice, do not encourage them to let go, and do not bring the past up yourself.",
  },

  // ── When it happened ─────────────────────────────────────────────────────
  "userSide.when.today": { zh: "今天", en: "today" },
  "userSide.when.yesterday": { zh: "昨天", en: "yesterday" },
  "userSide.when.daysAgo": { zh: "{{days}} 天前", en: "{{days}} days ago" },
  "userSide.when.weekAgo": { zh: "{{weeks}} 周前", en: "{{weeks}} week ago" },
  "userSide.when.weeksAgo": { zh: "{{weeks}} 周前", en: "{{weeks}} weeks ago" },

  // ── When they cannot reach each other ────────────────────────────────────
  "userSide.unreachable": {
    zh: "【你们现在联系不上】\n- 你们暂时联系不上。说话要像写信，不像发消息：多想一点，少问几句，不要假设对方已经看到了。\n- 不要问 TA 什么时候回来。TA 回来的时候自然会回来。",
    en: "【You cannot reach each other right now】\n- The two of you are out of touch. Write like a letter, not a text message: more considered, fewer questions, and no assumption that anything was read.\n- Do not ask when they will be back. They will come back when they come back.",
  },

  // ── The letter that was left for the persona ─────────────────────────────
  //
  // The length is in characters in both languages, which is what the
  // prompt has always asked for: the number is the same, the unit is not,
  // and changing the unit would change how long the letters are.
  "letters.inboundPrompt": {
    zh: "有人给你写了一封信。这不是一条消息——是一封信，是认真写下来的。",
    en: "Someone you know has written you a letter. It is not a message — it is a letter, and it was written carefully.",
  },
  "letters.answerPrompt": {
    zh: "请以{{personaName}}的口吻回信。用信的方式回，把信才说得清的事说出来。150-350字。只返回信的内容。",
    en: "Answer it as {{personaName}}, in a letter back. Take your time; say the things a letter is for. Between 150 and 350 characters. Return only the letter.",
  },
  "letters.answerPromptEnded": {
    zh: "请以{{personaName}}的口吻回信。用信的方式回，把信才说得清的事说出来。150-350字。只返回信的内容。这封信寄到的时候，你们已经走远了——回信是回信，不要假装还在一起。",
    en: "Answer it as {{personaName}}, in a letter back. Take your time; say the things a letter is for. Between 150 and 350 characters. Return only the letter. This letter arrived after the two of you had drifted apart — answer it as an answer, and do not pretend you are still together.",
  },

  // ── The time of day, on their clock ──────────────────────────────────────
  "labels.time.dawn": { zh: "凌晨", en: "early morning" },
  "labels.time.morning": { zh: "上午", en: "morning" },
  "labels.time.afternoon": { zh: "下午", en: "afternoon" },
  "labels.time.evening": { zh: "晚上", en: "evening" },
} satisfies CopyTable;
