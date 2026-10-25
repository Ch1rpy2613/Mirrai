# 还没做完的

> 这份文件原来是**未完成事项的清单**。清单上的每一条现在都做完了，所以它变成了
> 一份**结案记录**——每一条写了它当时是什么样、现在是什么、靠什么守住。
>
> 结案时间：2026-10-25 · 审计对象：`/Users/ch1rpy/Desktop/Mirrai` @ `main`
>
> 现在的状态：**949 个测试 / 94 个文件全绿**，`tsc` 干净，构建通过，
> `server/**` 里没有一句没有英文对应的中文。

---

## 一、真正没做完的（功能缺失）——已全部做完

### 1. 服务端的「国际化」只做了一半 — ✅ 做完了

客户端的界面是完整国际化的，但**服务端返回给用户看的字**有一大批是硬编码中文：
一个英文用户会在错误弹窗、推送提醒、微信回复、毕业提示里看到中文。

| 文件 | 当时 | 现在 |
|---|---:|---|
| `server/skill-engine/celebrity.ts` | 132 | 0 |
| `server/skill-engine/pipeline.ts` | 65 | 0 |
| `server/routers.ts` | 55 | 0 |
| `server/_core/persona-utils.ts` | 51 | 0 |
| `server/channels/commands.ts` | 30 | 0 |
| `server/templates/questionnaire.ts` | 30 | 0 |
| `server/collectors/types.ts` | 13 | 0 |
| `server/db.ts` | 11 | 0 |
| `server/scheduler/reminders.ts` | 4 | 0 |
| `server/channels/feishu.ts` | 8 | 0 |
| `server/channels/wechat.ts` | 3 | 0 |
| `server/_core/filename.ts` | 3 | 0 |
| `server/_core/trpc.ts` | 1 | 0 |
| **合计** | **约 406 行** | **0** |

**做法**：服务端有了一套自己的文案表，`shared/copy/`，一共 **468 条**，
每条都有 `zh` 和 `en` 两个版本。拆成了十个文件——`errors`（错误）、
`channels`（渠道回复）、`reminders`（提醒）、`skill-engine`（蒸馏引擎）、
`content`（问卷与场景）、`prompt`（系统提示词的结构）、`prompts`（给模型看的提示词）、
`labels`（名字和标签）、`safety`（安全层）、`scenes`（内置场景）。

**为什么当初没做**：`server/wechat/**` 必须逐字节不变（这是这个项目的硬约束），
而微信/飞书的回复文本和 Web 端共用同一批字符串。动微信就动飞书，
动飞书就动 Web 的错误提示。这不是偷懒，是一个约束没解开。

**约束怎么解开的**：文案表放在 `shared/` 而不是 `server/`，于是微信协议那一份
不需要改——它接收的是已经选好的那一份文字。

**怎么守住**：`server/i18n.test.ts` 扫 `server/**`（排除 `wechat/`），
**不得出现没有英文对应的中文字符串字面量**。它用 TypeScript 自己的解析器，
注释、正则、模板表达式都骗不过它。命令行版本是 `pnpm audit:i18n`。

唯一的例外是**输入匹配**：危机关键词、聊天记录里的角色标记——它们匹配的是用户
打进来的东西，所以必须是中文。那种声明要自己标上 `// i18n:allow-input`，
标记是**按声明**生效的，所以同一文件里新加的普通中文照样会被抓住。

### 2. `server/_core/persona-utils.ts` 的系统提示词仍然是中文 — ✅ 做完了

`buildSystemPrompt` 拼出来的 7 层提示词——身份、底线、性格、说话方式、情感状态、
时间感知、关系阶段、真人感——现在每一句都从文案表取，语言是分身的语言。

**顺带修掉一个真 bug**：那段代码里 `rel` 和 `period` 是写死 `copy("zh", …)` 查的，
所以一个英文分身会被告知「你是 Ann，重要的人」。现在用的是调用方的 locale，
中文的输出一个字没变。

### 3. 分身的「阶段文案」只在中文下成立 — ✅ 做完了

内置场景（一起看电影 / 深夜聊天 / 吵架和好…）、问卷的选项说明、蒸馏的进度文案，
现在都有两种语言。

**做法**：内置场景原来在**两个地方**各写了一遍中文——文案表里一遍，播种的地方
一遍，两边会漂移。现在只有一份定义（`shared/copy/scenes.ts`），播种读的是它的
中文那半，显示读的是对应语言那半。

**数据库里的行名还是中文**（`一起看电影`）。那是这行的**身份**：播种靠它认人，
已有的安装里就是这个名字。显示给人看的那一份是换过的。

