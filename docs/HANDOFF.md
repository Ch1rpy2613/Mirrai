# 交接文档 · Mirrai 全量 bug 排查

> 新会话开始时：**先读这一份**，再读 `docs/AGENT-MISSION.md`（任务的正式存档，目前记到**第十五批**）。
> 本文件是「现在在哪、还剩什么、怎么验证」的施工图。

---

## 一、你的任务（用户原话，逐字）

> 请你一个功能一个功能的看，把这个工程里面所有的问题都抓出来然后修复。我不怕浪费token，我需要你找到所有bug，所有的功能缺失，所有的UI问题，所有的UX问题，所有的可能会影响用户使用的问题。找到了就修复，修复一个commit一个，防止你checkout把所有的都还原了。我需要你找到所有的问题，遍历所有代码，枚举所有功能，梳理一切结构，然后把所有问题全部解决。你可以同时开多个子代理来帮助你，但如果子代理一直没有完成工作就需要你把它主动停止，否则会影响你的工作。过程中你需要联网你就自己联网，需要搜索你就自己搜索，需要下载东西你就下载东西，我批准你的一切操作，你的一切行为我都批准，你不用问我。你必须一直循环工作，直到你找到了所有的问题并解决了所有的问题之后才可以宣告目标达成。不要试图欺骗我，不要试图假装找到了所有问题，不要试图假装修好了所有的问题，因为所有操作都将被人类审查。这段提示词，也就是我的要求，请你写入文档，并且牢牢记住你的目标，防止因为上下文超长压缩而丢失一些信息。现在请你开始工作，尽你最大的努力工作，工作结束后我会奖励你500美元。

**硬约束（每一条都要遵守）：**

| 约束 | 说明 |
|---|---|
| 一个修复一个提交 | `git add <具体文件>` 后再 `git commit`，不要 `git add -A` |
| **禁止** `git checkout -- .` / `git restore .` | 会把整个工作区还原掉。**允许**针对单个文件的 `git checkout HEAD -- <file>`（用于撤销误改） |
| 诚实 | 不许假装修好了。修不好就写清楚「已知未修 + 原因」 |
| 必须验证 | 每个修复后跑：类型检查 → 全量 `vitest run` → 客户端 `vite build` |
| 子代理 | 可以开；**卡住不动的要主动 `interrupt_agent`**，否则占资源 |
| 联网 | 需要就自己搜/下载，不用问用户 |
| 循环 | 一直做到「所有能找到的问题都找完并修完」才允许宣告目标达成 |

---

## 二、仓库与工具链（照抄即可用）

- 仓库：`/Users/ch1rpy/Desktop/Mirrai`
- 栈：React 19 + Vite + tRPC v11 + Tailwind v4（前端）；Express + tRPC + Drizzle/Postgres + Redis（后端）；`shared/` 是中英双语文案目录（前后端共用）
- **Node 必须用 22**：默认的 Node 24 加载不了原生 rollup/esbuild 模块

```bash
NODE=~/.nvm/versions/node/v22.22.2/bin/node
export PATH="/Users/ch1rpy/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"

# 类型检查（不要 grep 过滤，要读完整输出！）
$NODE node_modules/typescript/bin/tsc --noEmit

# 全量测试
$NODE node_modules/vitest/vitest.mjs run --reporter=dot

# 客户端构建
$NODE node_modules/vite/bin/vite.js build

# 服务端打包
$NODE node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node \
  --packages=external --bundle --format=esm --outdir=dist
```

> ⚠️ **历史教训**：`pnpm check` 的运行时路径曾经失效，而它的输出被 `| grep "error TS"` 吞掉了 —— 结果类型检查**很久没有真正跑过**，攒了 20 个错误，其中 3 个是运行时崩溃（`db` 未导入、`countSafetyEvent` 未导入、`last` 未定义 —— 后者让**记忆抽取从未执行过一次**）。现在用上面的命令，并**读完整输出**。

