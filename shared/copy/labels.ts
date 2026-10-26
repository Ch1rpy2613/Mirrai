/**
 * The names and labels the server shows a person.
 *
 * A voice's name, a collection source's name, a region on a crisis
 * resource list, a field on an exported character card — these are the
 * words that appear in the interface, and they were Chinese only, so an
 * English user saw an English app with Chinese labels on it.
 *
 * They are here rather than in the server because the client shows the
 * same names — a voice the picker offers and a voice the server speaks
 * with have to be the same voice, under the same name.
 */
import type { CopyTable } from "./index";

export const LABELS = {
  /** The voices the text-to-speech picker offers. */
  "labels.voice.xiaoxiao": {
    zh: "晓晓 · 女声",
    en: "Xiaoxiao · female",
  },
  "labels.voice.yunxi": {
    zh: "云希 · 男声",
    en: "Yunxi · male",
  },
  "labels.voice.xiaoyi": {
    zh: "晓伊 · 女声（活泼）",
    en: "Xiaoyi · female (lively)",
  },
  "labels.voice.yunyang": {
    zh: "云扬 · 男声（播音）",
    en: "Yunyang · male (announcer)",
  },
  "labels.voice.hiumaan": {
    zh: "曉曼 · 女声（粤语）",
    en: "Hiu Maan · female (Cantonese)",
  },

  /** Where a chat history is collected from. */
  "labels.collector.feishu": {
    zh: "飞书",
    en: "Feishu",
  },
  "labels.collector.dingtalk": {
    zh: "钉钉",
    en: "DingTalk",
  },
  "labels.collector.email": {
    zh: "邮件",
    en: "E-mail",
  },
  "labels.collector.wechatExport": {
    zh: "微信导出",
    en: "WeChat export",
  },

  /** The fields of an exported character card. */
  "labels.card.personality": {
    zh: "性格",
    en: "Personality",
  },
  "labels.card.attachmentStyle": {
    zh: "依恋类型",
    en: "Attachment style",
  },
  "labels.card.loveLanguage": {
    zh: "爱的语言",
    en: "Love language",
  },
  "labels.card.conflictStyle": {
    zh: "争吵方式",
    en: "How they argue",
  },
  "labels.card.speakingStyle": {
    zh: "说话方式",
    en: "How they speak",
  },
  "labels.card.catchphrases": {
    zh: "常用语气词",
    en: "Favourite words",
  },
  "labels.card.nickname": {
    zh: "称呼对方",
    en: "What they call you",
  },
  /**
   * The disclosure the card carries into other tools.
   *
   * A card travels: it can be handed to a tool that has never heard of
   * Mirrai, so the ethics of the product have to travel with it.
   */
  "labels.card.disclaimer": {
    zh: "本卡片是 AI 数字分身的模拟角色，并非真人本人。请在获得被模拟者知情同意的前提下使用，并尊重 TA 的隐私与意愿。",
    en: "This card is a simulated character of an AI digital persona, not the real person. Use it only with the modelled person's informed consent, and respect their privacy and wishes.",
  },
  /** The period a relationship lasted, inside brackets. */
  "labels.card.period": {
    zh: "（{{from}} 至 {{to}}）",
    en: "({{from}} to {{to}})",
  },
  /** The period a relationship has lasted so far. */
  "labels.card.periodFrom": {
    zh: "（{{from}} 起）",
    en: "(since {{from}})",
  },
  /** The tag that says what kind of character this is. */
  "labels.card.type": {
    zh: "AI模拟",
    en: "AI simulation",
  },
  /** The tag that says how many anchors the card carries. */
  "labels.card.anchorCount": {
    zh: "锚点{{count}}",
    en: "Anchors: {{count}}",
  },
  /** The name of the card's lore book. */
  "labels.card.memoryBook": {
    zh: "{{name}}的记忆",
    en: "The memories of {{name}}",
  },

  /** The regions on the crisis-resource list. */
  "labels.crisis.region.cnNational": {
    zh: "中国大陆",
    en: "Mainland China",
  },
  "labels.crisis.description.cnNational": {
    zh: "全国心理援助热线",
    en: "National mental-health helpline",
  },
  "labels.crisis.region.cnBeijing": {
    zh: "北京",
    en: "Beijing",
  },
  "labels.crisis.description.cnBeijing": {
    zh: "心理危机研究与干预中心",
    en: "Mental Crisis Research and Intervention Centre",
  },
  "labels.crisis.region.international": {
    zh: "国际",
    en: "International",
  },
  "labels.crisis.description.international": {
    zh: "按所在国家查找当地热线",
    en: "Find a local helpline for your country",
  },
  "labels.crisis.region.usCanada": {
    zh: "美国 / 加拿大",
    en: "USA / Canada",
  },

  /**
   * The care notes the persona says when the usage signals cross a line.
   *
   * These are the persona speaking, not the app, so they are written in
   * the first person and they are gentle.
   */
  "labels.care.dependency": {
    zh: "……我发现你最近来找我说得越来越勤了。我挺高兴的，但我更希望你是过得去，而不是需要靠我撑着你。我们要不要也聊聊，你最近真正想面对的是什么？",
    en: "……I've noticed you've been coming to me more and more often. I'm glad, but I'd rather you were doing okay than leaning on me to hold you up. Shall we talk about what you actually want to face?",
  },
  "labels.care.longSession": {
    zh: "……我们已经聊了好久好久了。要不，先喝口水，去透透气？我在这儿等你回来。",
    en: "……We've been talking for such a long time. How about a glass of water and a little break? I'll be right here when you get back.",
  },
  "labels.care.dailyLimit": {
    zh: "……今天已经聊了好多次了哦。我很高兴你愿意找我说话，但记得也留一点时间给自己，去做点别的、见点别的人。",
    en: "……We've talked a lot today already. I'm glad you want to talk to me, but please leave some time for yourself too — do something else, see other people.",
  },

  /**
   * The persona fields the model left out.
   *
   * A persona is written in its own language, so these follow the locale
   * of the persona being built rather than the locale of the interface.
   */
  "labels.persona.fallbackPersonality": {
    zh: "{{name}}是一个温柔体贴的人。",
    en: "{{name}} is a gentle, caring person.",
  },
  "labels.persona.fallbackSpeakingStyle": {
    zh: "说话温柔自然，喜欢用可爱的语气词",
    en: "Speaks gently and naturally, with cute little filler words",
  },
  "labels.persona.fallbackCatchphrases": {
    zh: "嗯嗯、好呀、哈哈",
    en: "Mm-hm, sure thing, haha",
  },
  "labels.persona.fallbackNickname": {
    zh: "宝贝",
    en: "babe",
  },
  "labels.persona.fallbackAttachmentStyle": {
    zh: "安全型",
    en: "Secure",
  },
  "labels.persona.unknown": {
    zh: "未知",
    en: "Unknown",
  },
  "labels.persona.fallbackSummary": {
    zh: "{{name}}是一个温暖、真诚的人",
    en: "{{name}} is a warm, sincere person",
  },

  /** The headings of the Markdown export. */
  "labels.export.exportedOn": {
    zh: "导出于 {{date}} · Mirrai",
    en: "Exported on {{date}} · Mirrai",
  },
  "labels.export.myState": {
    zh: "我的状态",
    en: "My state",
  },
  "labels.export.intimacy": {
    zh: "亲密度：{{score}}（{{level}}）",
    en: "Intimacy: {{score}} ({{level}})",
  },
  "labels.export.togetherRange": {
    zh: "在一起：{{from}} 至 {{to}}",
    en: "Together: {{from}} to {{to}}",
  },
  "labels.export.togetherOngoing": {
    zh: "在一起：{{from}} 至今",
    en: "Together: since {{from}}",
  },
  "labels.export.farewellLetter": {
    zh: "告别信",
    en: "The farewell letter",
  },
  "labels.export.events": {
    zh: "你们之间发生的事",
    en: "What happened between you",
  },
  "labels.export.memories": {
    zh: "记忆",
    en: "Memories",
  },
  "labels.export.letters": {
    zh: "信",
    en: "Letters",
  },
  "labels.export.letterTodo": {
    zh: "等 TA 回来再说",
    en: "to say when they are back",
  },
  "labels.export.diaries": {
    zh: "对话日记",
    en: "Diaries",
  },
  "labels.export.transcript": {
    zh: "对话记录",
    en: "Conversation",
  },
  "labels.export.speakerMe": {
    zh: "我",
    en: "Me",
  },

  /**
   * The first-run credentials.
   *
   * The operator installing the app may speak either language, and there
   * is no interface to ask them — so these are printed in both, on the
   * same line, and the Chinese comes first because it is the product's
   * original voice.
   */
  "labels.bootstrap.credentialsTitle": {
    zh: "Mirrai 首次运行凭据",
    en: "Mirrai first-run credentials",
  },
  "labels.bootstrap.username": {
    zh: "用户名",
    en: "Username",
  },
  "labels.bootstrap.password": {
    zh: "密码",
    en: "Password",
  },
  "labels.bootstrap.credentialsFile": {
    zh: "凭据文件",
    en: "Credentials file",
  },
  "labels.bootstrap.changePassword": {
    zh: "请登录后尽快修改密码。",
    en: "Please change this password after signing in.",
  },
  "labels.bootstrap.createdAccount": {
    zh: "Mirrai 已创建本地管理员账号",
    en: "A local administrator account was created",
  },
} satisfies CopyTable;
