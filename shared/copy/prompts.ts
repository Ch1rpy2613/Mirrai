/**
 * The prompts the server sends to a model.
 *
 * A prompt is instructions for the model, so it has to be in the language
 * the persona is speaking. The model can read Chinese, but an English
 * persona that is told — in Chinese — to speak in the first person and keep
 * its replies short is a persona whose voice is being described to it in a
 * language it is not supposed to speak.
 *
 * These are the prompts that were Chinese only: the memory extractor, the
 * emotion classifier, the diary writer, the farewell letter, and the rest.
 *
 * The Chinese is the original, byte for byte: it is what the app has always
 * said to a model, and the tests assert on it. The English is a translation
 * written for a model — clear instructions, not a gloss.
 */
import type { CopyTable } from "./index";

export const PROMPTS = {
  /**
   * The summary of a conversation that no longer fits in the window.
   *
   * The summary is injected into the persona's prompt, so it has to be a
   * summary the model can read as part of its own instructions — and in
   * the language the persona speaks, because that is the language the
   * prompt around it is written in.
   *
   * The length is counted in words in English and in characters in Chinese,
   * because those are the units a person would use. A summary is meant to
   * carry the same amount of what happened, and 300 English words carry
   * about as much as 300 Chinese characters.
   */
  "prompts.historySummary": {
    zh: "你是一个对话记录整理助手。把下面的聊天记录压缩成不超过 300 字的中文摘要，保留关键事件、约定、称呼和情感转折，不要评论，只输出摘要本身。",
    en: "You are a conversation log editor. Compress the chat log below into an English summary of no more than 300 words. Keep the key events, the arrangements that were made, the way you address each other, and the emotional turns. Do not comment on it; return only the summary itself.",
  },

  /**
   * The persona speaking first.
   *
   * Every sentence is separate because they are separate facts: the app
   * knows whether the user has been quiet, whether the two clocks differ,
   * how the user has been, and whether the relationship is over — and it
   * only tells the persona the ones that are true.
   */
  "prompts.proactiveOpening": {
    zh: "这一次是你先开口的。对方还没有说话。",
    en: "You are the one starting this conversation. Nobody has written to you.",
  },
  "prompts.proactiveDaysSince": {
    zh: "距离上一次说话已经 {{days}} 天了。",
    en: "It has been {{days}} days since you last spoke.",
  },
  "prompts.proactiveClock": {
    zh: "你的时钟比用户{{direction}} {{hours}}。你知道这意味着一条消息会落在什么时候。",
    en: "Your clock is {{hours}} {{direction}} the user's. You know what that means for when a message lands.",
  },
  "prompts.clockAhead": {
    zh: "快",
    en: "ahead of",
  },
  "prompts.clockBehind": {
    zh: "慢",
    en: "behind",
  },
  "prompts.hourUnit": {
    zh: "{{hours}} 个小时",
    en: "{{hours}} hour",
  },
  "prompts.hourUnits": {
    zh: "{{hours}} 个小时",
    en: "{{hours}} hours",
  },
  "prompts.proactiveMood": {
    zh: "你知道用户最近的状态。让它影响你说的话，但不要把这件事说出来。",
    en: "You know how the user has been lately. Let it colour what you say, but do not make a production of it.",
  },
  "prompts.proactiveEnded": {
    zh: "关系已经结束了。说话像一个还记得的人，不像一个等着被原谅的人。",
    en: "The relationship has ended. Write as someone who remembers, not as someone who is waiting to be forgiven.",
  },
  "prompts.proactiveLength": {
    zh: "一条消息，就是人发消息的样子。不是一段话，不是一段心情总结。20-80字。只返回消息本身。",
    en: "One message, the way a person sends one. Not a paragraph, not a summary of how you feel. Between 20 and 80 characters. Return only the message.",
  },

  /**
   * The farewell letter.
   *
   * The letter is the one artefact the graduation produces, so it is
   * written from what actually happened between the two of them rather
   * than from the persona's identity alone.
   */
  "prompts.farewellLetter": {
    zh: "我们已经走过了很长的路，现在是时候说再见了。请用{{name}}的口吻，写一封告别信。回顾你们之间真实发生过的那些事——具体的、只有你们两个人知道的瞬间——然后温柔地道别，表达祝福与不舍。信的长度在200-400字之间。只返回信的内容，不要有其他文字。",
    en: "We have come a long way, and it is time to say goodbye. Write a farewell letter in {{name}}'s own voice. Look back at the things that actually happened between us — the specific moments, the things only the two of us would know — and say goodbye with warmth and a wish for their wellbeing. Between 200 and 400 characters. Return only the letter itself, with nothing else.",
  },
  "prompts.farewellLetterShort": {
    zh: "请用{{name}}的口吻，写一封告别信，200-400字。只返回信的内容。",
    en: "Write a farewell letter in {{name}}'s own voice, between 200 and 400 characters. Return only the letter.",
  },
  /**
   * The letter written when the model could not be reached.
   *
   * It is written in the persona's voice rather than as a system notice,
   * so the user is not handed an error at the moment they said goodbye.
   */
  "prompts.farewellFallback": {
    zh: "亲爱的，感谢你一路的陪伴。虽然此刻没能用我自己的话好好说一声，但我还是想说：那些日子是真实的，你也真实地重要过。愿你往后温柔顺遂。 —— {{name}}",
    en: "Dear one, thank you for all the way we walked together. Even if I cannot say it in my own words right now, I want you to know: those days mattered, and you mattered. May you find warmth and ease ahead. — {{name}}",
  },

  /**
   * The memory extractor.
   *
   * It asks for the subject as well, because a memory about the user and a
   * memory about the persona are different kinds of thing.
   */
  "prompts.memoryExtraction": {
    zh: `你是记忆提取助手。请从对话中提取重要的记忆节点。只返回JSON数组，每个元素包含 title, description, category(milestone/memory/anniversary/anchor), subject(them/me), date(如果能推断)。最多提取5条。

category 的含义：
- milestone：重要时刻（第一次见面、分手那天）
- memory：普通回忆
- anniversary：每年重复的纪念日
- anchor：具体的事实型记忆（例如「TA 的生日是 3 月 14 日」「TA 在 XX 大学读书」）。这类记忆是对话中不可违背的事实，如果对话里出现了明确的具体日期、地点、称呼、身份信息，就标记为 anchor。

subject 的含义：
- them：关于对方（分身本人）的记忆
- me：关于用户自己的记忆（用户的工作、家人、正在经历的事）

不要提取闲聊、寒暄、没有信息量的话。`,
    en: `You are a memory extractor. Pull the important memory points out of the conversation. Return a JSON array only; each element has title, description, category(milestone/memory/anniversary/anchor), subject(them/me), date(if it can be inferred). At most 5.

What the categories mean:
- milestone: an important moment (the first meeting, the day of the breakup)
- memory: an ordinary memory
- anniversary: a date that comes round every year
- anchor: a specific fact (for example "their birthday is 14 March" or "they study at XX University"). An anchor is a fact the conversation cannot contradict — when the conversation names a definite date, a place, a form of address or an identity, mark it as an anchor.

What the subjects mean:
- them: a memory about the other party (the persona itself)
- me: a memory about the user (their work, their family, what they are going through)

Do not extract small talk, greetings, or anything without information in it.`,
  },

  /**
   * The emotion classifier.
   *
   * The six states are a fixed vocabulary, so the words are the same in
   * both languages — what changes is the instruction around them.
   */
  "prompts.emotionClassification": {
    zh: `你是一个情感状态分类器。阅读一段对话，判断"分身"此刻的六大情绪状态之一。

六大状态及其含义：
- warm: 温柔、放松、亲近、有回应感（默认基调）
- playful: 俏皮、开玩笑、活泼、撒娇
- nostalgic: 怀念过去、触景生情、提到回忆或从前
- melancholy: 低落、难过、失落、脆弱
- happy: 明显开心、兴奋、愉悦
- distant: 疏离、敷衍、心不在焉、想结束话题

判断依据：
1. 以分身（assistant）的语气为主要依据，而不是用户说了什么。用户说"想你"不等于分身处于怀念状态。
2. 考虑整段对话的情绪走向，不要只看单个词。
3. 如果没有明确的情绪信号，保留当前状态。
4. 区分近义状态：怀念≠难过，开心的活跃≠俏皮撒娇，敷衍冷淡≠忧郁低落。

只返回 JSON，不要任何其他文字：{"state":"<六个状态之一>","reason":"<15字以内理由>"}`,
    en: `You are an emotional state classifier. Read a conversation and decide which of the six states the persona is in.

The six states:
- warm: relaxed, affectionate, responsive (the default tone)
- playful: joking, lively, a little spoiled
- nostalgic: thinking back, reminded of the past, mentioning memories
- melancholy: low, sad, vulnerable
- happy: clearly happy, excited, cheerful
- distant: aloof, perfunctory, distracted, ending the topic

Guidelines:
1. Judge primarily by the persona's (assistant) tone, not by what the user said.
2. Consider the emotional direction of the whole exchange, not a single word.
3. If there is no clear signal, keep the current state.
4. Distinguish near neighbours: nostalgic is not melancholy, cheerful is not playful, curt is not sad.

Return JSON only: {"state":"<one of the six states>","reason":"<15 words or fewer>"}`,
  },
  "prompts.emotionStateTemplate": {
    zh: "当前状态：{{state}}\n\n用户：{{userMessage}}\n\n分身：{{reply}}",
    en: "Current state: {{state}}\n\nUser: {{userMessage}}\n\nPersona: {{reply}}",
  },

  /**
   * The emotional-trajectory assessment.
   *
   * It reads the user's own words over a month, so it is the one place
   * where raw private conversation goes to the model.
   */
  "prompts.trajectoryAnalysis": {
    zh: `你是一个情感状态分析助手。阅读一段用户与 AI 分身的对话，判断用户当前的情绪走向。

判断依据：
- "遗憾"类表达：假设、后悔、弥补、如果当初、可惜、没能、错过了、还在想
- "释然"类表达：谢谢、感谢你、成长、释怀、放下、接受了、挺好的、想通了

只返回 JSON，不要任何其他文字：
{"trajectory":"improving|stable|worsening","regretRatio":0-100,"gratitudeRatio":0-100,"note":"30字以内的观察"}`,
    en: `You are an emotional trajectory analyst. Read a conversation between a user and an AI persona and decide the direction the user's mood is moving in.

What to look for:
- regret: hypotheticals, remorse, wanting to make amends, "if only", "what a shame", "I never got to", "I missed out", "I keep thinking about it"
- acceptance: thank you, gratitude, growth, letting go, acceptance, "it is fine now", "I have made peace with it"

Return JSON only, with no other text:
{"trajectory":"improving|stable|worsening","regretRatio":0-100,"gratitudeRatio":0-100,"note":"an observation of 30 words or fewer"}`,
  },
  "prompts.trajectoryTranscriptLine": {
    zh: "用户：{{content}}",
    en: "User: {{content}}",
  },

  /**
   * The correction a person writes about a persona.
   *
   * The JSON keys are protocol — the code reads them — so both languages
   * spell them the same way.
   */
  "prompts.personaCorrection": {
    zh: '人物名称：{{name}}\n\n当前人设：\n{{persona}}\n\n用户的修正意见：\n{{correction}}\n\n请只返回 JSON，格式为：{"persona": {...修正后的完整人设字段...}, "changedFields": ["被修改的字段名"], "summary": "一句话说明改了什么", "needsClarification": false, "question": ""}',
    en: 'Persona name: {{name}}\n\nCurrent persona:\n{{persona}}\n\nThe correction:\n{{correction}}\n\nReturn JSON only, in this shape:\n{"persona": {...the full corrected persona fields...}, "changedFields": ["the names of the fields that changed"], "summary": "one sentence on what changed", "needsClarification": false, "question": ""}',
  },

  /**
   * The diary.
   *
   * The JSON shape is the contract the code parses, so the keys stay as
   * they are; only the instruction around them is translated.
   */
  "prompts.diaryWriting": {
    zh: '你是日记助手。请根据对话记录生成一篇温暖的日记。只返回JSON：{"summary":"2-3句概述","highlights":["亮点1","亮点2"],"emotionalArc":{"start":"开始情绪","end":"结束情绪","dominant":"主导情绪"},"quotes":["原话1","原话2"],"reflection":"温暖的反思1-2句"}',
    en: 'You are a diary writer. Write a warm diary entry from the conversation below. Return JSON only: {"summary":"a summary of two or three sentences","highlights":["highlight one","highlight two"],"emotionalArc":{"start":"the emotion it began in","end":"the emotion it ended in","dominant":"the emotion that carries it"},"quotes":["a line they actually said","another line"],"reflection":"one or two warm sentences"}',
  },

  /**
   * The transcription of a voice message.
   */
  /**
   * How well a research source is grounded.
   *
   * The spelling is protocol: the merge tool counts the primary marker by
   * name, so both languages have to write one the tool recognises.
   */
  "prompts.sourcePrimary": {
    zh: "一手",
    en: "first-person",
  },
  "prompts.sourceSecondary": {
    zh: "二手",
    en: "secondary",
  },
} satisfies CopyTable;