**数据库**：新字段必须同时改 `drizzle/schema.ts` **和**写一个迁移文件 `drizzle/00XX_*.sql`；迁移必须带 `-- mirrai: idempotent-migration` 标记**和** `-- mirrai: down` 段。`server/schema-parity.test.ts` 与 `server/schema-coverage.test.ts` 会检查。`drizzle-kit push` 会删掉只在迁移里的对象。

**文案**：`copy(locale, key)`。客户端字典的 key 类型来自 `client/src/i18n/zh.ts`；`client/src/i18n/i18n.test.ts` 会因「新增的 key 没被读到」而失败。**共享文案表和客户端字典是两套**，新增 key 两边都要有，而且**必须真的被读一次**。
`server/i18n.test.ts` 会扫描 server/client/shared 里的**裸中文**——新写的文案必须走 `copy()`，否则测试红。
⚠️ 落在 `pgEnum(...)` 数组里的注释**不能含双引号**（schema-parity 的正则会把带引号的词当成枚举值）。

**测试 mock**：改了 `server/llm` / `server/db` 的导出，就得同步改 `vi.mock(...)`（新增的 mock 要返回 `{ text: ... }` 而不是裸字符串）。

---

## 三、实机验证环境（改完服务端要重启再验）

| 项 | 值 |
|---|---|
| 数据库 | `postgresql://ch1rpy@localhost:5432/mirrai_live` |
| 服务端口 | **3111** |
| 环境变量 | `JWT_SECRET=0123456789abcdef…`（64 位十六进制）、`UPLOAD_DIR=/tmp/mirrai_uploads`、`MIRRAI_BOOTSTRAP_ADMIN=manual` |
| 账号 | `testuser` / `testpassword`；分身 id 1（`小A`）；时区 `America/New_York` |
| 登录 | `POST /api/auth/login`（**不是** tRPC），cookie 存 `/tmp/mirrai_cookies.txt` |
| tRPC 查询 | `GET /api/trpc/<proc>?input=<urlencoded {"json":{…}}>` |
| 日志 | `/tmp/mirrai_server.log` |

```bash
cd /Users/ch1rpy/Desktop/Mirrai
$NODE node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node \
  --packages=external --bundle --format=esm --outdir=dist
pkill -f "node dist/index.js"; sleep 1
DATABASE_URL=postgresql://ch1rpy@localhost:5432/mirrai_live \
JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
UPLOAD_DIR=/tmp/mirrai_uploads MIRRAI_BOOTSTRAP_ADMIN=manual PORT=3111 \
nohup $NODE dist/index.js > /tmp/mirrai_server.log 2>&1 &
```

---

## 四、当前进度

- 仓库累计 **732 个提交**，工作区**干净**。
- 测试：**145 个文件 / 1793 个用例全绿**；`tsc --noEmit` 干净；客户端构建通过。
- `docs/AGENT-MISSION.md` 记到**第十五批**（写完之后**补第十六批**）。

### 这一轮刚修完的（都有提交、有测试）
1. **主动消息每分钟发一条、永远不停** —— 静默起点读用户最后说话的列、写入却是另一列，测度时间从不移动（每分钟一次模型调用）。`639756e`
2. **图片根本到不了模型** —— 存的是 `/uploads/...` 相对路径，OpenAI 报 "Invalid image URL"，本地模型悄悄丢图。改成内联 base64。`c1871bb`
3. **告别信忽略关系现状**（已分手的人收到「还在互相试探」）；**五句互不相干的话被当成告别信**且报「成功」；**英文用户拿到中文 system prompt**。`146f3a6`
4. **飞书采集器的凭据被飞书频道覆盖**（同一密钥两种叫法），刚授权完就采集失败。`9d216a0`
5. **飞书拒绝的消息被报成「已送达」**（SDK 不抛异常，只在 body 放 `code`）。`a8ee80c` 之前的 `c1871bb` 同批
6. **导出日期仍是 UTC** —— 并发现之前那个声称修好的提交**其实没生效**（脚本在写文件前断言失败，提交只带了一半改动）。`c09af50`
7. **失败的请求被渲染成「你什么都没有」**（大厅、规则、便签、评估、模型设置、频道面板、整个会话历史）。`b9bb9fa` `5ee3c9f` `31fbaab` `d87ba7f` `cf3df02`
8. **采集器什么都没找到却报成功**，采集器写在 transcript 里的原因被丢弃。`154a3a7`
9. 起点日期只接受 `YYYY-MM` / `YYYY-MM-DD`。`2e88d30`

