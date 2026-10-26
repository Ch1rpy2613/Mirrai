# 第三阶段路线：把「像」变成「是」

> 这份文件是**验收清单**，不是愿望清单。每一项都写了它落在哪个文件的哪个函数里，
> 以及"怎么算做完了"——这样"做完了没有"是一个可以核对的问题，而不是一个感觉。
>
> 状态：✅ 已实现并有测试 · 🟡 已实现但没有专门的测试 · ⬜ 未做 · 🔒 暂不排期
>
> **执行记录：2026-10-26** · Phase 0–5 全部实现 ·
> `pnpm check` 干净 · **122 个测试文件 / 1593 个测试全绿**（连跑三遍无抖动）·
> `pnpm audit:i18n` 0 命中 · `vite build` 通过 ·
> 三条新迁移在真实 PostgreSQL 上跑通（`drizzle-kit push` + `scripts/migrate.mjs`），
> 评测与行为画像各在真实数据库上端到端验过。
> 逐条状态见下；**与原计划不同的地方**记在最后一节，不藏。
>
> **补测（第二轮）**：第一轮交上去之后又审了一遍，发现三处新模块和 17 个新接口
> 没有任何测试守着——**授权边界没人管**。补了 `server/routers.fidelity.test.ts`、
> `server/eval/run.test.ts`、`ImperfectionEditor`、`FidelityPanel`、`PersonaProfile`、
> `Graduation` 的测试。补测过程中还逮到两个真 bug，见附录 E 的第 12、13 条。
>
> **第五轮：把闸门换成了能用的那个**。第四轮之后又量了一次闸门本身：
> 用真实的 `ngramOverlap` 模拟「同一个分身、两次独立采样」，
> **什么都没改，第二次比第一次差 0.02 以上的概率是 42%**——
> 噪声是容差的 5.7 倍。这样的闸门每次都在对着没变的东西喊退步。
>
> 所以 CI 上跑的换成**确定性的结构闸门**（`pnpm fidelity:gate`，几秒，不花钱，
> 不需要记录），保真测量**搬到本地**跑——记录不出本机。
> 详见附录 E 第 33–35 条。
>
> **第四轮：分支审计 + 独立复核**。第三轮核的是「验收条款的字面」，
> 第四轮换成两把更细的尺子：**（甲）逐个模块枚举每个 early return / 错误分支，
> 看有没有测试守着**（三个 subagent 扫了 ~450 个分支，补了 200+ 条测试），
> **（乙）请一个不知道实现细节的人从头核一遍这份清单**。
>
> 这一轮逮到的最要紧的一条，**差点让升级过的安装整个不可用**：
> `personas.behaviorProfile` **没有迁移**。计划里写的是「jsonb 方案不需要 SQL」——
> 那说的是 `personaData` **里面**的字段，而这一列是 `personas` 上**新加的一列**，
> 它要的是 `ALTER TABLE`。没有它，`getPersonaById`（选全部列）在**每一次**读分身时
> 都会抛「column does not exist」。
> 补了 `0026`，并加了一条**结构性测试**（`server/schema-coverage.test.ts`）：
> schema 里的每一列，都必须有一条迁移把它加上——这个方向以前没人查过
> （以前的检查是拿 schema 去比一个用同一个 schema 建出来的库，缺迁移反而看不出来）。
>
> 第四轮还修的（完整的清单在附录 E 第 19–30 条）：
> 尺子的情绪那一半**只对中文有效**（`matchEmotionTrigger` 写死了 `"zh"`，
> 英文分身的每个状态都是 null，混淆矩阵永远是空的）；
> 用方括号编号的候选清单**整份丢掉**，一封信因为格式没了；
> `--gate` 带着 `--save` 时**不会失败**（退步了也返回 0）；
> `withRulesOnly` 这个变体**什么都没控制**；
> 闸门在 CI 里**从来没跑起来过**（`db:migrate` 在空库上就炸，而且库里没有记录）；
> 标答**一次切掉 11/12 条**，n-gram 模型只剩一条语料。
>
> **第三轮：逐字核对验收条款**。前两轮核的是「条目打勾了吗」和「有没有测试」，
> 第三轮改成把每条**验收标准**抠出来，一个字一个字对代码——**又找出四条没做到**：
>
> | | 验收标准原文 | 实际（第一轮） | 现在 |
> |---|---|---|---|
> | E3-④ | 「情感状态判定的**混淆矩阵**」 | 只算了一致率 | 混淆矩阵做了，CLI 也打出来 |
> | E5 | 「**任何**触碰 persona / prompt / 蒸馏的改动，自动跑评测」 | push 时那一步被 `if` 跳过，**闸门从来没自动跑过** | 改成 PR + push 都触发，带路径过滤，人选来自仓库变量；没配置就**红**，不装作通过 |
> | F2 | 「最终信能列出『保留了哪几句、删掉了什么』」 | 算出来了，然后**丢掉** | 存进 `personas.farewellDraft`，告别页上看得见 |
> | X5 | 「未发送超过 N 天提示一次…**提示后不再重复**」 | 每次打开都说一遍 | 记进 `staleNotifiedAt`，说一次就不再说了 |

