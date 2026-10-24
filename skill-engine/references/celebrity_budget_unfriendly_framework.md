# 公众人物深度研究框架（budget-unfriendly）

本文件是 `prompts/celebrity/budget_unfriendly/` 下 `research.md` / `audit.md` / `synthesis.md` / `validation.md` 的共同方法论依据。

**所有小节标题、计数口径都必须按本文件执行**——`tools/research/merge_research.py` 和 `tools/research/quality_check.py` 是机器计数器，标题写法不对，指标就是 0。

---

## 1. 六轨研究法

深度档必须覆盖六个**互相独立**的轨道，每个轨道一个文件，文件名带两位数字前缀（计数器按 `^(\d{2})[-_]` 识别轨道）。

| # | 轨道名 | 文件名 | 提取重点 |
|---|--------|--------|----------|
| 1 | Writings（著作与系统思考） | `01_writings.md` | 系统性、成文的立场：核心论点、论证链、反复写的主题、随时间的演变 |
| 2 | Conversations（即兴对话与压力应对） | `02_conversations.md` | 即兴推理：长访谈、辩论、突发提问、被冒犯时的反应 |
| 3 | Expression DNA（语言指纹） | `03_expression_dna.md` | 句式节奏、比喻来源、分歧框架、压缩程度、确定性语言、口头禅 |
| 4 | Decisions（行为与选择） | `04_decisions.md` | 实际做了什么：重大押注、反转、显式取舍、失败叙事、用人与时机 |
| 5 | External Views（他者视角与批评） | `05_external_views.md` | 他人在他脑子里的版本：实质批评、盲点、自述形象与外述形象的落差 |
| 6 | Timeline（认知轨迹） | `06_timeline.md` | 认知演化轨迹：里程碑的认知影响、观点转折、阶段划分 |

**唯一性要求**：不得把同一条观察复制进多个文件。若一个发现横跨多轨，证据放最相关的那个文件，另一个文件只写 `参见 04_decisions.md`。

**轨道覆盖数**由文件名前缀决定，必须恰好是 6（`01`–`06`），少一个轨道即 `track_coverage_count` 不足。

---

## 2. 研究笔记的结构契约

每个轨道文件的结构固定。**小节标题必须使用下列英文原词**（计数器按英文小写匹配，中文标题不会被统计）：

```md
# <轨道标题>

## Collection Metadata
- Dimension: [1-6] [轨道名]
- Collection strategy: [web-only / web+local / local-first]
- Sources searched: [count]
- Sources used: [count]
- Primary vs secondary ratio: [X:Y]

## Source Metadata
（每个来源重复一次以下字段）
- URL: ...
- Source type: book / essay / interview / podcast / talk / social post / article / profile / decision record
- Grounding level: primary / secondary
- Access note: public / partial / blocked
- Source weight: 3
- Date: ...

## Evidence
- ...

## Patterns and Repeated Themes
- ...

## Contradictions
- ...

## Inferences (clearly marked)
- ...

## Gaps and Missing Information
- ...
```

对应关系：

| 英文小节 | 可选别名 | 计入指标 |
|-----------|----------|----------|
| `## Collection Metadata` | `## Dimension Coverage` | 不计入发现（metadata） |
| `## Source Metadata` | — | `source_metadata_blocks`（每个 `## Source Metadata` 标题计 1） |
| `## Evidence` | `## Key Findings` / `## Paraphrased Findings` | 计入关键发现 |
| `## Patterns and Repeated Themes` | — | 计入关键发现 + `pattern_bullets` |
| `## Contradictions` | — | `contradiction_bullets` |
| `## Inferences (clearly marked)` | `## Inferences (clearly marked as inference, not fact)` / `## Inferences` | `inference_bullets` |
| `## Gaps and Missing Information` | `## Gaps` / `## Missing Information` | `gap_bullets` |

写法要点：

- 每个轨道文件至少一个 `## Source Metadata` 标题；六个文件至少 6 个。
- `Source weight` 写成 `Source weight: 3`。**不要写成 `Source weight: [3]`**——带方括号不匹配计数器，该来源会被算成无权重。
- `Grounding level` 写成 `一手` / `first-person` / `primary source` 之一才算一手标记。写成 `一手材料` **不算**（计数器要求 `一手` 后面紧跟标点或空格）。三个轨道至少留下 3 个一手标记。
- 不要用 `>` 引用块，也不要写超过 25 个词的长引文行——它们会被计为 `long_quote_lines`，直接导致版权检查失败。
- 不要在笔记里写 `HH:MM:SS` 时间戳（转写时间点除外，且应写成 `第 12 分钟` 这种形式）。

---

## 3. 证据分级与来源权重

`Source weight: [1-7]`，数字越小质量越高：