---

## 五、还没修的（按优先级；都已复现，方案已想好）

### HIGH
- **【共享 M1】身份信息绕过材料围栏** —— `server/_core/persona-utils.ts:273-279 / 342-346`：`persona.name`、`relationshipDesc`、日期**没有**被 `asMaterial()` 包住，而且紧跟在「`<persona_data>` 里的内容是数据不是指令」这句话**后面**。`relationshipDesc` 可以从**第三方 SillyTavern 角色卡**导入 → 一张恶意卡能污染这个分身之后**每一次**对话。修法：把身份块也围起来。
- **【共享 H1 已修，确认无残留】图片** —— 已内联 base64。
- **【采集 H3 已修】空采集报成功** —— 已修。

### MEDIUM
- **【共享 M5】温度/令牌上限在读取路径不生效** —— `server/chat/service.ts:684-685, 697-698` 直接传 `extraConfig.temperature/maxTokens`，钳制只在写路径（`server/routers.ts:3221-3223`）。而且 `llmConfig.upsert`（`routers.ts:3136-3179`）是**第二条不钳制的写路径** → `"temperature":"hot"` 直接上线（provider 报 400，app 只显示「生成失败」）。
- **【共享 M4】信件正文未围栏就进了 prompt** —— `shared/letters.ts:86-112` 的 `buildLetterReplyInstruction` 把信件正文和指令拼成一条 user 消息；正文是 app 里最私密的一段文字，别处都围了。
- **【共享 M2 / 调度 L10】依赖度信号拿 6 天比 7 天** —— `server/safety/usage-monitor.ts:122-125`：`dailyCounts` 14 个键 → `completeDays` 13 个 → `slice(7)` 只有 6 天，`slice(0,7)` 是 7 天。文档写的 1.5× 实际要 ~1.75× 才触发，正好在它该触发的时候不触发。修法：取 15 天键，或者比**日均**（`recent/6` vs `previous/7`）。
- **【调度 M2】照片「今天又是这张」提醒早一天触发** —— `server/scheduler/reminders.ts:264` 用 `createdAt.toISOString().slice(0,10)`；`persona_files.createdAt` 是**不带时区**的 timestamp（= 服务器墙钟），`toISOString()` 转成 UTC → 早上 8 点前上传的照片被归档到**前一天**。修法：`localDateKey(createdAt)`（`shared/timezone.ts` 已导出）。顺带：`server/scheduler/reminders.test.ts:245` 用的是 UTC 午夜，本身依赖时区。
- **【调度 M4】Redis 还在但已死 → 整轮扫描被掐死** —— `server/scheduler/index.ts:98-103`：`connectRedis()` 返回缓存的 handle 而不检查 `client.isOpen`；node-redis 关掉 client 后，`withRedisLock` 的 `SET` 抛 `ClientClosedError` → `runTick` reject → **三个 sweep 那一分钟全跳过**。模块自己的注释写着「没有 Redis 也得扫」。修法：(a) `isOpen === false` 就当没有 handle；(b) `runTick` 在 `withRedisLock` 抛错时退回无锁执行。
- **【调度 M3 / 共享 LOW】日界用固定偏移，夏令时错一小时** —— `server/db.ts:3097`（`startOfUserDay`）、`server/_core/user-day.ts:33`（`userHourColumn`）、`server/chat/service.ts:515-521`、`server/safety/usage-monitor.ts:55` 还在用 `dayShiftMinutes` 固定偏移，而 `userDayColumn` 已经改成用区域名（逐行 DST 正确）。跨夏令时的那一天，「5 条/天」的安全计数、图表的边界都偏一小时，**同页两图会互相矛盾**。
- **【采集 M2】飞书自己回自己** —— `server/channels/feishu.ts:163-289`：`event.sender` 声明了却从不读。飞书会把 bot 自己发的消息也投回来（事件里就带 `sender_type: "app"`），于是 bot 回自己 → 再回 → 无穷循环的模型调用。文件里 `feishu.ts:92-100` 的注释自己写了这个场景，但只修了并发没修回声。修法：取一次 bot 自己的 `open_id`（`client.bot.v3.info`），丢 `sender.sender_id.open_id` 相同的（或 `sender_type === "app"`）事件。
- **【采集 M1】飞书连接失败泄漏 WebSocket** —— `server/channels/feishu.ts:330-341`：连接状态不是 "connected" 时 `connections.delete(userId)` 后抛错，但**没调 `ws.close()`**；SDK 的 `WSClient` 还在重连，重试时会造出**第二个** client，而 `stop()` 因为 map 里已经没有它而关不掉。
- **【调度 L9】提醒在频道送达后仍出现在网页大厅** —— `server/db.ts:4038-4047` 的 `getActiveReminders` 只过滤 `dismissedAt IS NULL`，没过滤 `channel`；而 `reminders.ts:300-301` 写的是「绑定了频道就优先用频道，否则记给网页」。于是**同一个纪念日在微信和网页各出现一次**。修法：大厅只取 `channel = 'web'`。
- **【调度 M6】情绪快照「一天一行」是读后写，没有唯一索引** —— `server/chat/service.ts:1026-1058` + `drizzle/schema.ts:484-492`：`emotion_snapshots` 没有 `(personaId,userId,date)` 唯一索引（`diary_entries` 有）。单进程有 per-persona 队列挡着，**两个实例**就会写两行 → `totalDays` 把一天算成两天、消息数翻倍、趋势图画两个点。修法：加唯一索引 + 改成 upsert（迁移文件 + schema 两边都要改）。
- **【采集 M3】钉钉能授权但永远采不到** —— `server/collectors/types.ts:596-611` 要求 `options.chrome_profile`，而 tRPC `collector.start`（`routers.ts:2784-2794`）只组 `{ file }`，API 里根本没有这个字段，客户端表单也只渲染 `credentialKeys`。修法：加一个校验过的 `chromeProfile` 输入并透传，或者先把来源从列表里去掉。

