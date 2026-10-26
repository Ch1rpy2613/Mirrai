/**
 * What the conversation channels say.
 *
 * These arrive on a phone, in a chat window, next to the messages the
 * person is actually there to read. They are the most personal strings
 * in the app, and they were Chinese only — so an English user typing
 * `/use Ann` into Feishu was answered in Chinese.
 *
 * The language follows the person: the command they typed decides the
 * language of the reply.
 */
import type { CopyTable } from "./index";

export const CHANNELS = {
  "channels.commandHelp": {
    zh: [
      "可用指令：",
      "/使用 <分身名> — 切换当前对话的分身",
      "/分身列表 — 查看所有可用分身",
      "/当前分身 — 查看当前正在对话的分身",
      "/毕业 — 生成告别信并完成毕业",
    ].join("\n"),
    en: [
      "Commands:",
      "/use <name> — switch to another persona",
      "/personas — list your personas",
      "/current — show who you are talking to",
      "/graduate — write the farewell letter and graduate",
    ].join("\n"),
  },
  "channels.useUsage": {
    zh: "用法：/使用 <分身名>。\n{{help}}",
    en: "Usage: /use <name>\n{{help}}",
  },
  "channels.noReadyPersona": {
    zh: "还没有可以对话的分身，请先在网页端完成解析。",
    en: "There is no persona to talk to yet — finish the analysis on the web first.",
  },
  "channels.ambiguousPersona": {
    zh: "有多个分身匹配「{{query}}」：{{candidates}}。请说得更具体一些。",
    en: "Several personas match “{{query}}”: {{candidates}}. Be more specific.",
  },
  "channels.personaNotFound": {
    zh: "没有找到分身「{{query}}」。可用分身：{{available}}",
    en: "No persona matches “{{query}}”. Available: {{available}}",
  },
  "channels.switchedPersona": {
    zh: "已切换到 {{name}}。",
    en: "Now talking to {{name}}.",
  },
  "channels.noPersonas": {
    zh: "你还没有创建任何分身。",
    en: "You have not created any personas yet.",
  },
  "channels.personaListHeading": {
    zh: "你的分身：",
    en: "Your personas:",
  },
  "channels.personaListCurrent": {
    zh: " ← 当前",
    en: " ← current",
  },
  "channels.personaListAnalysing": {
    zh: "（解析中）",
    en: " (analysing)",
  },
  "channels.currentPersona": {
    zh: "当前正在和 {{name}} 说话。",
    en: "You are talking to {{name}}.",
  },
  "channels.noBoundPersona": {
    zh: "当前没有绑定分身。",
    en: "No persona is bound right now.",
  },
  "channels.stillAnalysing": {
    zh: "{{name}} 还在解析中，暂时不能毕业。",
    en: "{{name}} is still being analysed, so it cannot graduate yet.",
  },
  "channels.alreadyGraduated": {
    zh: "{{name}} 已经毕业了。",
    en: "{{name}} has already graduated.",
  },
  "channels.alreadyGraduatedWithLetter": {
    zh: "{{name}} 已经毕业了。\n\n{{letter}}",
    en: "{{name}} has already graduated.\n\n{{letter}}",
  },
  "channels.graduationPostponed": {
    zh: "{{name}} 的毕业已被推迟。想清楚再回来。",
    en: "The graduation of {{name}} has been postponed. Come back when you are ready.",
  },
  "channels.graduationModeOff": {
    zh: "{{name}} 的毕业模式已关闭。",
    en: "The graduation mode is switched off for {{name}}.",
  },
  "channels.personaIsQuiet": {
    zh: "{{name}} 现在处于静默状态，暂时不聊告别。",
    en: "{{name}} is quiet right now — it is not the moment to say goodbye.",
  },
  "channels.notTimeToSayGoodbye": {
    zh: "现在还不是告别的时候：{{reason}}。\n再陪 TA 走一段吧。",
    en: "It is not time to say goodbye yet: {{reason}}.\nStay a while longer.",
  },
  "channels.letterSavedElsewhere": {
    zh: "{{letter}}\n\n（这封信已经保存了，如果{{channel}}没有显示，请在网页端查看。）",
    en: "{{letter}}\n\n(This letter has been saved — if it did not appear in {{channel}}, read it on the web.)",
  },
  "channels.channelNameWechat": {
    zh: "微信",
    en: "WeChat",
  },
  "channels.channelNameDefault": {
    zh: "当前渠道",
    en: "this channel",
  },
  "channels.noDefaultPersonaWechat": {
    zh: "还没有设置默认分身。请在网页端「设置 → 微信」里选择要对话的分身。",
    en: "No default persona is set. Choose one under Settings → WeChat on the web.",
  },
  "channels.noDefaultPersona": {
    zh: "还没有设置默认分身。请在网页端「设置」里选择要对话的分身。",
    en: "No default persona is set. Choose one in the settings on the web.",
  },
  /**
   * The note the bridge appends when a farewell is due.
   *
   * It says the same thing as the graduation hint, but in the voice of
   * the conversation rather than of a menu — so it has its own wording.
   */
  "channels.graduationNote": {
    zh: "\n\n如果哪天想好好说声再见，随时发 /毕业，我会给你写封信。",
    en: "\n\nIf you ever want to say goodbye properly, send /graduate and I'll write you a letter.",
  },
  "channels.messageFailed": {
    zh: "消息没有发出去：{{reason}}",
    en: "The message was not sent: {{reason}}",
  },
  "channels.replyFailed": {
    zh: "刚才没能说出话来，请再发一次。",
    en: "The reply could not be produced just now — please send it again.",
  },

  /** The names the channels are known by. */
  "channels.channelNameFeishu": {
    zh: "飞书",
    en: "Feishu",
  },
  "channels.channelLabelWechat": {
    zh: "微信（ClawBot）",
    en: "WeChat (ClawBot)",
  },
  "channels.noDefaultPersonaFeishu": {
    zh: "还没有设置默认分身。请在网页端「设置 → 飞书」里选择要对话的分身。",
    en: "No default persona is set. Choose one under Settings → Feishu on the web.",
  },

  /** Why the app is not offering a goodbye yet. */
  "graduation.reasonIntimacy": {
    zh: "亲密度未达到灵魂伴侣",
    en: "the closeness has not reached soulmates",
  },
  "graduation.reasonChatCount": {
    zh: "对话次数不足",
    en: "there have not been enough conversations",
  },
  "graduation.reasonEmotionData": {
    zh: "情感数据不足",
    en: "there is not enough emotional history yet",
  },
  "graduation.reasonEmotionsRising": {
    zh: "近期情绪尚未稳定向好",
    en: "the mood has not settled into something good yet",
  },
  "graduation.reasonFrequencyRising": {
    zh: "对话频率仍在增长",
    en: "the conversations are still getting more frequent",
  },
  "graduation.reasonEligible": {
    zh: "已达到毕业条件",
    en: "the conditions for a graduation are met",
  },
} satisfies CopyTable;

/**
 * The slash commands the channels understand.
 *
 * These are a protocol rather than copy: a command is a word the person
 * types, and the person decides which spelling to use. Both spellings
 * work, in both languages, and the reply follows the language of the
 * command that was typed.
 *
 * They live here rather than in the copy table because a copy entry is a
 * sentence, and a command is not read — it is matched.
 */
export const CHANNEL_COMMANDS = {
  use: { zh: "/使用", en: "/use" },
  personas: { zh: "/分身列表", en: "/personas" },
  current: { zh: "/当前分身", en: "/current" },
  graduate: { zh: "/毕业", en: "/graduate" },
  help: { zh: "/帮助", en: "/help" },
} as const;
