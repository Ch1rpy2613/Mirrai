# 交接文档（第二个会话）

> 这份文档接替 `docs/HANDOFF.md`。`docs/HANDOFF.md` 讲的是**第一个**会话的施工图；
> 那一轮的全部条目已经在第十七批里做完。本文件是**现在**的权威上下文。
>
> 上一次会话的存档在 `docs/AGENT-MISSION.md`（已记到第十七批；本轮的第十八批还没写）。

---

## 一、目标（用户原话，逐字）

> 请你一个功能一个功能的看，把这个工程里面所有的问题都抓出来然后修复。我不怕浪费token，我需要你找到所有bug，所有的功能缺失，所有的UI问题，所有的UX问题，所有的可能会影响用户使用的问题。找到了就修复，修复一个commit一个，防止你checkout把所有的都还原了。我需要你找到所有的问题，遍历所有代码，枚举所有功能，梳理一切结构，然后把所有问题全部解决。你可以同时开多个子代理来帮助你，但如果子代理一直没有完成工作就需要你把它主动停止，否则会影响你的工作。过程中你需要联网你就自己联网，需要搜索你就自己搜索，需要下载东西你就下载东西，我批准你的一切操作，你的一切行为我都批准，你不用问我。你必须一直循环工作，直到你找到了所有的问题并解决了所有的问题之后才可以宣告目标达成。不要试图欺骗我，不要试图假装找到了所有问题，不要试图假装修好了所有的问题，因为所有操作都将被人类审查。

**这个目标还没有完成。** 下面第五节列的是还剩下的活。

---

## 二、硬约束（必须遵守）

- **一个修复一个提交**：`git add <具体文件>` → `git commit`。**不要 `git add -A`**。
- **禁止** `git checkout -- .` / `git restore .`（会把整个工作区还原掉）。
  允许针对单个文件的 `git checkout HEAD -- <file>`。
- **诚实**：修不好就写「已知未修 + 原因」，不许假装修好了。所有操作都会被人类审查。
- **每个修复都要验证**（三条，缺一不可）：
  ```
  ~/.nvm/versions/node/v22.22.2/bin/node node_modules/typescript/bin/tsc --noEmit
  ~/.nvm/versions/node/v22.22.2/bin/node node_modules/vitest/vitest.mjs run --reporter=dot
  ~/.nvm/versions/node/v22.22.2/bin/node node_modules/vite/bin/vite.js build
  ```
  Node 必须是 22（系统默认版本跑不了）：`~/.nvm/versions/node/v22.22.2/bin/node`。
- **新写的测试要证明它抓得住这个 bug**：把修复回退掉跑一遍，确认它会红，再把修复放回去。
  （本轮已经踩过的坑：见第五节「测试的坑」。）
- **子代理**：可以开；卡住不动的要主动 `interrupt_agent`，否则占资源。
- **联网/搜索/下载**都自己来，不用问。
- 一直循环到「所有能找到的问题都找完并修完」才允许宣告目标达成。

---

## 三、工具链与实机环境

- 仓库：`/Users/ch1rpy/Desktop/Mirrai`
- Node：`~/.nvm/versions/node/v22.22.2/bin/node`（22.22.2）
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit`
- 测试：`node node_modules/vitest/vitest.mjs run --reporter=dot`
  （Vitest 5；`environmentMatchGlobs` 已被移除，现在用 `test.projects`：node + browser(jsdom)；
  `.tsx` 测试文件自己带 `// @vitest-environment jsdom` 头）
- 客户端构建：`node node_modules/vite/bin/vite.js build`
- 服务端打包：`node node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist`
- 实机库（Postgres，本机）：`postgresql://ch1rpy@localhost:5432/mirrai_live`
- 实机服务：`PORT=3111 DATABASE_URL=… JWT_SECRET=… NODE_ENV=production node dist/index.js`
- DSH 界面：`http://127.0.0.1:52814`

### 实机复验（现在就能跑）