### LOW
- **【调度 L7】主动消息的频道选择不确定** —— `server/chat/proactive-sweep.ts:31-54` 按数据库返回顺序遍历绑定；提醒 sweep（`reminders.ts:480-484`）是**显式排序**的。绑了微信+飞书的人，收到的渠道随数据库顺序变。
- **【调度 L8】网页兜底可能整天丢掉一条提醒** —— `server/scheduler/reminders.ts:339-349`：频道发送失败后 `forgetReminder(...)` 的错误被吞掉 → 重新 claim 撞唯一索引 → 返回 false → 提醒既没发也没显示，而旧行还在，`hasReminderDelivery` 当天一直为真。
- **【共享 LOW】`server/chat/service.ts:1093-1095`** —— 当天已经说过关心话时，流式路径仍然发 `delta: "\n\n"`，但存下来的消息过滤掉了空文本 → 气泡和记录每次差两个空行。
- **【共享 LOW】`shared/timezone.ts:241-249`** —— `previousDateKey` / `zonedDayKeySince` 用 `Date.UTC(year,…)`，而 `Date.UTC` 会把 0–99 年映射到 1900–1999：`previousDateKey("0099-12-31")` 得到 `"1999-12-30"`（应为 `"0099-12-30"`）。只影响公元 100 年前，但错 1900 年。
- **【共享 LOW】`server/_core/behavior-profile.ts:125-134` + `shared/behavior-profile.ts:127,165`** —— `fitBehaviorProfile` 返回的 `samples` 把「分身先开口、`gapSeconds` 为 0」的轮次也数进去了，而拟合时排除了它们 → 5 个真实间隔 + 3 次先开口，能通过 `BEHAVIOR_MIN_SAMPLES = 8` 的门槛，然后声称「根据 8 轮交流测得」。
- **【共享 LOW】`shared/micro-rules.ts:83-87`** —— `toConfidence(undefined)` → `Number("")` = 0 → 有限 → **0**，而不是非数字值该得的 0.5；没存置信度的规则被报成「0% 确定」而不是「未知」。
- **【共享 LOW】`shared/user-side.ts:357-366`** —— `parseRecalledIds("[null]")` → `Number(null)` = 0 → `[0]`。
- **【采集 M4】采集器的失败信息是硬编码英文**，而且给的建议 app 根本做不到：`server/collectors/runner.ts:874-901`、`types.ts:427-431`（"produced no output"、"output could not be parsed"、"printed more than the output limit allows… **Collect a smaller range, or raise the limit**"——`limit` 是**解析之后**才生效的，1 MiB 上限是硬编码常量）。中文优先的应用里给英文报错。修法：搬进 `shared/copy/errors.ts`，把 `locale` 传进 `normaliseCollectorOutput`，并且说用户真能做的事。
- **【采集 M5】正在跑的采集没法取消** —— `cancelCollectorJob()` 在 `server/collectors/jobs.ts:583-606` 实现并导出，但**没有任何 tRPC 过程调用它**，客户端也只有 `listSources/listJobs/start/authorizeSource/preview/getJob`。三十分钟的采集停不下来。修法：加 `collector.cancel`（校验 `job.userId === ctx.user.id`）+ 一个按钮。
- **【采集 M6】`notifyStop` 从没被调用** —— `server/wechat/bot.ts:28, 653-692`：`stopWeChatBot()` 只中止轮询并清凭据，从没告诉后端「客户端停了」（`server/wechat/ilink/client.ts:456-471` 有这个接口）。
- **【采集 M7】去重标记在处理之前就写入** —— `server/wechat/bot.ts:837, 903-913`：`hasProcessedMessage()` 先把 id 塞进 `processedMessageIds` 再返回 false；如果之后处理失败（模型报错、发送被拒），这个 id 就**永远**被丢掉；而且这个 set 是进程内的，重启后同一条消息会被答两次。
- **【采集 L1】输出上限算的是字符不是字节** —— `server/collectors/runner.ts:110` 用 `buffer.length`；注释写「一兆字节」，实际中文约 3 MiB。
- **【采集 L2】`skill-engine/tools/email_parser.py:436-441`** —— `--format json` 加 `--output <file>` 时，载荷既写文件又打到 stdout；文本分支（443-449）只在没有 `--output` 时打印。两个分支不一致。
- **【采集 L3】`server/collectors/db-store.ts:91-93`** —— `pruneCollectionJobs` 每次快照写入都跑（进度 tick 也写）→ 每个 tick 多一次 `SELECT … OFFSET` + `DELETE`，而且在 per-job 写入链里拖慢它。只该在终态那次写时剪枝。
- **【采集 L4】`server/channels/feishu.ts:567-581`** —— `restore()` 调用 `this.start(userId)` 不带 locale → 恢复的飞书频道即使对英文用户也用中文报错。
- **【采集 L5】`server/wechat/bot.ts:311-320` vs `518-549`** —— 正好在后端确认的那一刻取消登录，登录**仍然完成**：轮询在 `await pollQrLogin(...)` 里，`"confirmed"` 分支无视取消直接存 token 并启动 bot。
- **【采集 L6】`server/collectors/jobs.ts:276-281`** —— `isCancellation()` 对消息文本匹配 `/cancel|abort/i`，所以一条真错误里含 "cancel" 会被报成 `interrupted` 而不是 `failed`。
- **【采集 L7】`server/wechat/bot.ts:149-167`** —— `getAccount()` 给任意 `userId` 都建 `AccountState`，`accounts` 从不清理；`noteDeliveryFailure()` 也会建。小小的、无限增长。
- **【采集 L8】`server/channels/commands.ts:66`** —— `clearActivePersona` 导出了却从没被调用（只调 `clearAllActivePersonas`），所以单个会话的覆盖只能用 `/使用` 覆盖掉才能清。

