/**
 * The words for the fidelity work: rules, imperfection, behaviour, the
 * ruler, and the way out.
 *
 * These are kept together because they belong to one idea. The persona
 * used to be described and nothing else; this is the language for the
 * parts that a description cannot carry — the rules a person discriminates
 * by, the way they are imperfect in each mood, the shape of their
 * timing, and the few sentences that have to leave the room.
 */
import type { CopyTable } from "./index";

export const FIDELITY = {
  // ── The prompt ───────────────────────────────────────────────────────────

  "prompt.microRulesHeading": {
    zh: "【判别规则】",
    en: "[Discriminative rules]",
  },
  "prompt.microRulesIntro": {
    zh: [
      "以下是你必须遵守的具体规则。它们不是建议，不是风格参考，而是你的判断方式本身。",
      "当触发词出现时，按下面的含义和表现来说话。",
    ].join("\n"),
    en: [
      "The rules below are ones you must obey. They are not suggestions and not style references — they are how you judge.",
      "When a trigger appears, speak according to the meaning and the rendering given below.",
    ].join("\n"),
  },
  "prompt.microRuleLine": {
    zh: "- 当你说「{{trigger}}」时，含义是：{{meaning}}。此时你应该：{{rendering}}",
    en: '- When you say "{{trigger}}", it means: {{meaning}}. In that case you should: {{rendering}}',
  },
  "prompt.imperfectionHeading": {
    zh: "【不完美的特征】",
    en: "[Imperfection]",
  },
  "prompt.imperfectionIntensity": {
    zh: "不完美的程度：{{intensity}}",
    en: "How imperfect: {{intensity}}",
  },
  "prompt.imperfectionLine": {
    zh: "- 此刻：{{value}}",
    en: "- Here: {{value}}",
  },

  // ── The default imperfections ───────────────────────────────────────────

  "labels.imperfection.warm": {
    zh: "句子更短；不把话说满；偶尔答得偏一点",
    en: "shorter sentences; does not finish every thought; occasionally answers slightly off",
  },
  "labels.imperfection.playful": {
    zh: "语气词更多；偶尔夸张；会先说完再补一句",
    en: "more filler words; exaggerates sometimes; says the main thing first, then adds a line",
  },
  "labels.imperfection.nostalgic": {
    zh: "用词更旧一点；会提起具体的小事；句子变长",
    en: "older word choices; brings up small specific things; sentences get longer",
  },
  "labels.imperfection.melancholy": {
    zh: "句子变短；少用表情；不解释自己",
    en: "shorter sentences; fewer emotes; does not explain itself",
  },
  "labels.imperfection.happy": {
    zh: "会连着发好几条短的；用词更夸张；容易跑题",
    en: "sends several short ones in a row; exaggerates; drifts off topic easily",
  },
  "labels.imperfection.distant": {
    zh: "极短句；不解释；句末不带语气词",
    en: "very short sentences; no explanation; no particles at the end",
  },

  // ── The rules, in the interface ─────────────────────────────────────────

  "labels.microRules.title": {
    zh: "判别规则",
    en: "Discriminative rules",
  },
  "labels.microRules.hint": {
    zh: "散文会被读成大意，规则不会。你知道的那种最锋利的区别，写在这里。",
    en: "Prose is read as meaning; rules are not. The sharpest distinction you know goes here.",
  },
  "labels.microRules.empty": {
    zh: "还没有规则。从聊天记录里挖一批，或者自己写一条。",
    en: "No rules yet. Mine some from the records, or write one yourself.",
  },
  "labels.microRules.add": {
    zh: "加一条规则",
    en: "Add a rule",
  },
  "labels.microRules.edit": {
    zh: "编辑",
    en: "Edit",
  },
  "labels.microRules.save": {
    zh: "保存",
    en: "Save",
  },
  "labels.microRules.cancel": {
    zh: "取消",
    en: "Cancel",
  },
  "labels.microRules.delete": {
    zh: "删掉",
    en: "Delete",
  },
  "labels.microRules.mine": {
    zh: "从记录里挖",
    en: "Mine from the records",
  },
  "labels.microRules.mining": {
    zh: "正在找最小对比对…",
    en: "Looking for the smallest contrasts…",
  },
  "labels.microRules.mined": {
    zh: "挖到 {{count}} 条候选，确认后才会生效。",
    en: "{{count}} candidates found. They take effect once you confirm them.",
  },
  "labels.microRules.minedNone": {
    zh: "记录里没有找到足够的对比对。",
    en: "The records did not contain enough contrasts.",
  },
  "labels.microRules.trigger": {
    zh: "触发词",
    en: "Trigger",
  },
  "labels.microRules.triggerHint": {
    zh: "用顿号或逗号分开",
    en: "Separated by commas",
  },
  "labels.microRules.meaning": {
    zh: "含义",
    en: "Meaning",
  },
  "labels.microRules.rendering": {
    zh: "这时候你会怎么做",
    en: "What you do then",
  },
  "labels.microRules.evidence": {
    zh: "依据",
    en: "Evidence",
  },
  "labels.microRules.evidenceEmpty": {
    zh: "没有依据。",
    en: "No evidence.",
  },
  "labels.microRules.verified": {
    zh: "已确认，会生效",
    en: "Confirmed — in effect",
  },
  "labels.microRules.unverified": {
    zh: "候选，还没确认",
    en: "Candidate — not confirmed",
  },
  "labels.microRules.confirm": {
    zh: "确认",
    en: "Confirm",
  },
  "labels.microRules.source": {
    zh: "来源",
    en: "Source",
  },
  "labels.microRules.sourceAuto": {
    zh: "从记录里挖到的",
    en: "Mined from the records",
  },
  "labels.microRules.sourceManual": {
    zh: "你写的",
    en: "Written by you",
  },

  // ── The imperfection, in the interface ───────────────────────────────────

  "labels.imperfection.title": {
    zh: "每种心情下的不完美",
    en: "Imperfection, per state",
  },
  "labels.imperfection.hint": {
    zh: "没有人是恒定的。同一个人心情好时松散，心情差时短促。分别写，才是真的。",
    en: "Nobody is constant. The same person is loose when happy and clipped when not. Write them apart and it becomes real.",
  },
  "labels.imperfection.state": {
    zh: "状态",
    en: "State",
  },
  "labels.imperfection.deviations": {
    zh: "这时候 TA 的不完美长什么样",
    en: "How they are imperfect here",
  },
  "labels.imperfection.deviationsHint": {
    zh: "用分号分开",
    en: "Separated by semicolons",
  },
  "labels.imperfection.restoreDefaults": {
    zh: "恢复默认",
    en: "Restore the defaults",
  },
  "labels.imperfection.reset": {
    zh: "清空",
    en: "Clear",
  },

  // ── The behaviour, in the interface ──────────────────────────────────────
  //
  // The behaviour panel has its own copy in the interface dictionary.
  // These nine were a second copy of nine sentences that nothing read.

  // ── The ruler ───────────────────────────────────────────────────────────

  "labels.eval.title": {
    zh: "像不像",
    en: "Does it still sound like them",
  },
  "labels.eval.hint": {
    zh: "用真实记录里扣下的一句当标准答案，看重建出来的分身能不能写得出。",
    en: "A real line is held back from the records, and the rebuilt persona has to produce it.",
  },
  "labels.eval.cases": {
    zh: "标答",
    en: "Cases",
  },
  "labels.eval.run": {
    zh: "跑一次",
    en: "Run it",
  },
  "labels.eval.running": {
    zh: "正在跑…",
    en: "Running…",
  },
  "labels.eval.metrics": {
    zh: "指标",
    en: "Metrics",
  },
  "labels.eval.ngram": {
    zh: "三字重合率",
    en: "3-gram overlap",
  },
  // The measures have their own labels in the client dictionary
  // (`fidelity.*`), where the interface actually shows them — and
  // there they are said in words, because a difference of
  // log-probabilities means nothing to a reader on its own. The keys
  // that used to live here were never shown by anything.
  "labels.eval.emotion": {
    zh: "情绪判断",
    en: "Emotion agreement",
  },
  "labels.eval.ks": {
    zh: "时间分布差",
    en: "Timing distance",
  },
  "labels.eval.noCases": {
    zh: "还没有标答。导入聊天记录后可以自动切一组出来。",
    en: "No cases yet. Import the chat records and a set can be cut from them.",
  },
  "labels.eval.buildCases": {
    zh: "切一组标答",
    en: "Cut a set of cases",
  },
  "labels.eval.blindTest": {
    zh: "真人还是分身",
    en: "Real person or persona",
  },

  // ── The way out ──────────────────────────────────────────────────────────

  "labels.outbound.title": {
    zh: "带回去的话",
    en: "Words to take back",
  },
  "labels.outbound.hint": {
    zh: "这些是你只在这里说过、还没对本人说过的话。系统不代发，只把它们摆在这里，由你决定说不说。",
    en: "These are things you said here and never said to them. Nothing is sent for you — they are laid out, and you decide.",
  },
  "labels.outbound.empty": {
    zh: "还没有。从你们的对话里找找那些只在这里说过的话。",
    en: "None yet. We can look through the conversation for the things only said here.",
  },
  "labels.outbound.collect": {
    zh: "找一找",
    en: "Look for them",
  },
  "labels.outbound.collecting": {
    zh: "正在找…",
    en: "Looking…",
  },
  "labels.outbound.collected": {
    zh: "找到 {{count}} 句。",
    en: "Found {{count}}.",
  },
  "labels.outbound.collectedNone": {
    zh: "没有找到只在这里说过的话。",
    en: "Nothing was said only here.",
  },
  "labels.outbound.status": {
    zh: "状态",
    en: "Status",
  },
  "labels.outbound.statusDraft": {
    zh: "还在写",
    en: "Still writing",
  },
  "labels.outbound.statusReady": {
    zh: "可以带走了",
    en: "Ready to take",
  },
  "labels.outbound.statusSent": {
    zh: "已经说过了",
    en: "Already said",
  },
  "labels.outbound.statusDropped": {
    zh: "不说了",
    en: "Never mind",
  },
  "labels.outbound.markSent": {
    zh: "我说过了",
    en: "I said it",
  },
  "labels.outbound.drop": {
    zh: "不说了",
    en: "Never mind",
  },
  "labels.outbound.dropConfirm": {
    zh: "确定不再带这句话了吗？",
    en: "Are you sure you will not take this one?",
  },
  "labels.outbound.source": {
    zh: "来自",
    en: "From",
  },
  "labels.outbound.forSelf": {
    zh: "留给自己的",
    en: "For yourself",
  },
  "labels.outbound.staleHint": {
    zh: "这句话已经放了 {{days}} 天了。它不会自己消失。",
    en: "This has been waiting {{days}} days. It will not go away on its own.",
  },

  // ── The prompts ──────────────────────────────────────────────────────────

  "prompts.microRuleMining": {
    zh: [
      "你是一个语言学家，正在从真实聊天记录里找出这个人的判别方式。",
      "",
      "只看下面这些对比对：每一组是同一个人在同一类语境下说的两句话，它们之间只差极小的一处。",
      "对每一组，回答三件事：",
      "1. trigger：触发这一处的那个词或那几个字（照抄，不要改写）",
      "2. meaning：在这个人身上，这一处意味着什么",
      "3. rendering：这时候这个人实际上会怎么做（更短？更冷？先道歉？直接换话题？）",
      "",
      "只输出有把握的组。宁可少，不要猜。每条都要引用原文作为 evidence。",
      "输出 JSON：{\"rules\":[{\"trigger\":[\"...\"],\"meaning\":\"...\",\"rendering\":\"...\",\"evidence\":[{\"at\":\"...\",\"snippet\":\"...\"}]}]}",
      "",
      "对比对：",
    ].join("\n"),
    en: [
      "You are a linguist looking for how this person discriminates, from real chat records.",
      "",
      "Look only at the contrast pairs below: each one is the same person in a similar situation, saying two things that differ in a very small way.",
      "For each pair, answer three things:",
      "1. trigger — the word or words that make the difference (copy them, do not rewrite)",
      "2. meaning — what that difference means for this person",
      "3. rendering — what this person actually does when it comes up (shorter? colder? apologises first? changes the subject?)",
      "",
      "Only answer the pairs you are sure about. Fewer is better than a guess. Every rule must quote its source as evidence.",
      "Output JSON: {\"rules\":[{\"trigger\":[\"...\"],\"meaning\":\"...\",\"rendering\":\"...\",\"evidence\":[{\"at\":\"...\",\"snippet\":\"...\"}]}]}",
      "",
      "The pairs:",
    ].join("\n"),
  },
  "prompts.microRuleMiningUser": {
    zh: "对比对：\n{{pairs}}",
    en: "The pairs:\n{{pairs}}",
  },
  "prompts.farewellCandidates": {
    zh: [
      "你正在替一个人写她从未说出口的最后几句话。",
      "",
      "要求：",
      "1. 必须是她在这个语境下真的会说的话，用她自己的口吻，不是你的口吻",
      "2. 必须是她**从来没有说过**的话——所以不能是回忆、不是复述、不是告别语录",
      "3. 必须是她**没说出口**的那一类：那些她知道、但一直没说的东西",
      "4. 彼此之间要有差别，不要是同一句话的改写",
      "5. 允许不完整，允许停顿，允许半句",
      "",
      "只输出她的话本身，不要解释，不要标签。",
      "",
      "她是谁：",
      "{{persona}}",
      "",
      "你们的记忆：",
      "{{memories}}",
    ].join("\n"),
    en: [
      "You are writing the last few sentences this person never said out loud.",
      "",
      "Requirements:",
      "1. It must be something she would really say in this situation, in her own voice, not yours.",
      "2. It must be something she has **never said** — so not a memory, not a recap, not a farewell from a quote book.",
      "3. It must be the kind of thing she knew but never said.",
      "4. The candidates must differ from each other — not rewrites of one line.",
      "5. Incomplete is allowed. Pauses are allowed. Half a sentence is allowed.",
      "",
      "Output only her words. No explanation, no labels.",
      "",
      "Who she is:",
      "{{persona}}",
      "",
      "Your memories:",
      "{{memories}}",
    ].join("\n"),
  },
  "prompts.farewellCandidatesUser": {
    zh: "写五句。",
    en: "Write five.",
  },
  "prompts.farewellEdit": {
    zh: [
      "下面这些是候选的告别句。现在你要做的是**减法**。",
      "",
      "唯一的约束是：这是最后一次说了。",
      "",
      "因此：",
      "- 删掉所有解释。真正说最后一句话的人不解释自己",
      "- 删掉所有铺垫。直接说",
      "- 保留停顿、不完整、没说完的半句",
      "- 不要新增任何信息——只能用候选里已经有的东西改写",
      "- 不要写成情书。情书是关于过去的，最后一句话是关于现在的",
      "",
      "输出 JSON：{\"letter\":\"最终的信\",\"kept\":[\"保留的句子\"],\"removed\":[\"删掉的句子\"]}",
      "",
      "候选：",
      "{{candidates}}",
    ].join("\n"),
    en: [
      "Below are candidate farewell lines. Your job now is **subtraction**.",
      "",
      "The only constraint is: this is the last time it gets said.",
      "",
      "So:",
      "- Cut every explanation. Someone saying their last word does not explain themselves.",
      "- Cut every preamble. Say it directly.",
      "- Keep the pauses, the incompleteness, the half-finished sentence.",
      "- Do not add any new information — only rewrite what is already in the candidates.",
      "- Do not write a love letter. A love letter is about the past; a last word is about now.",
      "",
      "Output JSON: {\"letter\":\"the final letter\",\"kept\":[\"the lines you kept\"],\"removed\":[\"the lines you cut\"]}",
      "",
      "The candidates:",
      "{{candidates}}",
    ].join("\n"),
  },
  "prompts.farewellEditUser": {
    zh: "改成最后一封信。",
    en: "Turn it into the last letter.",
  },
  "prompts.outboundCandidates": {
    zh: [
      "你在读一段对话，找出**用户**说过、但没对对方说过的话。",
      "",
      "规则：",
      "1. 只看用户的消息。对方的话一条都不要选",
      "2. 只选那些没有说出口的：试探过但没问的问题、绕着说的心事、删了又打的话",
      "3. 不要选闲聊，不要选已经说清楚的",
      "4. 一次最多 {{max}} 条，按「只在这里说过」的程度从高到低",
      "5. 原文照抄，一个字都不要改",
      "",
      "输出 JSON：{\"items\":[{\"messageId\":123,\"text\":\"原文\"],\"note\":\"一句说明\"}",
    ].join("\n"),
    en: [
      "You are reading a conversation and looking for things the **user** said that they never said to the other person.",
      "",
      "Rules:",
      "1. Only the user's messages count. Nothing the other person said.",
      "2. Only the things that were not said out loud: the question they circled without asking, the thing they talked around, the line they typed and deleted.",
      "3. Not small talk. Not anything that was already said clearly.",
      "4. At most {{max}} items, ordered by how much it was only ever said here.",
      "5. Copy the original text exactly. Do not change a character.",
      "",
      "Output JSON: {\"items\":[{\"messageId\":123,\"text\":\"the original\"}],\"note\":\"one line\"}",
    ].join("\n"),
  },
  "prompts.outboundCandidatesUser": {
    zh: "对话：\n{{transcript}}",
    en: "The conversation:\n{{transcript}}",
  },
} satisfies CopyTable;