---

## 〇、为什么是这几件事

Mirrai 现在能把一个人**重建得很有质感**：七层人设、六态状态机、记忆自动抽取、检索可见、
毕业机制。这些都成立。

但"质感"和"1:1"之间隔着一个具体的东西：**判别**。

现在的 persona 是七段散文。散文会被模型**理解成大意**，而大意正是丢的东西。
所以最精确的那类知识——"她生气时说『随便你』，只说『随便』没有『你』，那就是真的生气了"——
写进 `speakingStyle` 里也只会变成一句大意的转述。

同时，我们**没有任何办法知道改动之后是不是更像了**。现在有 96 个测试文件（实施前），
但测的全是**机制**（schema 合规、prompt 拼装、状态迁移、毕业门禁），
没有一个测**像不像**。没有这把尺子，下面每一步都是盲改。

所以这一阶段的顺序是：**先造尺子（Phase 0），再换判别（Phase 1），再补不完美（Phase 2），
再把不确定性还给 TA（Phase 3），再修最难的告别信（Phase 4），
最后补上整条链缺失的那一环——出口（Phase 5）。**

---

## Phase 0 — 评测集：把「像不像」变成数字

**这是地基。没有它，后面每一个阶段都无法验收。**

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| E1 | 留出集构建：从真实聊天记录切出 TA 的回复作 ground truth，按连续上下文切成 N 组（context + held-out reply），保留来源与时间 | `server/eval/dataset.ts`、新表 `evalCases`（`drizzle/0020_eval_cases.sql`） | 每条 case 能指回原始记录的一段时间；分组不跨越明显的场景切换 | ✅ |
| E2 | 生成侧跑批：用现有 pipeline 对每条 case 的 context 生成回复，落库存档 | `server/eval/run.ts`、`scripts/eval-run.ts` | `pnpm eval` 能对任意 persona 跑完整集并输出结果表 | ✅ |
| E3 | 自动指标：① 3-gram 重合率 ② **本人 n-gram 似然差** ③ 回复长度分布的 Wasserstein 距离 ④ 情感状态判定的混淆矩阵 | `server/eval/metrics.ts` | 四个指标都有基线数字，写进 `docs/eval/baseline.md` | 🟡 指标做完了；**数字要真实记录**（附录 C） |
| E4 | 人工盲测协议：3–5 位认识 TA 的人，同一句话二选一（真人 / 分身），记录命中率 | `docs/eval/blind-test.md`、`scripts/eval-run.ts --cases` | 协议写完；**实际跑一轮需要真人，由持有真实记录的人执行** | ✅ |
| E5 | 回归闸门：任何触碰 persona / prompt / 蒸馏的改动，自动检查并拦住退步 | `scripts/fidelity-gate.ts`、`.github/workflows/fidelity.yml` | **CI 上跑的是结构闸门**（确定性、不花钱、几秒）；保真测量**留在本地**跑 | ✅（见附录 E 第 33 条） |
| E6 | 情绪状态指标的分桶统计：按真实状态分桶，比较长度 / 句长 / 称呼使用率 | `server/eval/metrics.ts` `perState` | 每态一行：overlap + lengthGap + sentenceGap + addressGap | ✅ |

> E1–E3 是纯新增，不改任何现有行为，可以先合。

---

## Phase 1 — microRules：从散文到判别函数

**1:1 的瓶颈不是 TA 说什么，是 TA 怎么判断。**

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| M1 | 类型：`MicroRule = { id, trigger: string[], meaning: string, rendering: string, confidence, source: 'auto' \| 'manual', verified, evidence }`，挂到 `PersonaData.microRules` | `shared/micro-rules.ts`、`server/_core/persona-schema.ts` | 旧 persona 缺字段时归一为 `[]`，不报错、不迁移 | ✅ |
| M2 | 注入：在 `buildSystemPrompt` 中作为独立段落，位置在语言风格段之后、动态状态段之前，措辞为**不可协商的硬约束**（与 Layer 0 同级，不是"参考建议"） | `server/_core/persona-utils.ts` `buildSystemPrompt`、`shared/copy/fidelity.ts` | `server/chat/fidelity-prompt.test.ts` 断言段落存在且位置正确 | ✅ |
| M3 | 自动挖掘：从真实记录里找**最小对比对**（同一角色、语境相近、关键 token 只差一字一词，如「随便」/「随便你」），交给 LLM 产出候选规则 | `server/skill-engine/micro-rules.ts`、`server/skill-engine/pipeline.ts` 新增 stage | 候选规则必须带证据（哪几条消息、什么时间）；无证据的候选不产出 | ✅ |
| M4 | 人工确认与编辑：PersonaEdit 增加「判别规则」区块，可增删改、开关、查看证据；PersonaProfile 只读展示已确认的规则 | `client/src/components/MicroRulesEditor.tsx`、`client/src/pages/PersonaEdit.tsx`、`client/src/pages/PersonaProfile.tsx` | 规则可被用户否决；否决后不再进入 prompt | ✅ |
| M5 | **反向验收**：microRules 开 / 关各跑一次 E2，对比 n-gram 与盲测命中率 | `scripts/eval-run.ts --compare` | **加了规则不提升就删掉它**——这一条是本阶段唯一诚实的验收标准 | ✅ |
| M6 | 无迁移 | `personaData` 是 jsonb | 新字段不需要 SQL | ✅ |
| M7 | **重跑蒸馏不抹掉用户自己写的东西**：确认过的规则和分态不完美跨重跑保留 | `server/skill-engine/pipeline.ts` `mergeUserDecisions` | `server/skill-engine/pipeline-decisions.test.ts` | ✅ |