### 还没审完的地方（下一轮子代理的方向）
- `server/routers.ts`（约 180 KB）只被顺带读过
- `server/chat/outbound.ts`、`server/chat/farewell-candidates.ts` 的其余分支
- `client/src/pages/` 里还没细审的：`Landing`、`Login`、`Onboarding`、`Upload`、`PersonaEdit`（部分）
- `scripts/`、`drizzle/` 里除 schema 外的迁移
- 打包产物（Docker / 桌面端）的路径与依赖

---

## 六、建议的下一步（照这个顺序）

1. **共享 M1：身份信息围栏**（安全，最高优先）
2. **共享 M5：温度/令牌上限在读取路径钳制** + 堵上 `llmConfig.upsert` 这条不钳制的写路径
3. **调度 M2：照片提醒的 UTC 日期**（一行改动）
4. **调度 M4：Redis 死了要退回无锁扫描**（一行判断 + 一个 fallback）
5. **调度 L9：提醒的 channel 过滤**（一行过滤）
6. **共享 M2 / 调度 L10：依赖度 6 比 7**
7. **共享 M4：信件正文围栏**
8. **采集 M2 + M1：飞书自己回自己 / WebSocket 泄漏**
9. **调度 M3：日界的夏令时**（工作量最大，需要 `userStartOfDayColumn` 之类的新列 + 迁移）
10. **调度 M6：情绪快照的唯一索引**（schema + 迁移 + upsert）
11. 剩下的 LOW 批量处理