**怎么守住**：`shared/copy/scenes.test.ts`——每个场景两种语言都有、两种语言确实
不同、每个部分都有文案条目；而且**用户自己写的场景一个字都不动**，
被改过开场白的内置场景也不会被塞进别人的句子。

---

## 二、做了但没做透（功能在，验证不在）——已全部做完

### 4. 客户端没有任何组件测试 — ✅ 做完了

> 当时的原话：「这个决定需要你来做，不是我能替你定的。」

**决定**：引入 jsdom + React Testing Library，把组件本身的行为测起来。
（同一个决定也覆盖了第 7 条的 Redis——引入外部依赖需要你点头，你点了。）

现在有 **8 个组件测试文件**：

| 文件 | 测的是什么 |
|---|---|
| `client/src/components/MessageBubble.test.tsx` | 复制、引用、修改、重新生成、删除；哪一边的消息有哪个按钮 |
| `client/src/components/SafetyTransparency.test.tsx` | 安全记录看得见、「知道了」能标已处理、空记录有话说 |
| `client/src/components/RelationshipTimeline.test.tsx` | 记一件事、删掉一条、没标题不能存、改主意能反悔 |
| `client/src/components/LetterBox.test.tsx` | 信 |
| `client/src/components/MoodCheckIn.test.tsx` | 心情 |
| `client/src/components/CommandPalette.test.tsx` | 命令面板 |
| `client/src/pages/PersonaEdit.test.tsx` | 真人感滑块、主动频率下拉、暂停开关 |
| `client/src/pages/Lobby.test.tsx` | 置顶、已毕业的折叠 |

**顺带修掉的**：消息气泡原来住在两千行的 `Chat.tsx` 里，根本没法测。
现在搬到了 `client/src/components/MessageBubble.tsx`。

### 5. 五个服务端模块的关键函数没有直接测试 — ✅ 做完了

| 符号 | 位置 | 测试 |
|---|---|---|
| `requestAbortSignal` | `server/_core/context.ts` | `server/_core/context.test.ts` |
| `buildPromptForPersona` | `server/chat/prompt.ts` | `server/chat/prompt.test.ts` |
| `collectProactiveContext` | `server/chat/proactive.ts` | `server/chat/proactive-context.test.ts` |
| `TTS_VOICES` / `voicesForLocale` | `server/_core/tts.ts` | `server/_core/tts.test.ts` |
| `createRelationshipEvent` | `server/db.ts` | `server/relationship-events.test.ts` |

### 6. 几个 db helper 只有间接测试 — ✅ 做完了

`server/db.ts` 有 160 个导出。原来的两条结构性测试（「带 id 的 helper 必须按
userId 过滤」「删干净」）**挡住的正是最危险的一类错**，但它们看不出
`getWaitingNotes` 返回的是「还挂着的」还是「已经回了的」。

新增 `server/db-behaviour.test.ts`，**49 个行为测试**，覆盖当时完全没有测试的
36 个 helper。断言是真的：条件被翻成**它会发出去的那句 SQL**再比对，
所以「按 userId 过滤」是对语句的断言，不是对函数形状的断言。

```ts
expect(whereOf().flatMap((c) => c.params)).toContain(3);   // 按 userId 过滤
expect(orderOf()[0].sql).toContain('"letters"."createdAt" desc');  // 新的在前
expect(rows.map((r) => r.id)).toEqual([7, 8, 9]);          // 旧的在前
```

---

## 三、已知的功能限制（不是没做，是有意为之）——已解决或已记下

### 7. 限流是单进程的 — ✅ 做完了，而且不用配置

> 当时的原话：「改成共享存储要引入 Redis —— 超出「不引入新 npm 依赖」的约束，
> **需要你拍板**。」

**你同意了**，并且提了一个条件：redis 也必须开箱即用，用户什么都不用配。

现在的行为：

1. `REDIS_URL`（填了才用）
2. 默认端口上已经跑着的 Redis
3. **应用自己起的一个**——找到 `redis-server` 二进制，在自己挑的端口上起一个，
   把端口记在 `MIRRAI_DATA_ROOT` 下，让这台机器上别的 Mirrai 进程用同一个

第 3 条才是「开箱即用」的意思：不用装、不用填、不用选端口、不用改文件。
机器上**没有** `redis-server` 也不影响启动——限流退回进程内计数，日志里会写明。

**装 Redis**：`pnpm setup:redis`（自动认 brew / apt / apk / dnf / yum）。
Docker 用户不用管：`docker compose` 里已经带了一个 `redis` 容器。