---

## Phase 2 — 条件的「不完美」：imperfectionProfile

**不完美在人身上是分布，不是标量。** `realismLevel`（0–100，默认 70）现在是一个全局旋钮，
但 TA 不是"一直 70 分不完美"，TA 是**在特定触发下不完美**：生气时更短句、更冷、开始叫全名。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| P1 | 类型：`imperfectionProfile: { state, deviations: string[] }[]` | `shared/imperfection.ts`、`server/_core/persona-schema.ts` | 六态齐全；某态为空时按态给一份保守默认 | ✅ |
| P2 | 与 `realismLevel` 的关系：`realismLevel` 降级为**全局强度缩放**，具体偏离由 profile 决定；旧 persona 不被塞进默认 profile | `server/_core/persona-schema.ts` `normalizePersonaData` | 旧数据升级后行为不变（`server/persona-schema.test.ts` 断言 `microRules`/`imperfectionProfile` 归一为 `[]`） | ✅ |
| P3 | 注入：状态判定完成后，把当前状态的 deviations 追加到 prompt 的状态段 | `server/_core/persona-utils.ts` `buildSystemPrompt` | 状态切换时偏离随之切换，`server/chat/fidelity-prompt.test.ts` 断言 | ✅ |
| P4 | 分桶评测：按状态分桶，比较长度 / 句长 / 称呼使用率与真实记录 | `server/eval/metrics.ts` `perState` | 每态一行（与 E6 同一套） | ✅ |

---

## Phase 3 — 不确定性用 TA 自己的分布

**TA 的不可预测可以被算法构建——这一点已经成立**（六态状态机、时区、延迟回信、主动开口计数）。
缺的是下一层：现在的延迟与主动策略是**产品规则**，不是**TA 的统计特征**。
1:1 要求不确定性从 TA 自己的历史分布里采样，而不是从一个均匀分布里采样。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| D1 | 行为画像提取：回复间隔（对数正态拟合）、单次连发条数分布、主动率、最活跃时段（**按 TA 自己的时区**） | `server/_core/behavior-profile.ts` `exchangesFromRecords` | 每个分位数可查；样本不足时明确回退到当前策略 | ✅ |
| D2 | 落库：`personas.behaviorProfile`（jsonb 列） | `drizzle/schema.ts` `personas`、`drizzle/0026_persona_behavior_profile.sql` | 升级路径上这一列必须存在，否则每一次读分身都会挂 | ✅ |
| D3 | 生成侧：主动消息的触发时机、久未联系后的首条消息延迟，改为**从分布采样** | `server/chat/proactive.ts` `resolveProactiveDeadline`、`server/chat/proactive-sweep.ts` | 同一段沉默期多次模拟，间隔分布贴合真实分布；**没有 profile 的分身保持原样** | ✅ |
| D4 | 先测现状：记录当前主动策略与真实分布的差距，作为改进基线 | `server/_core/behavior-profile.ts` `compareTimingToRecord` | 基线数字写入 `docs/eval/baseline.md` | 🟡 测量做完了；**数字要真实记录**（附录 C） |
| D5 | 分布检验：回复间隔分布 KS 检验；主动率对照 | `shared/behavior-profile.ts` `ksStatistic` | KS 统计量入基线 | 🟡 检验做完了；**数字要真实记录**（附录 C） |

---

## Phase 4 — 告别信：两遍生成