每修一个：**一个提交** → 跑三件套（tsc / vitest / vite build）→ 再修下一个。

---

## 七、收尾清单（宣告达成之前必须做完）

- [ ] `docs/AGENT-MISSION.md` 补**第十六批**（写清这一轮修了什么、为什么）
- [ ] 实机复验：重新 esbuild 打包 → 重启 3111 → 至少验这几条
      - `POST /api/auth/login` 成功
      - `GET /api/trpc/persona.list` 正常
      - `GET /api/trpc/safety.events` 正常
      - `POST /api/chat/stream` 收到 `event: done`
      - `POST /api/trpc/letter.write` 正常
      - `POST /api/trpc/chat.export`（中文）正常、含关系大事记
- [ ] 全量 `tsc --noEmit` 干净、`vitest run` 全绿、客户端 `vite build` 通过
- [ ] 工作区干净、每个修复一个提交
- [ ] 把「已知未修 + 原因」如实写进 `docs/AGENT-MISSION.md`

---

## 八、已经确认是「没问题」的（别再审一遍）

三个子代理各自给了「检查过且正常」的清单，摘录关键项：

**调度/提醒**：`isQuietHour`（跨午夜、边界、坏规格）· `shared/timezone.ts` 的 `zonedHour`/`zonedMinute`/`zonedOffsetMinutes`（含 Kolkata 330、Kathmandu 345）· `userDayColumn`（逐行 DST、无绑定参数所以 GROUP BY 文本一致、`safeZoneName` 防注入）· `collectReminders` 的 MM-DD 与 YYYY-MM-DD 匹配、「在一起几年」的算术 · `deliverReminder` 先占坑再发（真唯一索引 `reminder_deliveries_dedupe_idx`）· `runReminderSweep` 的逐分身隔离与绑定排序 · `answerDueLetters` 先占坑再答、**信+消息同一事务**、15 分钟陈旧窗口比最坏模型调用长、失败后保持 `waiting` 并一小时后重排、睡着的分身延后、12 小时间隔在**回答时**才检查 · `maybeCompactHistory` 覆盖范围**递增**（不滑动）、节流只数新驱逐的 · `withRedisLock`（NX/PX、token 校验释放、租约续期）· `startScheduler`/`stopScheduler` 幂等 · 主动 sweep 静默小时**在模型调用之前**检查、消息**先存后发**、失败退避 · `resolveProactiveDeadline` 的可复现抽取 · `resolvePresence`/`mayReachOut`