**怎么守住**：`server/_core/redis-managed.test.ts` 真的会**起一个真的 Redis**，
然后验它答话、验限流器记在它上面、验锁只有一个人拿得到、验它跟着应用一起停。
机器上没有 `redis-server` 时这组测试跳过——应用必须能在没有 Redis 的机器上跑。

**顺带修掉一个真 bug**：调度器的锁在没有 Redis 时**会让人什么都收不到**。
`withRedisLock` 返回 `null`，而调度器把返回值扔了，于是提醒、催回信、
主动开口全部静悄悄地不执行。现在没有共享存储时就直接扫一遍——锁是为了防止
两份 Mirrai 做同一件事，只有一份的时候没有第二份要防。

### 8. 迁移路径只适用于已有基础表的安装 — ✅ 写进 README 了

全新安装走 `pnpm db:push`，已有安装升级走 `pnpm db:migrate`。
README（中英）现在有专门一节说明这个区别，以及为什么。

### 9. 分身模板的删除按钮在没有 row id 时是灰的 — ✅ 不是缺口

`client/src/pages/Settings.tsx` 的 `rowIdFor()`。实际情况下服务端 `template.list`
对用户自己的模板都返回了 `rowId`，所以这是**防御性代码**，不是坏掉的功能。
记录在这里，是为了以后再看到它时不用重新查一遍。

---

## 四、清理项（不影响功能）——已全部做完

### 10. `cards` 这个 i18n 命名空间是 `personaCard` 的重复 — ✅ 删了

### 11. 还有约 60 个 i18n key 从未被界面引用 — ✅ 清完了

**清单现在只剩 29 个**，逐条看过：28 个是更早迭代的遗留，删了；
1 个（`safety.usageBanner`）是**真缺口**，补上了界面。

那个缺口是这样的：安全层在对话用得太多时会给一条 `careNote`，
带 `showBanner: true`，但**客户端从来没有显示过这个横幅**——它把同样那句话
又弹了一次 toast，于是同一句话用户在一条消息和一条提示里各看了一遍。
现在横幅说的是**应用自己的那句**（`safety.usageBanner`），具体的那条仍然在
分身的话里出现，各一次。

**现在多了一条测试**：`client/src/lib/care-note.test.ts`。

**怎么守住**：界面那份字典有一条「没有谁读的条目」的测试（原来就有），
服务端那份现在也有一条（`shared/copy/copy.test.ts`）——468 条文案，每一条都得
有人读。

### 12. `mayReachOut` 和 `zonedOffsetHours` 曾经是死代码 — ✅ 记录保留

`mayReachOut` 统一了五处「能不能打扰」的判断；`zonedOffsetHours` 让「时差」
变成具体的小时数而不是「另一个时区」。留在这里是因为它们**曾经**是死代码——
记录一下，防止以后再出现同样的情况。

---

## 五、还没交出去的 — ✅ 交出去了

### 13. 所有改动都没有提交 — ✅ 已提交

按主题切成了几个提交，不是按文件切：

1. `feat:` 这一轮计划的功能（用户侧、关系、交互、创新、中止路径）
2. `feat(redis):` 共享限流与调度锁，零配置
3. `feat(i18n):` 服务端也会说两种语言了
4. `test(client):` 界面的组件测试
5. `test(server):` 数据库 helper 到底做了什么
6. `docs:` README 与这份清单

### 14. `docs/roadmap-v2.md` 没有从 README 链出去 — ✅ 加了

README（中文）和 README.en.md 都有「文档」一节，链出去了。

---

## 六、这份清单**不**包括的东西（仍然成立）

- **计划里的 63 项**：全部落地，文件与函数逐条核对过（`docs/roadmap-v2.md`）。
- **硬约束**：全部满足——
  - `server/wechat/**` **逐字节不变**（`git diff --exit-code HEAD -- server/wechat/` 通过）
  - `tsc` 干净
  - **949 个测试 / 94 个文件全绿**
  - 构建通过（前端 `vite build` + 服务端 `esbuild`）
  - `server/**` 里 **0** 句没有英文对应的中文
- **依赖**：多了 `redis`、`jsdom`、`@testing-library/*` 三个——前两个决定都经过你
  （Redis 且要零配置；组件测试要不然就接受没有测试）。

---

## 一句话总结

**清单空了。**

真正做完的，是三件以前没做的事：**服务端会说两种语言了**（468 条文案，
一条测试守住），**Redis 零配置**（用户什么都不用填，应用自己起一个），
**界面的组件有测试了**（8 个组件文件）。

外加两处真 bug：调度器在没有 Redis 时让人什么都收不到；
导出时打印的是亲密度等级的原始 key 而不是名字。