```bash
# 1. 起模型桩（说 OpenAI 协议，含流式）
node scripts/live-stub-model.mjs 3122 &

# 2. 打包并重启服务
node node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node \
  --packages=external --bundle --format=esm --outdir=dist
kill $(lsof -ti tcp:3111)
PORT=3111 DATABASE_URL=postgresql://ch1rpy@localhost:5432/mirrai_live \
  JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  NODE_ENV=production node dist/index.js &

# 3. 跑复验
node scripts/live-verify.mjs
```

上一次全绿的输出（2026-10-27）：

```
PASS register / login / llmConfig.upsert / llmConfig.setDefault
PASS persona.list / safety.events / persona.create
PASS chat.stream — status 200, done=true, delta=true
PASS letter.write / chat.export (4436 字符) / relationship.add / relationship.list
PASS the export has the milestone / the export is in Chinese
```

---

## 四、这一轮（第十八批）已经修完的 24 个提交

`ace1d61`（第十七批文档）之后到 `89be76c`，加两个 `live-verify` 脚本提交：

| 提交 | 修的是什么 |
| --- | --- |
| `1015644` | 服务器的失败一律用英文说；输入校验的失败被算成「服务器出错了」 |
| `10abc2c` | 大厅的排序菜单键盘完全够不着（焦点从不进菜单） |
| `cf1ab80` | 情绪报告的两个大数字在请求失败时是「0 天 / 0 条」——关于用户自己的历史 |
| `10f5c4a` | 采集预览失败时说「没有采集到任何东西」；采集任务失败时永远转圈 |
| `c0d23d7` | 数据库抖一下就让整个 app 挂掉（Express 4 不等 async handler 的 promise） |
| `05a1998` | 情绪轨迹的隐私闸门是「失败即放行」——用户关了也可能把一个月的私信发出去 |
| `4303466` | 排序菜单的焦点改在 layout effect 里动（原来在 rAF 里，会抖） |
| `94eea06` | 采集器的 Python traceback（含机器路径）被原样显示在浏览器里 |
| `8f5af02` | 飞书上的一条消息可能无声无息地消失（绑定查询在 try 之外） |
| `ad6cce3` | 还没到的纪念日被提前一年推送 |
| `f57e1cf` | 主动消息的扫描每分钟把每个分身整行读一遍 |
| `93a3a0a` | 情绪报告里换时间范围，焦点不跟着走 |
| `f91d576` | 关系事件的日期上限是 UTC 那天——「今天」选不了 |
| `683fa6c` | 大厅的问候语按机器的时钟说，不是用户自己的时区 |
| `a3f08ea` / `a96631e` | 两个测试的稳定性（排序按钮的名字被分身的一句台词撞了） |
| `4a5a48d` | 删除账户的确认框在统计失败时说「0 个分身 / 0 条消息 / 0 个文件」 |
| `9108e4a` | 每条消息上的时间、信的日期，是浏览器的时区 |
| `3556345` | 安全面板和保真面板的日期，是浏览器的时区 |
| `87ea3aa` | 设置里的日期，是浏览器的时区 |
| `eed06e3` | 记忆时间线和情绪报告打印原始的 `YYYY-MM-DD` |
| `7882ee0` | 引导页在服务商列表还在路上时就让人选，选完说「请选一个」 |
| `88774ab` | 「+」按钮和输入框同名（屏幕阅读器听到两个「口头禅」） |
| `89be76c` | 大厅的筛选标签在选中的那一项消失后，整个标签栏没有 tab 停靠点了 |

再往前一批（第十七批之前）还包括：钉钉采集的 Chrome Profile 通道（`66079c9`）、
飞书回声与 WebSocket 泄漏、夏令时日界、情绪快照唯一索引、锁定/微信监控的未处理 rejection、
Docker/安装包/启动脚本的一批打包缺陷、客户端与服务端那一批「失败被渲染成没有东西」。

---

## 五、还剩下的活（按优先级）

### A. 收尾（随时可做，30 分钟内）