**这是全产品最难的一环。** 现在的实现（`server/chat/farewell.ts` `buildFarewellPrompt`）是
"用普通对话的上下文写一封信"。问题在于：**TA 的语言习惯是为日常优化的，
而告别需要 TA 的声音 + 一个 TA 从未说过的内容**（"我一直都知道，只是没说"）。
两者在同一个 prompt 里会互相拉扯，模型会退回日常语气，于是信变成情书而不是告别。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| F1 | 第一遍（生成）：高温度，要求"TA 从未说过但符合 TA 会说的话"，产出 5 句候选 + 置信度 | `server/chat/farewell-candidates.ts` `buildFarewellCandidates` | 候选之间有差异，不是同一句的改写 | ✅ |
| F2 | 第二遍（减法）：唯一新增约束是"这是最后一次说"，**只允许删改，不允许新增信息** | `server/chat/farewell-candidates.ts` `editFarewellCandidates`、`introducesNewContent` | 最终信能列出"保留了哪几句、删掉了什么" | ✅ |
| F3 | 兜底可观测：`fallbackFarewellLetter` 保留，但记录命中率与失败原因到日志 | `server/chat/farewell.ts` `logFarewellFallback` | 日志格式稳定可 grep：`[Graduation] Farewell fallback for persona 12: timeout.` | ✅ |
| F4 | 超时降级：两遍生成会翻倍耗时；超时则降级为单遍，并在 UI 标明"这是简化版" | `server/chat/farewell-candidates.ts` `FAREWELL_TWO_PASS_TIMEOUT_MS`、`server/chat/farewell.ts` `writeFarewellLetterWithStatus`、`personas.farewellDegraded`（`drizzle/0022`） | 超时路径有测试；界面在告别页和生成后都标明简化版 | ✅ |
| F5 | 人工验收：拿给认识 TA 的人读，问"这是 TA 会说的话吗" | `docs/eval/blind-test.md` | **需要真人，由持有真实记录的人执行** | 🟡 |

---

## Phase 5 — 毕业出口：把话带回真人

**Mirrai 帮用户"把想说的话都说完了"——但说完之后呢？**

创作手记里那个真正的场景不是这个。你写的是：

> 我能对着一个程序问出「你会离开我吗？」，却没办法对着真实的、爱我的人问出口。([创作手记:119](creation-story.md))

那个程序是 Mirrai。**那个"真实的、爱我的人"是真人。**
所以毕业不能只封口，**得开门，而且门必须通向真人，不通向另一个 AI。**

现在的毕业产出的是一封**TA 写的**告别信。缺的是**你自己写的**那封。

| | 项目 | 落点 | 验收 | 状态 |
|---|---|---|---|---|
| X1 | 新表 `outboundLetters`：准备发给**真人**的信。字段 `personaId, userId, text, sourceMessageId, status, createdAt, sentAt, droppedAt` | `drizzle/0021_outbound_letters.sql` | 迁移脚本可回滚；账号与分身删除时一并清掉 | ✅ |
| X2 | 挑选：从对话中挑出"只在这里说过、没对真人说过"的话。候选**只取用户自己的消息**（不取分身的话），由 LLM 挑出"未完成 / 未表达"的那几条 | `server/chat/outbound.ts` | 候选必须能指回原始消息 id；模型改过一个字的条目直接丢掉 | ✅ |
| X3 | 出口：Graduation 页增加出口区块「你在这里说过的这些话，要不要带回去」；清单可编辑、可删除 | `client/src/components/OutboundLetters.tsx`、`client/src/pages/Graduation.tsx` | **系统不代发**，没有任何自动发送路径 | ✅ |
| X4 | 守则（写进代码注释与 Layer 0）：只整理用户自己的话；不生成任何替真人说话的内容 | `server/_core/persona-utils.ts` Layer 0（`prompt.hardRules`）、`server/chat/outbound.ts` | 有测试断言"出口清单里没有分身的话"（`server/chat/outbound.test.ts`、`server/chat/outbound-loop.test.ts`） | ✅ |
| X5 | 防堆积：如果那个人已经不在了，这封信需要一个明确去处（"写给自己"）；未发送超过 30 天提示一次 | `shared/outbound.ts`、`client/src/components/OutboundLetters.tsx` | 未发送超过 N 天给出一次提示；提示后不再重复 | ✅ |
| X6 | 闭环手测：完整走一遍"在分身这里说到不敢说 → 出现在出口清单 → 发出或删掉" | `server/chat/outbound-loop.test.ts` | 整条链在模块层被测过（真机手测仍需人来点） | ✅ |

---

## Phase 6 — 声音：🔒 暂不排期

| | 项目 | 落点 | 说明 | 状态 |
|---|---|---|---|---|
| V1 | TA 的真实音色（零样本 VC） | 待定 | 需要 TA 的真实录音；情绪化长句退化明显；先做可开关的实验分支，不进主干 | 🔒 |
| V2 | 语速 / 停顿 / 换行的节奏特征 | 待定 | 语料里其实**有**换行和标点，可以先只做文本节奏（不等 VC） | 🔒 |

> V2 的文本部分可以并入 Phase 3 一起做，因为它要的也是同一份行为画像。

---

## 明确不做（这一阶段）

