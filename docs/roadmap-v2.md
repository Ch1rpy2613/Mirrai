# 第二阶段路线：把「用户」和「关系」变成一等公民

> 这份文件是**验收清单**，不是愿望清单。每一项都写了它落在哪个文件的哪个函数里，
> 这样「做完了没有」是一个可以核对的问题，而不是一个感觉。
>
> 状态：✅ 已实现并有测试 · 🟡 已实现但没有专门的测试 · ⬜ 未做

---

## Phase 0 — 修 bug 与已承诺的语义

严重 bug 排在最前面，因为它们让「已承诺的东西」根本没有兑现。

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| U1.1 | 毕业模态框每轮弹一次 → 命中时锁存 `suggested` + 冷却期 | `server/_core/graduation.ts` `canOfferGraduation` | ✅ |
| U1.2 | 告别信用错 provider → `resolveProviderForUser` + try/catch | `server/chat/farewell.ts` `writeFarewellLetter` | ✅ |
| U1.3 | 告别信没有记忆 → 完整 prompt 组装（锚点 + 相关记忆） | `server/chat/farewell.ts` `buildFarewellPrompt` | ✅ |
| U1.4 | 情绪落库时序错 → 推断移到落库之前 | `server/chat/service.ts` | ✅ |
| U1.5 | 分开日期不生效 → `togetherTo` 有值时停关系型提醒、prompt 改「已结束」 | `server/scheduler/reminders.ts`、`server/_core/persona-utils.ts` | ✅ |
| U1.6 | 时区缺失 → `users.timezone` + `personas.timezone`，prompt 用分身所在地时间 | `shared/timezone.ts` | ✅ |
| U1.7 | 「对话过久」测的是空闲间隔 → 改真实会话时长 | `server/db.ts` `getSessionStartAt` | ✅ |
| U1.8 | 计数口径翻倍 → 只数 user 消息 | `server/safety/usage-monitor.ts` | ✅ |
| U1.9 | 依赖信号几乎触发不了 → 提为最高优先级 | `server/safety/usage-monitor.ts` | ✅ |
| U1.10 | 轨迹 `worsening` 被丢弃 → 消费为克制的关心 | `server/chat/service.ts` | ✅ |
| U1.11 | 危机没有专用 UI → 危机卡片 + 消费 `crisis` 标志 | `client/src/pages/Chat.tsx` | ✅ |
| U1.12 | suggested/declined 不可逆 → 可重开 | `server/_core/graduation.ts` | ✅ |
| U1.13 | 毕业后仍在打扰 → 提醒/大厅推荐/对话都排除 graduated | `server/scheduler/reminders.ts`、`client/src/pages/Lobby.tsx` | ✅ |
| U1.14 | 信件唤醒即销毁 + 导出不含信 → 保留 + 导出 | `server/db.ts` `setGraduationStatus`、`server/_core/export-data.ts` | ✅ |
| U1.15 | 资源热线未复核 → 测试闸门 | `server/safety/*.test.ts` | ✅ |
| U8 | `presence` 与 `graduationStatus` 分离 | `shared/graduation-mode.ts` | ✅ |

## Phase 1 — 把「用户」和「关系」变成一等公民

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| I1 | 用户心情打卡与档案 | `shared/user-side.ts`、`client/src/components/MoodCheckIn.tsx` | ✅ |
| I4 | 关系事件流与分开日期语义 | `shared/user-side.ts`、`server/db.ts` `createRelationshipEvent` | ✅ |
| U9 | 安全层可见与双向 | `client/src/components/SafetyTransparency.tsx`、`server/routers.ts` `safety.*` | ✅ |
| U10 | 伦理对齐（透明性 / 无害性 Layer 0 / 前任同意权 / 本地优先开关） | `server/_core/persona-utils.ts` Layer 0、`client/src/pages/Onboarding.tsx`、`client/src/pages/Settings.tsx` | ✅ |

## Phase 2 — 交互可用性

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| U2 | 消息级操作（复制 / 引用 / 编辑 / 重新生成 / 删除） | `client/src/pages/Chat.tsx` `MessageBubble` | ✅ |
| U3 | 历史翻页 + 跨分身搜索（消息 / 记忆 / 日记） | `server/routers.ts` `chat.getHistory` / `chat.searchAll` | ✅ |
| U4 | 流式健壮性：降级路径可中止、图片/语音路径可中止、不丢 careNote | `server/_core/context.ts` `requestAbortSignal`、`client/src/pages/Chat.tsx` | ✅ |
| U5 | 记忆管理：自动提取（节流）+ 去重 + subject + 注入可见 + 截断可见 | `server/chat/memory-extract.ts` | ✅ |
| U5.1 | 注入的记忆写进消息行（刷新后仍然看得见） | `drizzle/0017_recalled_memories.sql` | ✅ |
| U6 | 导出完整：JSON / Markdown / HTML（跟随语言） | `server/_core/export-data.ts`、`server/_core/export-html.ts` | ✅ |
| U7 | 语义对齐：情绪计数、趋势纵轴、TTS 语音、限流分桶、prompt 一致、retrievalK | 见下方「U7 明细」 | ✅ |
| I7.1 | 沙盒分身（不传素材先试） | `server/routers.ts` `persona.createSandbox` | ✅ |
| I7.2 | 全局搜索（⌘K） | `client/src/components/CommandPalette.tsx` | ✅ |
| I7.3 | 人格档案页 | `client/src/pages/PersonaProfile.tsx` | ✅ |