1. **`docs/AGENT-MISSION.md` 补第十八批**：把上面这 24 个提交写成一段（照第十七批的写法：
   「最严重的几个」+「还有一批」+ 实机复验输出 + 「已知未修 + 原因」）。
2. **实机复验**（见第三节）——本轮已经跑过一次全绿 ✓，写文档后再跑一次即可。
3. 三件套全绿、工作区干净（现在就是干净的 ✓）。

### B. 继续找问题（任务的主体，还没做完）

上一轮派了三个只读子代理，审了**客户端页面**和**服务端**两块，报上来的问题**全部已修**（见第四节）。
但这两份报告覆盖的是「它们读过的地方」，**不是全部代码**。所以：

- **再派一轮子代理**，审还没被审过的地方。建议的分工：
  - `server/routers.ts`（最大的一个文件，1200+ 行的过程定义）
  - `server/skill-engine/**`（蒸馏流水线）
  - `server/persona-cards/**`、`server/collectors/**` 的其余部分
  - `shared/**`（copy 表、user-side、intimacy、micro-rules）
  - `client/src/pages/{Graduation,Diary,PersonaProfile,Questionnaire,Upload}.tsx`
  - `scripts/**`、`.github/workflows/**`、打包脚本
  - `skill-engine/tools/*.py`（Python 那一半）
- 每个子代理的 brief 要写清楚：**只读**、要**指出 file:line 和引用的代码**、要说明**用户看到什么**、
  不要报已经被最近提交修掉的问题、不要报风格问题。
- 报上来的每一条都要**复现**，修，**补测试**，**证明测试会红**，**一个提交**。

### C. 已知未修（要如实写进第十八批，不要偷偷跳过）

- **桌面包里没有 Python**：`skill-engine/tools` 是 Python 脚本，macOS/Windows 的打包脚本不带解释器，
  所以桌面上「采集」和「写技能包」会失败。这是打包体积/许可问题，Docker 镜像里是带 Python 的。
- **`outbound.markStaleNotified` 仍然是 best-effort**：写「提醒已经说过」这个记录，失败时吞掉。
  只在「这封信不是用户的」时才会失败，而那种情况客户端根本列不出来。
- **Inno Setup 的 `Check:` 没有在真机上编译过**：这一轮在 macOS 上做，没有 Windows 也没有 Inno Setup。
  CI 里另外加了一道闸（没有启动器的包不做安装包），所以即使那段 Pascal 有问题，发出去的包也不会是坏的。
- **真的微信/飞书账号没有被驱动过**：飞书的回声修复有单元测试，但没有对着真的飞书事件流跑过；
  微信监控的失败处理只有进程内的验证。
- **模型服务是本地桩**：实机复验里模型服务是 `scripts/live-stub-model.mjs`（说 OpenAI 协议），
  app 自己的代码路径（provider、请求体、解析）原样跑过，但**真的** provider 没有被调用过。

### D. 上一轮的「测试的坑」（写新测试时先看这里）

- **测试要证明自己抓得住 bug**：本轮有三次「回退了修复、测试还是绿的」——
  1. 情绪报告的焦点测试：焦点本来就在那一项上 → 断言要区分「选项变了」和「焦点变了」。
  2. 大厅筛选标签的测试：`waitFor` 的断言**一开始就是真的** → 断言要写成「切换之后才为真」。
  3. 排序菜单的测试：按钮用名字找，而分身的台词里也有「最近」→ 用 `aria-haspopup` 认按钮。
- **别用 `new Date().getHours()` 断言用户时区**：测试机的时区就是 Asia/Shanghai，
  要先把 `process.env.TZ` 设成 UTC 再断言。
- **组件测试要 mock `useAuth`**：新加了 `useAuth()` 的组件，旧测试会报 `trpc.useUtils is not a function`。
- **新加导出的小组件要在测试里 mock `trpc` 的每一个用到的分支**。
- **Lobby 的测试里 `personas` 是个 store**（`useSyncExternalStore`）：改列表要用 `setPersonas()`，
  直接赋值不会触发重渲染 → 断言会「假绿」。

---

## 六、仓库现状

