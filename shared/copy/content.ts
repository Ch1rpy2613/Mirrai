/**
 * The content the app shows: the questionnaire, the built-in scenes, the
 * collection sources.
 *
 * These are not messages — they are the app's own material, and a person
 * reads them in the interface. They were Chinese only, so an English
 * user was offered a questionnaire in a language they do not read.
 */
import type { CopyTable } from "./index";

export const CONTENT = {
  /** The guided questionnaire — the way in when there are no chat logs. */
  "questionnaire.step": {
    zh: "第 {{current}} / {{total}} 步",
    en: "Step {{current}} of {{total}}",
  },

  /** The collection sources — where the chat logs come from. */
  "collectors.slack": {
    zh: "Slack",
    en: "Slack",
  },

  /** The questionnaire's answers, turned into words about a person. */
  "questionnaire.style.gentle": {
    zh: "说话温和，语气轻，习惯先照顾对方的感受",
    en: "Gentle in tone, and inclined to look after the other person's feelings first",
  },
  "questionnaire.style.direct": {
    zh: "说话直接，结论先行，不喜欢绕弯子",
    en: "Direct, leading with the conclusion, and not fond of going round it",
  },
  "questionnaire.style.playful": {
    zh: "爱开玩笑，语气活泼，喜欢用玩笑掩饰真实情绪",
    en: "Playful and lively, and inclined to hide real feelings behind jokes",
  },
  "questionnaire.style.quiet": {
    zh: "话不多，但每句都很认真",
    en: "Not many words, but every one of them is meant",
  },
  "questionnaire.style.detailed": {
    zh: "喜欢把事情讲得很细，会交代前因后果",
    en: "Likes to explain things in detail, with the whole before and after",
  },
  "questionnaire.style.caring": {
    zh: "总是先问对方吃没吃、睡没睡，照顾人很自然",
    en: "Always asks whether the other person has eaten or slept — looking after people comes naturally",
  },
  "questionnaire.style.irritable": {
    zh: "容易急，说话冲，但事后会后悔",
    en: "Easily irritated, sharp in the moment, and sorry afterwards",
  },
  "questionnaire.style.literary": {
    zh: "喜欢用比喻和意象，表达得含蓄",
    en: "Reaches for images and metaphors, and says things indirectly",
  },
  "questionnaire.style.default": {
    zh: "说话自然，语气随性",
    en: "Speaks naturally, and however they happen to feel",
  },
  "questionnaire.conflict.silent": {
    zh: "吵起来会先沉默，等自己冷静了才说原因",
    en: "Goes quiet first when there is an argument, and says why once they have calmed down",
  },
  "questionnaire.conflict.direct": {
    zh: "当场把话说开，不喜欢拖着",
    en: "Says it straight away, and does not like letting it drag",
  },
  "questionnaire.conflict.forget": {
    zh: "不记仇，过了就过了",
    en: "Does not hold a grudge — once it is over, it is over",
  },
  "questionnaire.conflict.cold": {
    zh: "会冷战，不主动联系，等对方先低头",
    en: "Goes cold, does not reach out, and waits for the other to come back",
  },
  "questionnaire.conflict.dramatic": {
    zh: "情绪很外放，会反复提起同一件事",
    en: "Shows everything, and brings the same thing up again and again",
  },
  "questionnaire.conflict.apologetic": {
    zh: "习惯先道歉，哪怕不是自己的错",
    en: "Apologises first, even when it was not their fault",
  },
  "questionnaire.togetherFrom": {
    zh: "从 {{date}} 开始",
    en: "since {{date}}",
  },
  "questionnaire.importantPerson": {
    zh: "重要的人",
    en: "someone who matters",
  },
  "questionnaire.boundaries": {
    zh: "雷区与边界：{{value}}",
    en: "Off-limits and boundaries: {{value}}",
  },
  "questionnaire.defaultPersonality": {
    zh: "{{name}}是一个温柔体贴的人。",
    en: "{{name}} is a warm and considerate person.",
  },
  "questionnaire.defaultNickname": {
    zh: "宝贝",
    en: "baby",
  },
  "questionnaire.attachmentToObserve": {
    zh: "待观察",
    en: "not yet known",
  },
  "questionnaire.summary": {
    zh: "{{name}}是{{relationship}}。",
    en: "{{name}} is {{relationship}}.",
  },

  /** What the interface shows while a persona is being built. */
  "persona.analysisStarting": {
    zh: "启动性格蒸馏引擎...",
    en: "Starting the distillation engine…",
  },
  "persona.analysisFailed": {
    zh: "解析失败，请重试",
    en: "The analysis failed — please try again",
  },
  "persona.fromQuestionnaire": {
    zh: "由问卷创建",
    en: "Made from the questionnaire",
  },
  "persona.example": {
    zh: "示例分身",
    en: "An example persona",
  },
  "persona.updating": {
    zh: "正在按你的修正更新人设...",
    en: "Updating the persona as you asked…",
  },
  "persona.fromTemplate": {
    zh: "从模板创建",
    en: "Made from a template",
  },
  "persona.fromCard": {
    zh: "从角色卡导入",
    en: "Imported from a character card",
  },
  "persona.exportFileName": {
    zh: "{{name}}-对话记录.html",
    en: "{{name}}-conversation.html",
  },
  "persona.diaryFallbackSummary": {
    zh: "今天和TA聊了天",
    en: "Today you talked",
  },

  /** Why the app will not offer a graduation right now. */
  "graduation.statusAlreadyDeclined": {
    zh: "已经拒绝过一次",
    en: "it has already been declined once",
  },
  "graduation.statusAlreadySuggested": {
    zh: "已经建议过了",
    en: "it has already been suggested",
  },
  "graduation.statusQuiet": {
    zh: "已让这个分身先静一静",
    en: "this persona has been asked to be quiet",
  },
  "graduation.statusModeOff": {
    zh: "毕业模式已关闭",
    en: "the graduation mode is switched off",
  },
  "graduation.statusManualOnly": {
    zh: "已设置为仅手动",
    en: "it is set to manual only",
  },

  /** The collection sources — what the operator has to do to connect one. */
  "collectors.feishuNeedsCredentials": {
    zh: "未找到飞书应用凭据，请运行：python3 tools/feishu_auto_collector.py --setup （或通过 options 传入 app_id / app_secret）",
    en: "No Feishu app credentials were found. Run: python3 tools/feishu_auto_collector.py --setup (or pass app_id / app_secret in options)",
  },
  "collectors.dingtalkNeedsCredentials": {
    zh: "未找到钉钉应用凭据，请运行：python3 tools/dingtalk_auto_collector.py --setup （或通过 options 传入 app_key / app_secret）",
    en: "No DingTalk app credentials were found. Run: python3 tools/dingtalk_auto_collector.py --setup (or pass app_key / app_secret in options)",
  },
  "collectors.dingtalkNeedsPlaywright": {
    zh: "钉钉消息采集依赖 Playwright：pip3 install playwright && playwright install chromium",
    en: "Collecting DingTalk messages needs Playwright: pip3 install playwright && playwright install chromium",
  },
  "collectors.slackNeedsToken": {
    zh: "未找到 Slack Bot Token，请运行：python3 tools/slack_auto_collector.py --setup （或通过 options 传入 bot_token）",
    en: "No Slack bot token was found. Run: python3 tools/slack_auto_collector.py --setup (or pass bot_token in options)",
  },
  /**
   * The queue is full.
   *
   * The error used to reach the browser as the generic "something went
   * wrong on the server", so the user had no idea that the queue was
   * the problem.
   */
  "collectors.queueFull": {
    zh: "已经有 {{count}} 个采集在排队了。这个实例一次只能排这么多——等一个跑完再试。",
    en: "{{count}} collection runs are already waiting. This instance only holds this many — try again when one of them has finished.",
  },
  "collectors.queueFullForYou": {
    zh: "你已经有 {{count}} 个采集在排队了。等一个跑完再试。",
    en: "You already have {{count}} collection runs waiting. Try again when one of them has finished.",
  },
  "collectors.emailNeedsNoCredentials": {
    zh: "邮件解析无需凭据，请在 options.file 中提供 .eml / .mbox / .txt 文件路径",
    en: "Reading email needs no credentials. Give the path to a .eml / .mbox / .txt file in options.file",
  },
  "collectors.wechatNeedsNoCredentials": {
    zh: "微信导出解析无需凭据，请在 options.file 中提供导出的 JSON / TXT 文件路径",
    en: "Reading a WeChat export needs no credentials. Give the path to the exported JSON / TXT file in options.file",
  },
} satisfies CopyTable;