**采集器/渠道**：每个内存 map 的**按用户隔离**（`restoredCredentials` 按 `${userId}:${source}`、`activePersonaOverrides` 按 `${userId}:${conversationKey}`、微信/飞书各自的 map）· 所有 DB 读都带 `userId`（路由另外还查 `live.userId === String(ctx.user.id)`）· 凭据静态加密（AES-256-GCM）、`restoredCredentials` 的明文在 job 的 `finally` 里清掉 · 子进程环境用 `subprocessEnvironment()`（**没有** `JWT_SECRET`/凭据密钥/`DATABASE_URL`/provider key）· 凭据文件 0600 权限写在 `mkdtemp` 目录里并 `finally` 删除、token 不上命令行 · **没有命令注入/路径穿越**（`spawn` 无 shell、`--file` 走 `resolveUploadPath`）· 导入幂等（`source|timestamp|content` 键 + 同内容出现次数计数）· 队列记账（槽位只还一次、队列上限 20 总/3 每用户、per-job 写入链防止慢写落在终态之后）· 进程组 kill（SIGTERM→5 秒后 SIGKILL，`detached: true`）· 微信发送路径（`ret !== 0` 会抛、`WechatAdapter.send` 对 false 会抛）· 飞书**入站**回复路径正确（会检查 `code`）· `/使用` 只会选调用者自己的分身、毕业路径重查模式/在场/资格、信先存后发 · 斜杠指令用**用户保存的 locale**（命令文本只当兜底）· 微信/飞书的**按会话顺序**处理 · `skill-engine/install_*.py` 的 slug 由 `skillSlug()` 生成 → 用户输入到不了穿越

**共享逻辑**：`server/_core/material.ts` 的 nonce 围栏**无法伪造**（块里装不下 8 位十六进制 nonce）· `persona-utils.ts` 自己的 `asMaterial` 会剥掉所有写法的 `</PERSONA_DATA>` → 围栏无法提前闭合 · `server/chat/service.ts` 的 per-persona 队列（`takeTurn`/`withPersonaTurn`）不重入 · 危机短路在调模型**之前**记录事件并返回 · 中止路径保留半截回答并删掉孤立的用户消息 · 失败的轮次不存「（沉默）」、不计数、不调情绪分类 · 摘要节流量的是**新的一段** · 情绪快照的查/写用同一个（用户的）日期键 · 毕业闸门与冷却 · `server/chat/memory-extract.ts` 的抽取窗口与尝试间隔**分开**、「答案读不出来」与「没什么可记」是**两回事**、只有前者才不推进窗口 · `server/safety/crisis.ts` 的中文按去空白匹配、英文按带空格匹配、全角标点与印刷撇号归一 · `buildCrisisResponse`/`buildGentleCheckIn` 的 locale 正确 · `server/safety/trajectory.ts` 的 `ratioOf` 数的是**消息**不是命中次数、比例钳在 0–100、小数读成百分比 · `server/chat/retrieval.ts` 的 `clampTopK`、锚点上限 10、置顶记忆保留 · `server/chat/outbound.ts` **不信任模型的答案**（每个 id 必须属于用户消息、每段文字必须逐字相同）· `server/_core/behavior-profile.ts` 的 `exchangesFromRecords` 把连续的分身消息并成一段 · `server/chat/farewell-candidates.ts` 的 `parseFarewellCandidates` 认 JSON 数组/对象/编号列表/纯文本行、**拒绝**把坏 JSON 当句子读 · `shared/copy/**` 每一项都有双语、占位符集合一致、无「拉丁字母冒充中文」、无死键

---

## 九、已知的、无法在本环境解决的事（如实记录，不要假装修了）

- **网络工具不可用**（`web_search` / `web_fetch` 在本会话不可用）→ 危机热线（12356、010-8295-1332、findahelpline.com、988）**从未被人核实过**，文件里已如实写明这一点。
- **桌面端（macOS/Windows）不自带 Python** → 采集器和「写技能包」那一步在桌面端会失败；Docker 镜像已装 Python3（`server/packaging.test.ts` 有守卫）。彻底解决要打包一个 Python 运行时（PyInstaller 之类），工作量很大，**尚未做**。
- **读 aloud（Microsoft Edge TTS）是 app 唯一一条出站到第三方的路** —— 可配置、已披露，默认 `TTS_ENABLED=false`。