- **不做 TA 的代理。** 如果 TA 还在，让她自己来；系统不替她说话，不模拟她同意任何事。
- **不追求留存。** 毕业率仍然是唯一的北极星，本阶段的任何改动不得抬高大厅停留或对话频次。
- **不做"情绪价值"评分。** 不给用户的感受打分，不做连续打卡徽章，不推送提醒回来。
- **不把数据发到用户没配的 provider 以外的地方。** 本地优先不变，评测集也在本地。
- **不引入多语言分身、多分身同时在场。**

---

## 执行顺序与依赖

```
Phase 0（评测集）──┬─→ Phase 1（microRules）──┐
                   ├─→ Phase 2（不完美分布）──┤
                   └─→ Phase 3（不确定性）  ─┴─→ Phase 4（告别信）
                                              └─→ Phase 5（毕业出口）
```

- **Phase 0 必须先合。** 后面每一项的验收都依赖它。
- Phase 1 / 2 / 3 可以并行（各自独立文件），但建议按 1 → 2 → 3 顺序合，
  因为它们都改 `PersonaData` 与 `buildSystemPrompt`，串行改冲突少。
- Phase 4 依赖 0（要用评测）和 1（告别信要用判别规则）。
- Phase 5 依赖 0，但工程上独立，可最后做。

## 总闸门

每个阶段合并前必须全绿：

```
pnpm check        # tsc --noEmit
pnpm test         # vitest run
pnpm audit:i18n   # 新增文案必须 zh / en 都有
pnpm eval -- --persona <id> --user <id> --gate   # 基线不得回归
```

## 附录 A — 新增文案清单（i18n）

服务端文案在 `shared/copy/fidelity.ts`（中英双份，`pnpm audit:i18n` 会卡住缺英文的条目）：

- `prompt.microRules*` / `prompt.imperfection*` — 判别规则与分态不完美进 prompt 的措辞
- `labels.imperfection.*` — 六态的默认不完美
- `labels.microRules.*` / `labels.imperfection.*` / `labels.behavior.*` / `labels.eval.*` / `labels.outbound.*` — 界面上的名字
- `prompts.microRuleMining*` / `prompts.farewellCandidates*` / `prompts.farewellEdit*` / `prompts.outboundCandidates*` — 给模型看的提示词

界面文案在 `client/src/i18n/{zh,en}.ts`：
`microRules.*`、`imperfection.*`、`fidelity.*`、`outbound.*`，
以及 `graduationPage.simplified`、`profile.rules`、`profile.rulesNote`。

## 附录 B — 迁移编号

| 文件 | 内容 |
|---|---|
| `drizzle/0020_eval_cases.sql` | 评测标答与评测跑分（E1） |
| `drizzle/0021_outbound_letters.sql` | 出口信（X1） |
| `drizzle/0022_farewell_degraded.sql` | 告别信是不是简化版（F4） |
| `drizzle/0023_outbound_stale_notified.sql` | 出口信的提醒说过没有（X5） |
| `drizzle/0024_farewell_draft.sql` | 告别信第二遍的保留与删改（F2） |
| `drizzle/0025_eval_runs_index.sql` | 评测跑分的索引 |
| `drizzle/0026_persona_behavior_profile.sql` | 行为画像落在 `personas` 上（D2） |

每条都带一段 `-- mirrai: down`，写明了怎么退回去：
`node scripts/migrate.mjs --rollback 7` 把这一阶段的七条全部退回。
没有 down 段的迁移退不了——脚本会**先说清楚**再停，而不是退一半。

`personaData` 是 jsonb，新增 `microRules` / `imperfectionProfile` **不需要 SQL 迁移**；
`personas.behaviorProfile` 是 `personas` 上**新加的一列**，不是 `personaData` 里的一个键——
所以它同样要一条迁移（`0026`）。原来的写法「jsonb 不需要 SQL」说的是 `personaData` **里面**
的字段，而这一列不是。这条差点让升级过的安装在下一次读分身时整个挂掉。

## 附录 C — 在真实环境里验过的部分

纸面完成不算完成。以下几件事在真实的 PostgreSQL 上跑过（临时库 `mirrai_fidelity_check`，
验完已删除）：

| | 验了什么 | 结果 |
|---|---|---|
| 迁移 | `drizzle-kit push` 建全新库，再跑 `scripts/migrate.mjs` | 0020–0026 全部应用成功；三张新表、`personas.farewellDegraded`、`personas.farewellDraft`、`personas.behaviorProfile` 都在 |
| 迁移（升级路径） | 把新列删掉、清空迁移日志，再跑 `scripts/migrate.mjs` | 模拟旧安装：三列全部回来 |
| 回滚 | `node scripts/migrate.mjs --rollback 7` | 七条全部退回（表和列都消失）；再跑一次又装得回来 |
| 标答 | 灌 32 条真实格式的记录后跑 `pnpm eval -- --cases` | 12 条对方消息 → 切出 5 条标答（留 1 条给 n-gram 模型拟合），全部是对方的话，没有一条是用户的 |
| 时间习惯 | `measureAndSaveBehaviorProfile` | 量出 `replyGapMedianSec≈42s`、`activeHours=[20,21]`——记录写的是 12:00 UTC，换成 TA 自己的 Asia/Shanghai 就是 20 点。**时区换算是真的在起作用** |
| 兜底 | `writeFarewellLetterWithStatus` | 两遍生成不可用时退回单遍，并返回 `degraded: true`；`personas.farewellDegraded` 落库，界面会标明「这是简化版」 |