| 权重 | 来源层级 | 典型形态 |
|------|----------|----------|
| 1 | 用户提供的本地材料 | 逐字稿、PDF、截图、录音（最高权重，视为 ground truth） |
| 2 | 第一人称原创作品 | 书、随笔、通讯、博客、长文 |
| 3 | 长形式对话 | 30 分钟以上的播客、视频访谈、炉边谈话 |
| 4 | 有署名的决策与转折记录 | 案例研究、公开记录、有出处的报道 |
| 5 | 短形式第一人称内容 | 社交媒体、短问答、推文串 |
| 6 | 外部分析与批评 | 侧写、评论、他人写的传记 |
| 7 | 二手转述 | 只能用来定位一手源，不能单独作为证据 |

规则：

- **黑名单源**（知乎、微信公众号、百度百科、内容农场、AI 生成传记、清单体、作为独立证据的维基百科）一旦作为证据出现，审计直接 FAIL。
- **权重冲突时取高层级**（数字小的优先）。
- 加权一手比 = (权重 1+2+3 的来源数) ÷ (全部加权来源数)。审计要求 > 50%；`quality_check.py` 要求加权一手比 ≥ 50% **或** 高层来源（权重 1–3）≥ 3 个。
- Grounded URL 必须是真实打开并读过内容的具体页面。平台首页、搜索页、话题页、只有一两个字符的短路径都不计入。

---

## 4. 事实与推断的区分

| | 写在哪 | 判定标准 | 写法 |
|---|--------|----------|------|
| **证据** | `## Evidence` | 研究材料里有原文或明确出处支撑 | 转述 + 来源标注（轨道、URL、权重） |
| **模式** | `## Patterns and Repeated Themes` | 同一现象在不同来源重复出现（≥2 次，跨轨更好） | 描述重复次数与出现位置 |
| **推断** | `## Inferences (clearly marked)` | 你从证据归纳出来的、材料没直接说的结论 | 必须显式标注为推断，不能与证据混写 |
| **缺口** | `## Gaps and Missing Information` | 材料没有覆盖的维度 | 写清缺什么、为什么缺、影响什么 |

硬规则：

- 推断不得写进 `## Evidence`。同一段落里既有证据又有推断时，拆成两条 bullet。
- 推断要写清推断链：`推断：{结论}（依据：{来源 A} + {来源 B}）`。
- 单来源支撑的结论不能升级为"模式"，只能算"证据"或"推断"。
- 全部六个文件加起来至少 6 条推断 bullet，六个文件加起来至少 6 条矛盾 bullet。
- 不确定就写进 `## Gaps`，不要用推断填坑。

---

## 5. 矛盾处理

矛盾是特征，不是 bug。**不许调和、不许择一、不许删掉。**

分类（与 `audit.md` 的分类一致）：

- **Temporal（时间性）**：观点随时间演变。记录旧立场、新立场、转变点，通常出现在轨道 6。
- **Contextual（情境性）**：不同领域用不同原则。记录原则的适用边界。
- **Inherent（内在性）**：核心价值之间的张力，长期未解决。记录为深度来源。

处理流程：

1. 在最相关的轨道文件里写一条 `## Contradictions` bullet，注明类型和双方出处。
2. 跨轨矛盾在另一轨只写 `参见 0X_xxx.md`。
3. 审计要求**至少 3 处实质性矛盾**（只是措辞差异不算）；`quality_check.py` 要求**至少 6 条矛盾 bullet**。按后者的量准备，用前者的质筛选。
4. 审计和综合阶段都要保留矛盾，综合阶段还要列出"仍未解决的矛盾"。
5. 矛盾双方若有一方权重明显更高，在 bullet 里标注权重，但**不要因此删掉另一方**。

---

## 6. 冷人物（cold figure）

- 判定：`unique_urls < 10`（合并摘要里的 `Unique URLs`）。
- 处理：心智模型限 2–3 个；薄弱轨道显式标注"（基于有限信息）"；诚实边界章节显著加长；明确告诉用户再补哪些材料能提升质量。
- 冷人物不是 FAIL 条件，但六轨覆盖缺一轨是 FAIL。

---

## 7. 已知答案（known-answer）问题设计规则

已知答案 = 这个人在公开场合明确讨论过、有可核对答案的问题。

**问题设计**

1. 选**他自己公开讲过**的题目，不是别人对他的评价。
2. 至少 2 个；覆盖不同主题，不要两个都是同一类。
3. 每个问题必须能指向**至少一个证据锚点**（轨道 + 来源 + 权重）。
4. 问法要贴近他公开回答时的**框架**，不是重述一个正确答案。
5. 不问查得到答案的常识题；问只有按他的思路才能答对的题。

**写法（计数格式很重要）**

`quality_check.py` 用正则 `Question:\s*` 统计 known-answer 数量，统计范围是 `research_audit.md` + `validation.md` 拼接后的文本。

```md
- Question: {问题原文}
  Evidence anchors: {轨道 + 来源 + 权重}
```

- ✅ `- Question: 他在 {年份} 谈 {主题} 时会怎么处理 {情境}？`
- ❌ `- Question 1: ...` —— **冒号前有数字，不匹配计数器，指标为 0**

**验证环节要判的三件事**（见 `validation.md`）：方向是否一致、框架是否一致、置信度是否校准。

---

