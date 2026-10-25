/**
 * The skill engine's prompts, in both languages.
 *
 * The persona distillation pipeline talked to a language model in Chinese:
 * the contracts that describe the output format, the instructions that
 * describe what to extract, the progress messages the person reads while
 * it runs. An English user got an English interface and a Chinese pipeline
 * — and, because the prompt that asked for the persona was in Chinese, a
 * persona description written in Chinese.
 *
 * Two kinds of string live here:
 *
 *   - The prompts. The English half has to keep the same shape as the
 *     Chinese one: the same section headings (the machine counters in
 *     `tools/research/` recognise them by name), the same JSON keys, the
 *     same counting rules and the same forbidden formats.
 *   - The progress messages. They are read by the person waiting for the
 *     analysis, so they are ordinary sentences.
 *
 * The Chinese is kept exactly as it was: the app's default locale is still
 * Chinese, and the Chinese half is what the app has always said. The
 * English is a translation, not a paraphrase — the meaning of an
 * instruction to a model has to survive the crossing.
 */
import { COPY, type CopyTable } from "./index";

export const SKILL_PROMPTS: CopyTable = {
  // ── The six research tracks ────────────────────────────────────────────
  // The titles and the focus lines are shown to the model and written into
  // the research notes; the track number and the file name are protocol
  // values and stay where they are.

  "skillPrompts.dimension.writings.title": {
    zh: "Writings（著作与系统思考）",
    en: "Writings (written work and systematic thinking)",
  },
  "skillPrompts.dimension.writings.focus": {
    zh: "系统性的成文立场：核心论点、论证链、反复书写的主题、观点随时间的演变。",
    en: "Their systematic written positions: the core arguments, the chains of reasoning, the themes they return to again and again, and how the views change over time.",
  },
  "skillPrompts.dimension.conversations.title": {
    zh: "Conversations（即兴对话与压力应对）",
    en: "Conversations (improvised talk and pressure)",
  },
  "skillPrompts.dimension.conversations.focus": {
    zh: "即兴推理：长访谈、辩论、突发提问、被冒犯或被挑战时的反应。",
    en: "Improvised reasoning: long interviews, debates, unexpected questions, and how they react when they are offended or challenged.",
  },
  "skillPrompts.dimension.expression.title": {
    zh: "Expression DNA（语言指纹）",
    en: "Expression DNA (their linguistic fingerprint)",
  },
  "skillPrompts.dimension.expression.focus": {
    zh: "句式节奏、比喻来源、分歧框架、压缩程度、确定性语言、口头禅与幽默方式。",
    en: "Sentence rhythm, where the metaphors come from, how they frame a disagreement, how compressed they are, how certain their language is, their filler words and their humour.",
  },
  "skillPrompts.dimension.decisions.title": {
    zh: "Decisions（行为与选择）",
    en: "Decisions (behaviour and choices)",
  },
  "skillPrompts.dimension.decisions.focus": {
    zh: "实际做了什么：重大押注、方向反转、显式取舍、失败叙事、用人与时机。",
    en: "What they actually did: the big bets, the reversals, the explicit trade-offs, the narratives about failure, the people they used and the timing.",
  },
  "skillPrompts.dimension.externalViews.title": {
    zh: "External Views（他者视角与批评）",
    en: "External views (how others see them, and the criticism)",
  },
  "skillPrompts.dimension.externalViews.focus": {
    zh: "他人眼中的版本：实质批评、被指出的矛盾、同行认定的盲点、自述形象与外述形象的落差。",
    en: "Other people's version of them: substantive criticism, the contradictions that were pointed out, the blind spots their peers identified, and the gap between the image they give and the image others give.",
  },
  "skillPrompts.dimension.timeline.title": {
    zh: "Timeline（认知轨迹）",
    en: "Timeline (the path their thinking took)",
  },
  "skillPrompts.dimension.timeline.focus": {
    zh: "认知演化轨迹：里程碑的认知影响、观点转折、阶段划分、最近 12-24 个月的变化。",
    en: "How the thinking evolved: what each milestone changed in how they think, the turning points in their views, how the stages divide up, and the changes in the last 12-24 months.",
  },

  // ── The output contracts ───────────────────────────────────────────────
  // The section headings and the JSON keys in these four blocks are
  // protocol: the counters count the headings by name, and the code reads
  // the JSON keys. Both languages spell them the same way.

  "skillPrompts.noteContract": {
    zh: [
      "## 本次输出契约（必须严格遵守）",
      "",
      "只输出一个 markdown 文件正文，不要输出解释、不要用代码块、不要用 `>` 引用块。结构固定如下：",
      "",
      "# <轨道标题>",
      "",
      "## Collection Metadata",
      "- Dimension: <1-6> <轨道名>",
      "- Collection strategy: web-only / web+local / local-only",
      "- Sources searched: <数字>",
      "- Sources used: <数字>",
      "- Primary vs secondary ratio: <X>:<Y>",
      "",
      "## Source Metadata",
      "（每个来源重复一次以下字段）",
      "- URL: <你真实打开并读过的具体页面 URL，不能是平台首页/搜索页>",
      "- Source type: book / essay / interview / podcast / talk / social post / article / profile / decision record",
      "- Grounding level: 一手 / 二手",
      "- Access note: public / partial / blocked",
      "- Source weight: <1-7>",
      "- Date: <日期>",
      "",
      "## Evidence",
      "- <转述 + 出处（轨道、URL、权重）>",
      "",
      "## Patterns and Repeated Themes",
      "- <同一现象在不同来源重复出现（≥2 次）>",
      "",
      "## Contradictions",
      "- <类型：Temporal / Contextual / Inherent>：<旧立场 vs 新立场>（双方出处）",
      "",
      "## Inferences (clearly marked)",
      "- 推断：<结论>（依据：<来源 A> + <来源 B>）",
      "",
      "## Gaps and Missing Information",
      "- <缺什么、为什么缺、影响什么>",
      "",
      "## Known-Answer Candidates",
      "- Question: <他公开讨论过、存在可核对答案的问题>",
      "  Evidence anchors: <轨道 + 来源 + 权重>",
      "",
      "写法硬规则：",
      "- 小节标题必须使用上面的英文原词，中文标题不会被计数器统计。",
      "- `Source weight: 3` 写成这个形式；写成 `Source weight: [3]` 不计数。",
      "- 一手来源写 `Grounding level: 一手`；写成 `一手材料` 不计数。",
      "- 不要写超过 25 个词的长引文，不要写 `HH:MM:SS` 时间戳。",
      "- 推断只能写进 `## Inferences (clearly marked)`，证据只能写进 `## Evidence`，两者不要混写。",
      "- 没有证据就写进 `## Gaps and Missing Information`，不要编造证据、引用或出处。",
    ].join("\n"),
    en: [
      "## Output contract for this run (must be followed exactly)",
      "",
      "Output the body of one markdown file and nothing else — no explanation, no code block, no `>` quote block. The structure is fixed as follows:",
      "",
      "# <track title>",
      "",
      "## Collection Metadata",
      "- Dimension: <1-6> <track name>",
      "- Collection strategy: web-only / web+local / local-only",
      "- Sources searched: <number>",
      "- Sources used: <number>",
      "- Primary vs secondary ratio: <X>:<Y>",
      "",
      "## Source Metadata",
      "(repeat the following fields once per source)",
      "- URL: <the exact page URL you really opened and read — not a platform home page or a search page>",
      "- Source type: book / essay / interview / podcast / talk / social post / article / profile / decision record",
      "- Grounding level: primary / secondary",
      "- Access note: public / partial / blocked",
      "- Source weight: <1-7>",
      "- Date: <date>",
      "",
      "## Evidence",
      "- <paraphrase + provenance (track, URL, weight)>",
      "",
      "## Patterns and Repeated Themes",
      "- <the same phenomenon showing up in different sources (≥2 times)>",
      "",
      "## Contradictions",
      "- <type: Temporal / Contextual / Inherent>: <old position vs. new position> (the source of each side)>",
      "",
      "## Inferences (clearly marked)",
      "- Inference: <conclusion> (basis: <source A> + <source B>)",
      "",
      "## Gaps and Missing Information",
      "- <what is missing, why it is missing, what it affects>",
      "",
      "## Known-Answer Candidates",
      "- Question: <a question they have discussed publicly and for which a checkable answer exists>",
      "  Evidence anchors: <track + source + weight>",
      "",
      "Hard rules for the writing:",
      "- The section headings must use the English words given above; headings written in Chinese are not counted by the counters.",
      "- Write `Source weight: 3` in this form; `Source weight: [3]` is not counted.",
      "- Write a primary source as `Grounding level: primary`; `primary material` is not counted.",
      "- Do not write long quotations of more than 25 words, and do not write `HH:MM:SS` timestamps.",
      "- Put inferences only under `## Inferences (clearly marked)` and evidence only under `## Evidence`; do not mix the two.",
      "- When there is no evidence, write it under `## Gaps and Missing Information`; do not invent evidence, quotations or sources.",
    ].join("\n"),
  },

  "skillPrompts.auditContract": {
    zh: [
      "## 本次输出契约（必须严格遵守）",
      "",
      "只输出 markdown 正文，不要用代码块、不要用 `>` 引用块。结构固定如下：",
      "",
      "# Research Audit",
      "",
      "## Verdict",
      "- Status: PASS 或 FAIL",
      "- Reason: <一句话理由>",
      "",
      "## Coverage Review",
      "- Track coverage: <N>/6 dimensions covered",
      "- Missing or weak tracks: <具体是哪些轨道、缺什么>",
      "- Cross-track redundancy: <轨道之间是否互异>",
      "",
      "## Source Quality Assessment",
      "",
      "### Source Mix",
      "- Primary-source count: <数字>",
      "- Secondary-source count: <数字>",
      "- Primary-source ratio: <数字>%",
      "- Grounding quality: <URL 是否为真实读过的页面>",
      "",
      "### Source Hierarchy Compliance",
      "- Sources from weight 1-3: <数字>",
      "- Sources from weight 4-5: <数字>",
      "- Sources from weight 6-7: <数字>",
      "- Blacklisted sources used: <none 或列出；黑名单源一律 FAIL>",
      "",
      "### Taste Principle Compliance",
      "- Long-form vs. snippet ratio: <描述>",
      "- Firsthand vs. secondhand ratio: <描述>",
      "- Controversial/distinctive positions captured: <yes/no + 例子>",
      "- Thinking evolution documented: <yes/no>",
      "",
      "## Contradictions Inventory",
      "- Total contradictions found: <数字>",
      "- Classification: Temporal <...> / Contextual <...> / Inherent <...>",
      "- Quality: <是否实质张力>",
      "",
      "## Mental Model Candidates",
      "- Candidate count: <数字，目标是 ≥3>",
      "- Name: <名称>",
      "  Cross-context evidence: <出现在哪些轨道>",
      "  Preliminary gate assessment: <三重门初判>",
      "",
      "## Known-Answer Bank",
      "- Question: <问题原文>",
      "  Evidence anchors: <轨道 + 来源 + 权重>",
      "- Question: <第二个问题>",
      "  Evidence anchors: <轨道 + 来源 + 权重>",
      "",
      "## Edge-Case Candidate",
      "- Question: <邻近但没有公开答案的问题>",
      "- Why this is adjacent but under-evidenced: <原因>",
      "- Expected reasoning approach: <应当调用哪些心智模型>",
      "",
      "## Cold Figure Assessment",
      "- Total grounded sources: <数字>",
      "- Is this a cold figure (<10 sources)? <yes/no>",
      "- If yes: recommended degradation strategy: <降级策略>",
      "",
      "## Backfill Tasks",
      "- missing <N> sources: <具体还要补什么来源>",
      "- <M> contradiction bullets: <具体还要补什么矛盾>",
      "",
      "硬规则：",
      "- `- Question: ` 前面不能有数字（`Question 1:` 不计数）。",
      "- `## Edge-Case Candidate` 标题必须保留 `Edge-Case` 字样。",
      "- FAIL 时必须给出具体缺口清单，不要只写“不足”。",
    ].join("\n"),
    en: [
      "## Output contract for this run (must be followed exactly)",
      "",
      "Output the markdown body and nothing else — no code block, no `>` quote block. The structure is fixed as follows:",
      "",
      "# Research Audit",
      "",
      "## Verdict",
      "- Status: PASS or FAIL",
      "- Reason: <the reason in one sentence>",
      "",
      "## Coverage Review",
      "- Track coverage: <N>/6 dimensions covered",
      "- Missing or weak tracks: <which tracks in particular, and what is missing>",
      "- Cross-track redundancy: <whether the tracks are distinct from one another>",
      "",
      "## Source Quality Assessment",
      "",
      "### Source Mix",
      "- Primary-source count: <number>",
      "- Secondary-source count: <number>",
      "- Primary-source ratio: <number>%",
      "- Grounding quality: <whether the URLs are pages that were really read>",
      "",
      "### Source Hierarchy Compliance",
      "- Sources from weight 1-3: <number>",
      "- Sources from weight 4-5: <number>",
      "- Sources from weight 6-7: <number>",
      "- Blacklisted sources used: <none or a list; a blacklisted source is an automatic FAIL>",
      "",
      "### Taste Principle Compliance",
      "- Long-form vs. snippet ratio: <description>",
      "- Firsthand vs. secondhand ratio: <description>",
      "- Controversial/distinctive positions captured: <yes/no + examples>",
      "- Thinking evolution documented: <yes/no>",
      "",
      "## Contradictions Inventory",
      "- Total contradictions found: <number>",
      "- Classification: Temporal <...> / Contextual <...> / Inherent <...>",
      "- Quality: <whether the tension is substantive>",
      "",
      "## Mental Model Candidates",
      "- Candidate count: <number, the target is ≥3>",
      "- Name: <the name>",
      "  Cross-context evidence: <which tracks it appears in>",
      "  Preliminary gate assessment: <the first reading against the three gates>",
      "",
      "## Known-Answer Bank",
      "- Question: <the question in its own words>",
      "  Evidence anchors: <track + source + weight>",
      "- Question: <the second question>",
      "  Evidence anchors: <track + source + weight>",
      "",
      "## Edge-Case Candidate",
      "- Question: <a neighbouring question that has no public answer>",
      "- Why this is adjacent but under-evidenced: <the reason>",
      "- Expected reasoning approach: <which mental models should be called on>",
      "",
      "## Cold Figure Assessment",
      "- Total grounded sources: <number>",
      "- Is this a cold figure (<10 sources)? <yes/no>",
      "- If yes: recommended degradation strategy: <the degradation strategy>",
      "",
      "## Backfill Tasks",
      "- missing <N> sources: <which sources still have to be added>",
      "- <M> contradiction bullets: <which contradictions still have to be added>",
      "",
      "Hard rules:",
      "- There must be no number in front of `- Question: ` (`Question 1:` is not counted).",
      "- The `## Edge-Case Candidate` heading has to keep the words `Edge-Case`.",
      "- When the verdict is FAIL, give the specific list of gaps; do not write only that something is “insufficient”.",
    ].join("\n"),
  },

  "skillPrompts.synthesisContract": {
    zh: [
      "## 本次输出契约（必须严格遵守）",
      "",
      "只输出一个 JSON 对象，不要输出 markdown，不要用代码块包裹。结构：",
      "",
      "{",
      '  "summary": "<一段话结论>",',
      '  "mental_models": [',
      "    {",
      '      "name": "<模型名称>",',
      '      "definition": "<定义>",',
      '      "evidence_anchors": "<轨道 + 来源 + 权重>",',
      '      "sees_first": "<这个模型第一眼先看什么>",',
      '      "filters_out": "<它过滤掉什么>",',
      '      "failure_mode": "<它什么时候会失效>"',
      "    }",
      "  ],",
      '  "demoted_heuristics": [',
      '    { "rule": "<操作规则>", "context": "<适用情境>", "why_not_a_model": "<为什么不能算完整心智模型>" }',
      "  ],",
      '  "unresolved_contradictions": ["<仍未解决的矛盾>"],',
      '  "evidence_gaps": ["<降低信心的证据缺口>"],',
      '  "known_answer_questions": [',
      '    { "question": "<问题原文>", "evidence_anchors": "<轨道 + 来源 + 权重>" }',
      "  ],",
      '  "intellectual_genealogy": [',
      '    { "name": "<思想来源>", "source": "<出处>", "note": "<他如何受影响>" }',
      "  ],",
      '  "edge_case": {',
      '    "question": "<边界案例问题>",',
      '    "why_adjacent_but_under_evidenced": "<为什么没有公开答案>",',
      '    "expected_reasoning_approach": "<应当调用哪些心智模型>"',
      "  }",
      "}",
      "",
      "每个心智模型必须通过三重门：跨情境复现、生成力、排他性。至少 2 个已知答案问题、至少 1 个边界案例。",
      "intellectual_genealogy 记录公开可核对的智识谱系（他本人提到的思想来源），没有就返回空数组。",
    ].join("\n"),
    en: [
      "## Output contract for this run (must be followed exactly)",
      "",
      "Output one JSON object and nothing else — no markdown, and do not wrap it in a code block. The structure is:",
      "",
      "{",
      '  "summary": "<the conclusion, in one paragraph>",',
      '  "mental_models": [',
      "    {",
      '      "name": "<the name of the model>",',
      '      "definition": "<the definition>",',
      '      "evidence_anchors": "<track + source + weight>",',
      '      "sees_first": "<what this model looks at first>",',
      '      "filters_out": "<what it filters out>",',
      '      "failure_mode": "<when it fails>"',
      "    }",
      "  ],",
      '  "demoted_heuristics": [',
      '    { "rule": "<the operating rule>", "context": "<the situation it applies to>", "why_not_a_model": "<why it is not a full mental model>" }',
      "  ],",
      '  "unresolved_contradictions": ["<a contradiction that is still unresolved>"],',
      '  "evidence_gaps": ["<an evidence gap that lowers confidence>"],',
      '  "known_answer_questions": [',
      '    { "question": "<the question in its own words>", "evidence_anchors": "<track + source + weight>" }',
      "  ],",
      '  "intellectual_genealogy": [',
      '    { "name": "<the source of the thought>", "source": "<where it comes from>", "note": "<how it influenced them>" }',
      "  ],",
      '  "edge_case": {',
      '    "question": "<the boundary-case question>",',
      '    "why_adjacent_but_under_evidenced": "<why there is no public answer>",',
      '    "expected_reasoning_approach": "<which mental models should be called on>"',
      "  }",
      "}",
      "",
      "Every mental model must pass the three gates: recurrence across contexts, generativity, and exclusivity. At least 2 known-answer questions, and at least 1 boundary case.",
      "intellectual_genealogy records a publicly checkable intellectual genealogy (the sources of thought they mention themselves); return an empty array when there is none.",
    ].join("\n"),
  },

  "skillPrompts.validationContract": {
    zh: [
      "## 本次输出契约（必须严格遵守）",
      "",
      "只输出一个 JSON 对象，不要输出 markdown，不要用代码块包裹。结构：",
      "",
      "{",
      '  "status": "PASS 或 FAIL",',
      '  "release_readiness": "ready 或 revise",',
      '  "known_answer_check": [',
      "    {",
      '      "question": "<问题原文>",',
      '      "direction_match": "<方向是否一致>",',
      '      "framing_match": "<框架是否一致>",',
      '      "confidence_calibration": "<置信度是否校准>",',
      '      "verdict": "<结论>"',
      "    }",
      "  ],",
      '  "edge_case_check": {',
      '    "question": "<边界案例问题>",',
      '    "extrapolates_from_models": "<是否从真实心智模型外推>",',
      '    "shows_uncertainty": "<证据薄弱时是否显露出不确定>",',
      '    "verdict": "<结论>"',
      "  },",
      '  "voice_check": {',
      '    "recognizable": "<是否可辨认>",',
      '    "no_generic_ai_phrasing": "<是否没有通用 AI 腔>",',
      '    "no_quote_stitching": "<是否没有拼贴引语>",',
      '    "verdict": "<结论>"',
      "  },",
      '  "copyright_check": {',
      '    "transcript_dumps": "<有无逐字稿>",',
      '    "long_quotations": "<有无长引文>",',
      '    "blockquote_copying": "<有无引用块>",',
      '    "verdict": "<结论>"',
      "  },",
      '  "required_revisions": ["<必须修改的地方>"]',
      "}",
      "",
      "至少用 2 个已知答案问题做方向 / 框架 / 置信度三项判断，再用 1 个边界案例问题判断外推与不确定性。",
    ].join("\n"),
    en: [
      "## Output contract for this run (must be followed exactly)",
      "",
      "Output one JSON object and nothing else — no markdown, and do not wrap it in a code block. The structure is:",
      "",
      "{",
      '  "status": "PASS or FAIL",',
      '  "release_readiness": "ready or revise",',
      '  "known_answer_check": [',
      "    {",
      '      "question": "<the question in its own words>",',
      '      "direction_match": "<whether the direction matches>",',
      '      "framing_match": "<whether the framing matches>",',
      '      "confidence_calibration": "<whether the confidence is calibrated>",',
      '      "verdict": "<the verdict>"',
      "    }",
      "  ],",
      '  "edge_case_check": {',
      '    "question": "<the boundary-case question>",',
      '    "extrapolates_from_models": "<whether it extrapolates from real mental models>",',
      '    "shows_uncertainty": "<whether it shows uncertainty when the evidence is thin>",',
      '    "verdict": "<the verdict>"',
      "  },",
      '  "voice_check": {',
      '    "recognizable": "<whether it is recognisable>",',
      '    "no_generic_ai_phrasing": "<whether there is no generic AI phrasing>",',
      '    "no_quote_stitching": "<whether there are no stitched-together quotations>",',
      '    "verdict": "<the verdict>"',
      "  },",
      '  "copyright_check": {',
      '    "transcript_dumps": "<whether there is a verbatim transcript>",',
      '    "long_quotations": "<whether there are long quotations>",',
      '    "blockquote_copying": "<whether there are quote blocks>",',
      '    "verdict": "<the verdict>"',
      "  },",
      '  "required_revisions": ["<what must be changed>"]',
      "}",
      "",
      "Judge direction, framing and confidence on at least 2 known-answer questions, then judge extrapolation and uncertainty on 1 boundary-case question.",
    ].join("\n"),
  },

  // ── The protocol the generated skill follows ────────────────────────────

  "skillPrompts.agenticProtocol": {
    zh: [
      "1. 先把问题归到六个研究轨道之一（著作 / 对话 / 表达 / 决策 / 他者视角 / 认知轨迹）。",
      "2. 调用与该轨道匹配的心智模型，不要套用通用建议。",
      "3. 说明证据强度：权重 1-3 的来源可以作为依据，4-5 需要标注为推断，6-7 只能当线索。",
      "4. 证据不足时显露出不确定，不要补全不存在的资料。",
    ].join("\n"),
    en: [
      "1. First assign the question to one of the six research tracks (writings / conversations / expression / decisions / external views / timeline).",
      "2. Call on the mental model that matches that track; do not apply generic advice.",
      "3. State the strength of the evidence: sources of weight 1-3 can be used as a basis, weight 4-5 have to be marked as inferences, and weight 6-7 can only be treated as leads.",
      "4. When the evidence is thin, show the uncertainty; do not fill in material that does not exist.",
    ].join("\n"),
  },

  // ── The research stages ────────────────────────────────────────────────

  "skillPrompts.research.collecting": {
    zh: "正在收集公开资料...",
    en: "Collecting the public sources…",
  },
  "skillPrompts.research.auditing": {
    zh: "正在审计研究证据...",
    en: "Auditing the research evidence…",
  },
  "skillPrompts.research.synthesizing": {
    zh: "正在综合心智模型...",
    en: "Putting the mental models together…",
  },
  "skillPrompts.research.validating": {
    zh: "正在验证已知答案...",
    en: "Checking the known answers…",
  },
  "skillPrompts.research.noMaterial": {
    zh: "（用户没有提供素材。只依据可核实的公开资料；无法核实的写进 Gaps，不要编造。）",
    en: "(The user did not provide any material. Rely only on verifiable public sources; put anything that cannot be verified into Gaps, and do not invent it.)",
  },
  "skillPrompts.research.personName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.research.track": {
    zh: "轨道：{{track}} {{title}}",
    en: "Track: {{track}} {{title}}",
  },
  "skillPrompts.research.trackFocus": {
    zh: "本轨道提取重点：{{focus}}",
    en: "What to extract in this track: {{focus}}",
  },
  "skillPrompts.research.userMaterialHeading": {
    zh: "## 用户提供的素材",
    en: "## Material supplied by the user",
  },
  "skillPrompts.research.notesHeading": {
    zh: "## 六轨研究笔记",
    en: "## Research notes from the six tracks",
  },
  "skillPrompts.research.mergedSummaryHeading": {
    zh: "## 合并摘要（机器计数结果）",
    en: "## Merged summary (the result of the machine counts)",
  },
  "skillPrompts.research.methodologyHeading": {
    zh: "## 方法论",
    en: "## Methodology",
  },
  "skillPrompts.research.auditHeading": {
    zh: "## 审计结论",
    en: "## Audit conclusions",
  },
  "skillPrompts.research.synthesisHeading": {
    zh: "## 综合结论",
    en: "## Synthesis conclusions",
  },
  "skillPrompts.research.draftHeading": {
    zh: "## 生成的技能草稿",
    en: "## The generated skill draft",
  },
  "skillPrompts.research.trackFailed": {
    zh: "研究轨道 {{track}} 失败：{{reason}}",
    en: "Research track {{track}} failed: {{reason}}",
  },
  "skillPrompts.research.mergeFailed": {
    zh: "研究合并失败：{{reason}}",
    en: "The research merge failed: {{reason}}",
  },
  "skillPrompts.research.auditFailed": {
    zh: "审计阶段失败：{{reason}}",
    en: "The audit stage failed: {{reason}}",
  },
  "skillPrompts.research.synthesisFailed": {
    zh: "综合阶段失败：{{reason}}",
    en: "The synthesis stage failed: {{reason}}",
  },
  "skillPrompts.research.validationFailed": {
    zh: "验证阶段失败：{{reason}}",
    en: "The validation stage failed: {{reason}}",
  },
  "skillPrompts.research.synthesisNotJson": {
    zh: "综合阶段没有返回可解析的 JSON",
    en: "The synthesis stage did not return parsable JSON",
  },
  "skillPrompts.research.validationNotJson": {
    zh: "验证阶段没有返回可解析的 JSON",
    en: "The validation stage did not return parsable JSON",
  },
  "skillPrompts.research.emptySection": {
    zh: "- 本轨道缺少该小节的有效内容：模型输出未覆盖。",
    en: "- This track has no valid content in this section: the model's output did not cover it.",
  },
  "skillPrompts.research.boundaries": {
    zh: "研究来源数：{{sources}}，一手标记：{{markers}}。",
    en: "Number of research sources: {{sources}}, primary-source markers: {{markers}}.",
  },
  "skillPrompts.research.digestHeading": {
    zh: "## 心智模型",
    en: "## Mental models",
  },
  "skillPrompts.research.digestEmpty": {
    zh: "- 综合阶段未产出心智模型。",
    en: "- The synthesis stage did not produce any mental models.",
  },

  // ── The research draft skill ───────────────────────────────────────────
  // The headings are the vocabulary the quality gate counts on: it knows
  // the Chinese spellings and the English ones, and the English headings
  // here are the spellings it recognises.

  "skillPrompts.draft.description": {
    zh: "{{name}} 的公开研究蒸馏草稿（{{profile}}）",
    en: "A public-source research distillation draft for {{name}} ({{profile}})",
  },
  "skillPrompts.draft.partA": {
    zh: "## PART A：工作能力",
    en: "## PART A: Working capability",
  },
  "skillPrompts.draft.findingsHeading": {
    zh: "### 研究要点",
    en: "### Research findings",
  },
  "skillPrompts.draft.noFindings": {
    zh: "- 研究尚未产出可引用的要点。",
    en: "- The research has not produced any findings that can be cited.",
  },
  "skillPrompts.draft.mentalModelsHeading": {
    zh: "### 心智模型",
    en: "### Mental models",
  },
  "skillPrompts.draft.noMentalModels": {
    zh: "- 综合阶段尚未产出心智模型。",
    en: "- The synthesis stage has not produced any mental models.",
  },
  "skillPrompts.draft.modelLine": {
    zh: "- {{name}}：{{definition}}（依据：{{evidence}}）",
    en: "- {{name}}: {{definition}} (basis: {{evidence}})",
  },
  "skillPrompts.draft.modelSeesFirst": {
    zh: "  - 第一眼先看：{{value}}",
    en: "  - Looks at first: {{value}}",
  },
  "skillPrompts.draft.modelFiltersOut": {
    zh: "  - 会过滤掉：{{value}}",
    en: "  - Filters out: {{value}}",
  },
  "skillPrompts.draft.modelFailureMode": {
    zh: "  - 失效场景：{{value}}",
    en: "  - Failure scenario: {{value}}",
  },
  "skillPrompts.draft.expressionDnaHeading": {
    zh: "### 表达 DNA",
    en: "### Expression DNA",
  },
  "skillPrompts.draft.expressionDnaPending": {
    zh: "- 语言指纹与句式节奏由第三轨研究笔记提供，草稿阶段尚未合成。",
    en: "- The linguistic fingerprint and the sentence rhythm come from the third track's research notes; the draft stage has not assembled them yet.",
  },
  "skillPrompts.draft.genealogyHeading": {
    zh: "### 智识谱系",
    en: "### Intellectual genealogy",
  },
  "skillPrompts.draft.noGenealogy": {
    zh: "- 智识谱系尚未整理：研究笔记里还没有可核对的思想来源。",
    en: "- The intellectual genealogy has not been assembled yet: the research notes do not hold any checkable source of thought.",
  },
  "skillPrompts.draft.protocolHeading": {
    zh: "### 分析协议",
    en: "### Agentic protocol",
  },
  "skillPrompts.draft.sourcesHeading": {
    zh: "### 来源",
    en: "### Sources",
  },
  "skillPrompts.draft.noSources": {
    zh: "- 尚未记录可核对的来源 URL。",
    en: "- No checkable source URL has been recorded yet.",
  },
  "skillPrompts.draft.knownAnswersHeading": {
    zh: "### 已知答案",
    en: "### Known answers",
  },
  "skillPrompts.draft.noKnownAnswers": {
    zh: "- 尚未产出已知答案问题。",
    en: "- No known-answer questions have been produced yet.",
  },
  "skillPrompts.draft.partB": {
    zh: "## PART B：人物性格",
    en: "## PART B: The person",
  },
  "skillPrompts.draft.contradictionsHeading": {
    zh: "### 矛盾与张力",
    en: "### Contradictions and tensions",
  },
  "skillPrompts.draft.noContradictions": {
    zh: "- 尚未整理出矛盾清单。",
    en: "- The list of contradictions has not been assembled yet.",
  },
  "skillPrompts.draft.boundariesHeading": {
    zh: "### 诚实边界",
    en: "### Honest boundaries and limitations",
  },
  "skillPrompts.draft.lowConfidence": {
    zh: "- 研究尚未收敛，结论置信度低。",
    en: "- The research has not converged; the confidence in the conclusions is low.",
  },
  "skillPrompts.draft.edgeCaseHeading": {
    zh: "### Edge-Case Candidate（边界案例）",
    en: "### Edge-Case Candidate (boundary case)",
  },
  "skillPrompts.draft.rulesHeading": {
    zh: "## 运行规则",
    en: "## Runtime rules",
  },
  "skillPrompts.draft.rule1": {
    zh: "1. 先用研究证据校验问题属于哪个心智模型覆盖的范围。",
    en: "1. First use the research evidence to check which mental model's scope the question falls into.",
  },
  "skillPrompts.draft.rule2": {
    zh: "2. 证据不足时说明不确定，不要补全不存在的资料。",
    en: "2. When the evidence is thin, say that you are unsure; do not fill in material that does not exist.",
  },
  "skillPrompts.draft.rule3": {
    zh: "3. 保留矛盾，不要把矛盾调和成圆滑结论。",
    en: "3. Keep the contradictions; do not smooth them into a tidy conclusion.",
  },

  // ── The reviews ────────────────────────────────────────────────────────

  "skillPrompts.review.noSummary": {
    zh: "（综合阶段未给出结论）",
    en: "(The synthesis stage did not give a conclusion)",
  },
  "skillPrompts.review.noPassedModels": {
    zh: "- 未产出通过三重门的心智模型。",
    en: "- No mental model passed the three gates.",
  },
  "skillPrompts.review.none": {
    zh: "- 无。",
    en: "- None.",
  },

  // ── The persona and work documents ─────────────────────────────────────

  "skillPrompts.document.personaTitle": {
    zh: "# 人物性格：{{name}}",
    en: "# Personality: {{name}}",
  },
  "skillPrompts.document.personality": {
    zh: "## 性格",
    en: "## Personality",
  },
  "skillPrompts.document.speakingStyle": {
    zh: "## 说话方式",
    en: "## How they speak",
  },
  "skillPrompts.document.catchphrases": {
    zh: "## 口头禅",
    en: "## Catchphrases",
  },
  "skillPrompts.document.nickname": {
    zh: "## 昵称",
    en: "## Nickname",
  },
  "skillPrompts.document.attachmentStyle": {
    zh: "## 依恋类型",
    en: "## Attachment style",
  },
  "skillPrompts.document.loveLanguage": {
    zh: "## 爱的语言",
    en: "## Love language",
  },
  "skillPrompts.document.conflictStyle": {
    zh: "## 争吵方式",
    en: "## How they argue",
  },
  "skillPrompts.document.touchingMoments": {
    zh: "## 动人时刻",
    en: "## Touching moments",
  },
  "skillPrompts.document.memories": {
    zh: "## 记忆",
    en: "## Memories",
  },
  "skillPrompts.document.summary": {
    zh: "## 一句话总结",
    en: "## One-line summary",
  },
  "skillPrompts.document.workTitle": {
    zh: "# 工作能力：{{name}}",
    en: "# Working capability: {{name}}",
  },
  "skillPrompts.document.positioning": {
    zh: "## 定位",
    en: "## Positioning",
  },
  "skillPrompts.document.experienceMaterial": {
    zh: "## 经验素材",
    en: "## Experience material",
  },
  "skillPrompts.document.mentalModels": {
    zh: "## 心智模型",
    en: "## Mental models",
  },
  "skillPrompts.document.knownAnswers": {
    zh: "## 已知答案",
    en: "## Known answers",
  },
  "skillPrompts.document.genealogy": {
    zh: "## 智识谱系",
    en: "## Intellectual genealogy",
  },
  "skillPrompts.document.protocol": {
    zh: "## 分析协议",
    en: "## Agentic protocol",
  },
  "skillPrompts.document.sources": {
    zh: "## 来源",
    en: "## Sources",
  },
  "skillPrompts.document.researchAudit": {
    zh: "## 研究审计",
    en: "## Research audit",
  },
  "skillPrompts.document.noMentalModels": {
    zh: "- 研究阶段未产出心智模型。",
    en: "- The research stage did not produce any mental models.",
  },
  "skillPrompts.document.noKnownAnswers": {
    zh: "- 研究阶段未产出已知答案问题。",
    en: "- The research stage did not produce any known-answer questions.",
  },

  // ── The pipeline ───────────────────────────────────────────────────────

  "skillPrompts.pipeline.personaReady": {
    zh: "{{name}} 的数字分身已准备好，可以开始对话了",
    en: "{{name}}'s digital twin is ready — you can start the conversation now",
  },
  "skillPrompts.pipeline.describeImages": {
    zh: "这些是我和{{name}}的照片。请描述照片中体现的情感氛围，以及能反映{{name}}性格特质的细节。用中文，2-3句话。",
    en: "These are photos of {{name}} and me. Please describe the emotional atmosphere that comes through in the photos, and the details that reflect {{name}}'s personality traits. In English, 2-3 sentences.",
  },
  "skillPrompts.pipeline.photoMemories": {
    zh: "【照片记忆】",
    en: "【Photo memories】",
  },
  "skillPrompts.pipeline.intakeInstruction": {
    zh: "以下是已经拿到的材料。请盘点这些材料能支撑到什么程度，并列出还缺哪些材料（按优先级排列）。\n请用无序列表逐条列出，每条一行，不要编号，也不要额外的说明。\n\n",
    en: "Here is the material that has been collected so far. Take stock of how far this material can carry the analysis, and list the material that is still missing (in priority order).\nWrite it as a bulleted list, one item per line, with no numbering and no extra commentary.\n\n",
  },
  "skillPrompts.pipeline.intakePersonName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.intakeChatLength": {
    zh: "聊天记录字数：{{length}}",
    en: "Length of the chat log: {{length}}",
  },
  "skillPrompts.pipeline.intakeImageCount": {
    zh: "图片数量：{{count}}",
    en: "Number of photos: {{count}}",
  },
  "skillPrompts.pipeline.intakeNoChat": {
    zh: "（没有聊天记录文本）",
    en: "(there is no chat log text)",
  },
  "skillPrompts.pipeline.noChatBlock": {
    zh: "（暂无聊天记录，请基于已有信息谨慎推断）",
    en: "(There is no chat log yet — infer carefully from the information that is available.)",
  },
  "skillPrompts.pipeline.analyzerName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.analyzerMaterial": {
    zh: "聊天记录/素材：\n{{material}}",
    en: "Chat log / material:\n{{material}}",
  },
  "skillPrompts.pipeline.builderName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.builderAnalysis": {
    zh: "分析结果：\n{{result}}",
    en: "Analysis result:\n{{result}}",
  },
  "skillPrompts.pipeline.builderResearchNotes": {
    zh: "研究笔记：\n{{notes}}",
    en: "Research notes:\n{{notes}}",
  },
  "skillPrompts.pipeline.researchNotesHeading": {
    zh: "## 研究笔记",
    en: "## Research notes",
  },
  "skillPrompts.pipeline.workAnalyzerName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.workAnalyzerResult": {
    zh: "人物分析结果：\n{{result}}",
    en: "Persona analysis result:\n{{result}}",
  },
  "skillPrompts.pipeline.workBuilderResult": {
    zh: "工作维度分析：\n{{analysis}}",
    en: "Work-dimension analysis:\n{{analysis}}",
  },
  "skillPrompts.pipeline.mergerName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.structurerName": {
    zh: "人物名称：{{name}}",
    en: "Person's name: {{name}}",
  },
  "skillPrompts.pipeline.structurerAnalysis": {
    zh: "行为分析：\n{{analysis}}",
    en: "Behavioural analysis:\n{{analysis}}",
  },
  "skillPrompts.pipeline.structurerPortrait": {
    zh: "人物画像：\n{{portrait}}",
    en: "Persona portrait:\n{{portrait}}",
  },
};

/**
 * Adds this table to the shared dictionary.
 *
 * `shared/copy/index.ts` is where the dictionaries are assembled, and this
 * table belongs there. Until that wiring lands, `copy()` answers a key it
 * does not know with the key itself — and a prompt that carries a key name
 * instead of its instructions and its material is worse than a missing
 * translation. So the table is added here as well; wiring it into
 * `index.ts` afterwards is then a no-op, and the call can be dropped.
 */
export function registerSkillPrompts(): void {
  for (const [key, entry] of Object.entries(SKILL_PROMPTS)) {
    if (!COPY[key]) COPY[key] = entry;
  }
}