### U7 明细

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| U7.1 | 情绪报告的 message count（原来恒为 1） | `server/db.ts` `getUserMessageCountForPersonaSince` | ✅ |
| U7.2 | 情绪趋势纵轴（原来是把情绪序号当高度） | `client/src/pages/Chat.tsx` `EmotionReport` | ✅ |
| U7.3 | TTS 语音选择器 | `server/_core/tts.ts` `TTS_VOICES` | ✅ |
| U7.4 | TTS 占用 `llm` 限流桶 | `server/_core/rate-limit.ts` | ✅ |
| U7.5 | `persona.getSystemPrompt` 与对话用同一份 prompt | `server/chat/prompt.ts` `buildPromptForPersona` | ✅ |
| U7.6 | `retrievalK` 暴露到设置 | `client/src/pages/Settings.tsx` | ✅ |
| U7.7 | `realismLevel` 暴露到设置 | `client/src/pages/PersonaEdit.tsx` | ✅ |

## Phase 3 — 创新主场

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| I2 | 未寄出的信：只写下来 / 交给 TA 延迟回信 / 等 TA 回来再说 | `server/chat/letters.ts`、`client/src/components/LetterBox.tsx` | ✅ |
| I3 | 距离感：暂时联系不上、双方时钟、上次联系的天数 | `shared/user-side.ts` `buildReachabilityNote`、`shared/timezone.ts` `daysSinceContact` | ✅ |
| I4.3 | 缓一缓：停掉打扰，不停掉关系 | `client/src/pages/PersonaEdit.tsx`（`presence = "quiet"`） | ✅ |
| I5 | 分身主动：频率可调、默认从不、基于真实上下文、优先走已绑通道、尊重静默时段 | `server/chat/proactive.ts`、`server/chat/proactive-sweep.ts` | ✅ |
| I6 | 告别仪式：告别页（信 + 时间线 + 时刻 + 日记） | `client/src/pages/Graduation.tsx` | ✅ |
| I8 | 触发式创伤：克制的回应，指令会过期 | `shared/user-side.ts` `buildRelationshipSection` | ✅ |

### I3 明细

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| I3.1 | 「暂时联系不上」≠ 分开：语气转书信体 | `server/_core/persona-utils.ts` | ✅ |
| I3.2 | 停掉关系型推送（纪念日、相识周年） | `server/scheduler/reminders.ts` `collectReminders` | ✅ |
| I3.3 | 大厅说明为什么它安静了 | `client/src/pages/Lobby.tsx` | ✅ |
| I3.4 | 「上次联系」作为一等公民数字 | `shared/timezone.ts` `daysSinceContact` + 聊天头部 | ✅ |
| I3.5 | 信可以只写下来，不被回答 | `server/chat/letters.ts` | ✅ |
| I3.6 | 延迟回信（20 小时后） + 回信间隔（12 小时） | `shared/letters.ts` `resolveReplyAt` / `earliestAnswerAt` | ✅ |
| I3.7 | 交出去的信进入对话，回信也进入对话（标为「回你的信」） | `server/chat/letters.ts` `writeLetter` / `answerDueLetters` | ✅ |

### I5 明细

| | 项目 | 落点 | 状态 |
|---|---|---|---|
| I5.1 | 频率用户自设，可为 0，默认 0 | `drizzle/schema.ts` `proactiveFrequencyHours` | ✅ |
| I5.2 | 内容基于真实上下文（记忆 / 双方时钟 / 距离 / 用户状态） | `server/chat/proactive.ts` `collectProactiveContext` | ✅ |
| I5.3 | 优先走已绑定的微信 / 飞书 | `server/chat/proactive-sweep.ts` `deliverProactive` | ✅ |
| I5.4 | 尊重静默时段 | `server/chat/proactive-sweep.ts` | ✅ |
| I5.5 | 对话页轮询，主动消息真的会出现 | `client/src/pages/Chat.tsx` `refetchInterval` | ✅ |
| I5.6 | 时差是具体的数字（「比用户快 6 个小时」），不是「另一个时区」 | `server/chat/proactive.ts` `collectProactiveContext` | ✅ |
| I5.7 | 静默时段不发 | `server/chat/proactive-sweep.ts` | ✅ |

---

## 贯穿约束

| 约束 | 怎么验 | 状态 |
|---|---|---|
| 不引入新 npm 依赖 | `git diff --exit-code package.json` | ✅ |
| 新文案进 zh/en 字典，两边 key 集合一致 | `client/src/i18n/i18n.test.ts` | ✅ |
| `server/wechat/**` 逐字节不变 | `git diff --exit-code server/wechat/` | ✅ |
| 迁移幂等 | `scripts/migrate.mjs` 连跑两次 | ✅ |
| 新列三件套（schema + 幂等 SQL + `drizzle-kit push` 正确） | `server/db-migrations.test.ts` + 真实 Postgres | ✅ |
| `pnpm check` / `pnpm test` / `pnpm build` 全绿 | — | ✅ |

## 迁移

| 文件 | 内容 |
|---|---|
| `drizzle/0010_presence_timezone_and_graduation_timestamps.sql` | 时区、presence、毕业时间戳 |
| `drizzle/0011_user_side_and_relationship_events.sql` | 称呼方式、边界、轨迹评估、user_moods、relationship_events |
| `drizzle/0013_letters_and_reachability.sql` | letters 表、reachability、proactiveFrequencyHours |
| `drizzle/0014_message_quotes.sql` | `messages.replyToId` |
| `drizzle/0015_memory_subject.sql` | `memories.subject`、memory_extractions |
| `drizzle/0016_persona_pins.sql` | `personas.isPinned` |
| `drizzle/0017_recalled_memories.sql` | `messages.recalledMemoryIds` |
| `drizzle/0018_message_origin.sql` | `messages.origin`（letter / proactive） |

> 迁移按数字顺序执行，`0000` / `0001` 的整库 dump 会被跳过——迁移路径只适用于
> 已经有基础表的安装。全新安装走 `drizzle-kit push`。