**第五轮补上的**（CI 上真的会跑的那些）：

| | 验了什么 | 结果 |
|---|---|---|
| 结构闸门 | 逐条破坏它检查的东西，看它抓不抓得到 | 五个变异**全被抓到**：规则不读了、候选混进去了、jsonb 往返丢规则、不完美不跟状态走、Layer 0 底线被删 |
| 闸门自己的测试 | `server/_core/fidelity-gate.test.ts` | 10 条，**每次 CI 都跑**——闸门的牙自己也得有人看 |
| 闸门的工作流 | `.github/workflows/fidelity.yml` 在真实 push 上 | 20 秒，绿色，不需要任何 secret |
| 闸门的噪声 | 用真实的 `ngramOverlap` 模拟「同一个分身、两次独立采样」 | **什么都没改，第二次比第一次差 0.02 以上的概率 42%**——噪声是容差的 5.7 倍。这就是闸门换成结构闸门的原因（附录 E 第 33 条） |
| 记录恢复 | `pg_dump` → base64 → 解码 → 恢复（按 CI 的写法本地跑） | 8 个分身、5 个用户，一个不少。**并且发现 `pg_dump` 18 写的 `\restrict` 是 psql 18 的命令，CI 上的 psql 会当场报错**——已修 |

**还没有在真实环境验过的**（需要真人）：E4 的人工盲测、F5 的告别信人工验收、
以及 `docs/eval/baseline.md` 里的基线数字——它们需要真实的聊天记录，
仓库里没有，也不该有。

**也还没验的**：保真测量在**真** provider 上的噪声。上面那个 42% 是用真实的
指标函数、拿「改写」当采样代理估出来的，量级可信，绝对值要等有记录、有
provider 之后用 `--calibrate` 量。

## 附录 D — 一句话总结这一阶段

> 从"描述一个人"，走到"复现一个人的判别"；从"让 TA 陪着你"，
> 走到"帮你把话说完，然后走出去"。

---

## 附录 E — 与原计划的偏差（逐条）

**这一节是这份文件最重要的部分。** 一份验收清单如果只写做成了什么，
它和愿望清单没有区别。