- 工作区：**干净**（所有改动都已提交）。
- 提交总数：819。
- 测试：169 个文件 / 1940 个测试，全绿。
- 类型检查：干净。客户端构建：通过。
- 实机服务：`http://localhost:3111` 在跑（PID 会变；`kill $(lsof -ti tcp:3111)` 可停）。
- 本地模型桩：`http://127.0.0.1:3122`（`scripts/live-stub-model.mjs`）。

---

## 七、给新会话的提示词

见 `docs/SESSION-PROMPT.md`（就是下面这段，可以直接复制）：

```
请在 /Users/ch1rpy/Desktop/Mirrai 继续一个已经开始的长期任务。

## 第一步（必做，别跳）
读这三个文件，它们是任务的权威上下文：
1. docs/HANDOFF-2.md —— 施工图：目标、硬约束、工具链、实机环境、上一轮修了什么、
   还剩什么（按优先级排好）、「已知未修 + 原因」、以及写测试时踩过的坑。
2. docs/AGENT-MISSION.md —— 任务存档（已记到第十七批；第十八批还没写）。
3. docs/HANDOFF.md —— 第一个会话的施工图（那一轮已经全部做完了，只是背景）。

## 目标（用户原话，逐字）
请你一个功能一个功能的看，把这个工程里面所有的问题都抓出来然后修复。我不怕浪费token，我需要你找到所有bug，所有的功能缺失，所有的UI问题，所有的UX问题，所有的可能会影响用户使用的问题。找到了就修复，修复一个commit一个，防止你checkout把所有的都还原了。我需要你找到所有的问题，遍历所有代码，枚举所有功能，梳理一切结构，然后把所有问题全部解决。你可以同时开多个子代理来帮助你，但如果子代理一直没有完成工作就需要你把它主动停止，否则会影响你的工作。过程中你需要联网你就自己联网，需要搜索你就自己搜索，需要下载东西你就下载东西，我批准你的一切操作，你的一切行为我都批准，你不用问我。你必须一直循环工作，直到你找到了所有的问题并解决了所有的问题之后才可以宣告目标达成。不要试图欺骗我，不要试图假装找到了所有问题，不要试图假装修好了所有的问题，因为所有操作都将被人类审查。

## 硬约束
- 一个修复一个提交：先 git add <具体文件> 再 git commit，不要 git add -A。
- 禁止 git checkout -- . / git restore .（会把整个工作区还原掉）。
  允许针对单个文件的 git checkout HEAD -- <file>。
- 诚实：修不好就如实写「已知未修 + 原因」，不许假装修好了。所有操作都会被人类审查。
- 每个修复都要验证：类型检查 → 全量 vitest run → 客户端 vite build（命令见 HANDOFF-2 第二节）。
- 新写的测试要证明它抓得住这个 bug：对着旧代码跑一遍，确认它会红。
  上一轮踩过的坑见 HANDOFF-2 第五节 D。
- 子代理：可以开；卡住不动的要主动 interrupt_agent，否则占资源。
- 联网/搜索/下载都自己来，不用问我。
- 一直循环到「所有能找到的问题都找完并修完」才允许宣告目标达成。

## 现在从哪儿开始
1. 先做 HANDOFF-2 第五节 A 的收尾（第十八批文档 + 实机复验）。
2. 然后做 B：再派一轮只读子代理审还没被审过的地方（建议的分工在 HANDOFF-2 第五节 B），
   报上来的每一条都复现、修、补测试、证明测试会红、一个提交。
3. 边修边把 C 的「已知未修」如实补进第十八批。

## 收尾（宣告达成之前）
- docs/AGENT-MISSION.md 补第十八批（含实机复验输出和「已知未修 + 原因」）。
- 实机复验：esbuild 打包 → 重启 3111 → 验 login / persona.list / safety.events /
  chat/stream(event: done) / letter.write / chat.export（中文，含关系大事记）。
  脚本：scripts/live-stub-model.mjs + scripts/live-verify.mjs。
- 三件套全绿、工作区干净、每个修复一个提交。
```