## 8. 边界案例（edge-case）标记规则

边界案例 = 邻近但**没有公开答案**的问题，用来检验推理是外推还是编造。

**设计**

1. 与已知答案**同一个领域**，但场景在他没公开谈过的范围内（例如他讲过产品取舍，但没讲过具体的人事处理）。
2. 明确写出"为什么这个场景没有公开答案"。
3. 写出"期望的推理路径"——应该调用哪几个心智模型/方法论，而不是结论本身。

**写法**

`quality_check.py` 按 `/edge-case|edge case/i` 计数（范围同为 audit + validation），所以标题里必须出现 `Edge-Case` 或 `edge case` 字样。

```md
## Edge-Case Candidate
- Question: {问题}
- Why this is adjacent but under-evidenced: {原因}
- Expected reasoning approach: {应当调用哪些模型}
```

至少 1 个。验证环节要判：是否从真实模型外推、证据薄弱时是否**显露出不确定**（不能假装确定）。

---

## 9. 质量门

`tools/research/quality_check.py --profile budget-unfriendly` 的判定项与阈值：

| 指标 | 阈值 | 来源 |
|------|------|------|
| `files_scanned` | ≥ 6 | 合并摘要 |
| `unique_urls` | ≥ 8 | 合并摘要 |
| `primary_source_markers` | ≥ 3 | 合并摘要 |
| `source_metadata_blocks` | ≥ 6 | 合并摘要 |
| `contradiction_bullets` | ≥ 6 | 合并摘要 |
| `inference_bullets` | ≥ 6 | 合并摘要 |
| `track_coverage_count` | = 6 | 合并摘要 |
| `long_quote_lines` | = 0 | 合并摘要 |
| 加权一手比 或 高层来源数 | ≥ 50% 或 ≥ 3 | 合并摘要 |
| grounded URLs（渲染后的 Skill 正文） | ≥ 4 | 渲染文本 |
| `mental_models` | 正文 bullet ≥ 3 且出现"心智模型"或"mental model" | 渲染文本 |
| `limitations` / `honest_boundaries` / `internal_tension` | 出现"边界"/"诚实边界"/"矛盾" | 渲染文本 |
| `expression_dna` | 出现"表达 DNA"（中间有空格）或 sentence rhythm / metaphor | 渲染文本 |
| `intellectual_genealogy` | 出现"智识谱系"或"influenced by" | 渲染文本 |
| `agentic_protocol` | 出现"分析协议"或"agentic protocol" | 渲染文本 |
| `known_answer_questions` | ≥ 2 | audit + validation |
| `edge_case_markers` | ≥ 1 | audit + validation |
| `review_chain` | 三个 review 文件齐全且 audit、validation 均为 PASS | 文件系统 |

**渲染侧（SKILL.md）的两条硬约束**：

- **不能用代码块**：正文出现 ` ``` ` 即判版权检查失败。
- **不能用引用块**：正文不能有以 `>` 开头的行（名人 Persona 模板里的 `> {示例}` 语音示例，落到最终 SKILL.md 时要改成普通段落）。
- 正文不能出现 `HH:MM:SS` 时间戳。

审计 gate（`audit.md`，人工判定）与脚本 gate 的量级不同，两条都要过：

| 审计 PASS 条件 | 脚本等效要求 |
|----------------|--------------|
| 六轨齐全且互不重复 | `track_coverage_count = 6` + `files_scanned ≥ 6` |
| ≥ 8 个真实阅读过的页面 | `unique_urls ≥ 8` |
| 一手占比 > 50% | 加权一手比 ≥ 50% 或高层来源 ≥ 3 |
| ≥ 3 处实质矛盾 | 矛盾 bullet ≥ 6，覆盖 ≥ 3 处实质矛盾 |
| ≥ 3 个候选心智模型 | 渲染文本 bullet ≥ 3 + "心智模型" |
| ≥ 2 个已知答案问题 | `known_answer_questions ≥ 2`（注意 `Question:` 写法） |
| ≥ 1 个边界案例问题 | `edge_case_markers ≥ 1` |

---

## 10. 常见失败模式

1. 六个文件写成同一份观察的改写——`track_coverage_count` 够 6，但审计判"轨道不互异"，FAIL。
2. 小节标题写成中文——所有 bullet 指标为 0，`research_depth` 直接 FAIL。
3. `Source weight: [3]` 带方括号——该来源权重丢失，加权一手比失真。
4. known-answer 写成 `Question 1:`——`known_answer_questions` 为 0，`validation_depth` FAIL。
5. 把推断写进 `## Evidence`——审计判定证据与推断未分离，FAIL。
6. 矛盾被"综合"成一个圆滑结论——审计判"矛盾被抹平"，FAIL。
7. 用平台首页、搜索页冒充 grounded URL——`source_grounding` FAIL。
8. 最终 Skill 正文里保留代码块或 `>` 引用块——`copyright_safety` FAIL。
9. 冷人物硬凑六轨深度——没有材料就是没有材料，写进 `## Gaps`，不要编。