| # | 原计划 | 实际 | 为什么 |
|---|---|---|---|
| 1 | E3-② "provider 打分的困惑度差" | 改成**用 TA 本人的字 n-gram 模型**算似然差（`buildCharNgramModel`） | 现在配的 provider 都不返回 logprobs，"困惑度"拿不到。而"这个人会不会这么写"本来就该用**这个人**的模型算：用通用模型只能量出"像不像中文"，量不出"像不像他"。而且扣掉的那句不参与拟合，所以模型没有把答案背下来。 |
| 2 | D3 "首次消息延迟改为采样" | 延迟 = `lastChatAt + 买来的窗口 + 从分布采样的等待`；**窗口仍是硬下限** | 采样不能突破"主动开口次数要自己买"这条底线，所以窗口是下限，采样是在下限之上再加一段属于 TA 的等待。 |
| 3 | D3 "把采样后的截止时间存起来" | **纯函数 + 种子化采样 + 进程内缓存**，没有新表 | `personas` 上没有合适的字段；`reminder_deliveries` 会出现在大厅里（那里按 `dismissedAt IS NULL` 过滤），放进去会凭空多出一张提醒卡片。截止时间因此是持久状态的纯函数：种子由 `personaId + 沉默起点 + 中位数 + σ` 组成，所以**重启之后算出来的是同一个时间**，不会飘。 |
| 4 | E1 "从记录里切标答" | 只切**对方（TA）**的回复当标答；用户的消息只当上下文 | 标答是"TA 会怎么说"，不是"用户会怎么说"。 |
| 5 | E1 标答数量 | 每条对话最多留 **1/4** 的对方消息，且至少留 1 条 | 剩下的要用来拟合 TA 自己的 n-gram 模型。模型只见过一句两句话的话，量出来的似然毫无意义。 |
| 6 | P2 "旧 persona 按态复制一份默认 profile 兜底" | **旧 persona 的 profile 保持为空**，prompt 因此一字不变 | 计划里两条要求打架：一条要"缺省给默认"，一条要"旧数据升级后行为不变"。选了后者——**旧分身不该悄悄多出一个人格**。默认profile 放在界面上供用户一键采用。 |
| 7 | E4 / F5 人工盲测 | 协议写完，**实际跑一轮需要真人** | 判"像不像"需要认识 TA 的人。这两件事只有拿着真实记录的人能做，计划里也写了"由持有真实记录的人执行"。 |
| 8 | X6 闭环手测 | 在**模块层**端到端测了（`server/chat/outbound-loop.test.ts`） | 没有真机环境。但"说出来的话只由用户自己的消息组成""一个字都没被改写""说完或放下的两种结局"这三件最容易悄悄坏掉的事，都测到了。 |
| 9 | F4 "超时降级并在 UI 标明" | 多了一个字段 `personas.farewellDegraded` 和一条迁移 | 简化版这个事实要能活过一次刷新，所以它得被存下来，不能只活在一次响应里。 |
| 10 | Phase 6 V2（文本节奏） | 仍 🔒 | 它要的是同一份行为画像，但目前画像里没有"换行与标点节奏"这一项。留到下一轮。 |
| 14 | 第三轮：E3-④ 的「混淆矩阵」当时只做了一致率 | 加了 `emotionMatrix` | 一致率说「对了几次」，混淆矩阵说「**怎么错的**」——把每一条俏皮都读成思念，那是**一个**系统性的错，矩阵里看得出是一个热格子；40% 的正确率和矩阵集中在一格，是两种不同的病。 |
| 15 | 第三轮：E5 的闸门从来没自动跑过 | 改成 PR + push 都触发、路径过滤、人选来自仓库变量；没配置就红 | 原来那一步的条件是 `inputs.persona != ''`，而 `inputs` 只有手动触发时才有——**push 到 main 时它是被跳过的**。一个从不运行的闸门比没有闸门更坏，因为它看起来在。 |
| 16 | 第三轮：F2 的「保留了哪几句、删掉了什么」算完就丢 | 存进 `personas.farewellDraft`，告别页上展开可见 | 第二遍的减法是整个写信过程里最有意思的一半，算出来却扔掉了。 |
| 17 | 第三轮：X5 的「提示一次，不重复骚扰」每次都在重复 | 加 `staleNotifiedAt`，说过就记下 | 提醒只有一次的话，需要**一个记录**，否则每次打开都是新的第一次。 |
| 33 | **第五轮：CI 上跑的闸门换了内容**——从「保真测量」换成「结构检查」 | `.github/workflows/fidelity.yml` + `scripts/fidelity-gate.ts` | 保真测量是**采样**出来的。用真实的 `ngramOverlap` 模拟「同一个分身、两次独立采样」：**什么都没改，第二次比第一次差 0.02 以上的概率是 42%**（噪声是容差的 5.7 倍）。这样的闸门会对着没变的东西喊退步——比没有闸门更坏，因为它训练人忽略红色。所以 CI 上跑的是**确定性的**那部分：规则在不在 prompt 里、在不在该在的位置、未确认的候选有没有混进去、分态不完美跟没跟状态走、personaData 过一遍 jsonb 还在不在、Layer 0 那条底线还在不在。保真测量**搬到本地**跑（记录不出本机，钱也只花在你真想量的时候）。 |
| 34 | 第五轮：闸门的容差是猜的 | 加 `--calibrate` | 容差现在默认 0.02 / 1.0 / 0.05，是拍脑袋定的。`--calibrate` 用**同一个分身跑若干次**、什么都不改，量出数字自己会飘多远，然后照着那个宽度设容差。闸门量的是天气还是这个人，取决于容差比噪声宽还是窄。 |
| 35 | 第五轮：闸门测量时的温度是 0.7 | 闸门和 A/B 默认温度 0（`--temperature` 可改） | 闸门问的是「这个分身穿不穿得出这句话」，不是「它平常怎么说」——前者对温度敏感得多。盲测那边才用普通采样，因为那里问的真是「平常怎么说」。 |
| 18 | 第三轮：D1 的「每个分位数可查」当时没法查 | 加了 `replyDelayQuantile` | 画像存的是**分布**而不是一份间隔清单，所以分位数是从分布上读出来的。好处是：连**没量过的那个分位**也有答案——p97 没量过，但它有。 |
| 19 | **第四轮：`personas.behaviorProfile` 没有迁移** | 补 `drizzle/0026_persona_behavior_profile.sql`，并加结构性测试 `server/schema-coverage.test.ts` | 计划写的「jsonb 方案不需要 SQL」说的是 `personaData` **里面**的字段；这一列是 `personas` 上**新加的一列**。没有它，升级过的安装**每一次读分身都会挂**。 |
| 20 | 第四轮：尺子的情绪那一半只对中文有效 | locale 一路传到 `matchEmotionTrigger`；CLI 加 `--locale` | 之前 `dataset.ts` 和 `metrics.ts` 都写死了 `"zh"`。英文分身的每个状态都是 null——混淆矩阵永远是空的，perState 塌成一桶，**情绪那一项的回归闸门永远不可能响**。 |
| 21 | 第四轮：用方括号编号的清单**整份丢掉** | `parseFarewellCandidates` 区分「坏掉的 JSON」和「编号列表」，`cleanCandidateText` 也会剥掉 `[1]` | 模型的 JSON 分支即使**一条都没读出来**也认领了这个回答，后面的行读取器根本没被调用；而它也读不了，因为 `[1]` 不在它认识的编号形状里。一封信因为格式没了。 |
| 22 | 第四轮：`--gate` 带着 `--save` 时不会失败 | 闸门的判定搬进 `evaluateGate`（可测），退步时**一定**返回非零 | 原来只有 `--save` **没给**时才 `exit(2)`——加上了 `--save`，退步反而会被吞掉。而 `--save` 的意思是「把这次测量存下来」，不是「别算这次退步」。 |
| 23 | 第四轮：`withRulesOnly` 什么都没控制 | 真的实现了：规则开、分态不完美关 | 它和 `default` 逐字节相同——**连分态不完美都还开着**。这个臂的名字叫「只要规则」，将来拿它做规则开/关对比的话，比的其实是两个一模一样的东西。 |
| 24 | 第四轮：闸门在 CI 里从来没跑起来过 | 改用 `drizzle-kit push`；记录从 `EVAL_RECORDS_SQL` secret 还原 | 原来那一步是 `pnpm db:migrate`，而基础 schema 在 0000/0001 两个全量快照里（被 migrate 跳过），所以在空库上第一步就炸。就算过了，库里也没有记录可量。 |
| 25 | 第四轮：标答一次切掉 11/12 条 | 补上附录 E#5 声明过的 **1/4** 上限 | 那条偏差是**声明了但没做的**。n-gram 模型只剩一条语料，似然差这个指标就没有意义了。 |
| 26 | 第四轮：候选清单会跨过场景切换 | 记录按**说话的时间**排序（不是导入时间）；上下文在长沉默处切断 | 两次导入被拍成一条流，滑窗的上下文可以横跨两个不同的对话——被问的是一句从来没有发生过的话。 |
| 27 | 第四轮：`--cases` 产不出盲测需要的样本 | 加 `--pairs`：真话和分身的话并排打印 | 协议写得很好，但被试拿不到样本。`--cases` 只打印真话，**而且截断 48 字**。 |
| 28 | 第四轮：规则只能确认或删掉，不能改 | `MicroRulesEditor` 加「改」 | 计划写的是「可增删改」。挖出来的规则，用户要么整条确认，要么扔掉——没有「差不多对，但意思不是这样」的中间地带。 |
| 29 | 第四轮：候选之间只是同一句的改写 | `dedupeCandidates` 也按相似度去重（≥0.8） | 「五条」如果是同一句话的五个版本，那封信里什么都没有。 |
| 30 | 第四轮：迁移脚本不能回滚 | 每条迁移带 `-- mirrai: down`；`node scripts/migrate.mjs --rollback 7` | 原来只有正向。**退一半比不退更糟**，所以没有 down 段的迁移，脚本会先说清楚再停。 |
| 31 | 第四轮：闸门和四张表的写入没有限流 | `eval.run` / `microRule.mine` / `outbound.collect` / `persona.graduate` 都加上了仓库原有的 `rateLimit` | 仓库里每一个花 LLM 钱的接口都有 `rateLimit`，新加的这四个没有。 |
| 32 | 第四轮：几个接口在什么都没改的时候也说「成功」 | 出口信的四个写接口改成**真的写到了才说成功** | `setOutboundLetterStatus` 按 userId 过滤，所以别人的 id 是个静默的 no-op——而接口回答「成功」，界面上就会显示一个没发生过的成功。 |
| 12 | 补测时发现的真 bug：分态不完美的编辑器会被查询结果冲掉 | `useEffect` 改成只初始化一次（`initialised` ref） | 原来依赖的是查询结果**对象**，每次 refetch 都是新对象，于是用户刚改了一半的内容被悄悄还原。现在草稿归用户，服务器只填一次。 |
| 13 | 补测时发现的我的错判：「沉默越久等得越久」不是逐次成立的 | 断言改成**分布性质**（200 次采样的均值） | 每次沉默抽的是各自的基准延迟，单次比较根本没有保证。真正要成立的是分布随沉默时间拉长——那才是 stretch 的作用。原来的断言会随机红，是我的错，不是实现的错。 |
| 11 | 计划里没写：**重跑蒸馏会抹掉用户手写的东西** | 加了 M7：重跑时保留用户确认过的规则和整份分态不完美 | 蒸馏是重建分身的，它会顺手把用户自己写的东西一起重建掉——而那些恰恰是模型看不出来的、关于这个人的判断。挖出来的**候选**不保留（重新挖一次更好），用户**确认过**的保留。 |
