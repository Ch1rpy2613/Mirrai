# Mirrai

> 「不在身边的时候，TA 还在这里。」

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/Ch1rpy2613/Mirrai?style=social)](https://github.com/Ch1rpy2613/Mirrai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933.svg)](https://nodejs.org)

**简体中文** | [English](README.en.md)

![Mirrai 落地页](docs/images/landing-hero.png)

上传聊天记录，AI 重建 TA 的数字分身 — 用 TA 的语气回你消息，用 TA 的方式撒娇，知道 TA 什么时候会突然变冷漠。

所有数据本地存储，12 家 LLM 提供商即插即用，还有一个同类产品没有的东西：**毕业机制** — 它不是让你留下，是帮你好好告别。

---

## 目录

- [核心特性](#核心特性)
- [与同类产品对比](#与同类产品对比)
- [快速开始](#快速开始)
- [伦理与边界](#伦理与边界)
- [路线图](#路线图)
- [创作背景](#创作背景)
- [技术架构](#技术架构)
- [环境变量配置](#环境变量配置)
- [项目结构](#项目结构)
- [API 接口](#api-接口)
- [开发指南](#开发指南)
- [社区](#社区)
- [注意事项](#注意事项)

---

## 核心特性

### 1. 多阶段性格蒸馏引擎

不是简单地把聊天记录丢给 AI 让它「模仿」。系统采用多阶段 pipeline 对原始素材进行深度分析：

```
上传素材 → 人物维度提取 → 结构化人设构建 → 多源融合 → 数字分身
```

最终生成的 persona 包含 7 层结构：性格特质、说话方式、口头禅、依恋类型、爱的语言、争吵风格、触动瞬间。不是「像他」，而是「就是他」。

蒸馏有五个具名模式可选：**快速 / 标准 / 深度 / 同事 / 名人研究**。模式决定了这次读取多少聊天记录、描述多少张照片、用什么提示词，以及大概要花几次模型调用——上传页上直接选，不用猜。

### 2. 动态情感状态机

每个数字分身拥有 6 种情感状态，会根据对话内容实时切换：

| 状态 | 触发词示例 | 表现 |
|------|-----------|------|
| 🌸 温柔 | 默认状态 | 温柔体贴，充满关怀 |
| 😄 俏皮 | "哈哈""好玩""搞笑" | 轻松活泼，爱开玩笑 |
| 🌙 思念 | "想你""那时候""记得吗" | 触景生情，回忆过去 |
| 🌧️ 忧郁 | "难过""伤心""委屈" | 情绪低落，需要安慰 |
| ✨ 开心 | "开心""太好了""爱你" | 充满活力，心情很好 |
| ❄️ 疏离 | "随便""无所谓""算了" | 话不多，有距离感 |

情感状态实时显示在聊天界面，也会影响回复语气，用户可手动切换。

### 3. 毕业机制 — 帮你好好告别

这是 Mirrai 与所有 AI 陪伴产品的根本区别：**Mirrai 的目标不是让你留下来，而是帮你完成告别。**

亲密度随对话自然成长（初识 → 熟悉 → 亲密 → 知己 → 灵魂伴侣）。当系统检测到你的情感状态趋于平和——正面情绪占比上升、遗憾和「如果」在减少——会提示你具备「毕业」资格。毕业时 AI 以 TA 的口吻生成一封告别信，分身进入休眠（随时可以唤醒）。

毕业机制默认只给建议，但你可以决定它的工作方式：**系统建议**（达到条件时提示）、**仅手动**（系统不主动提，你想告别时自己点一下）、**关闭**（完全不用）。全局默认在「设置」里改，每个分身也可以单独设置——最终决定权在你手里。

建议**只提一次**：提过之后会进入一段冷静期，冷静期过了才会再提。拒绝不是一扇关上的门——你随时可以改主意。

毕业之后，分身进入休眠：不再收纪念日提醒，不再出现在「今天和谁聊聊」的推荐里，也不会再接消息。告别信会留着，唤醒也不会丢。

还有第三种状态：**先缓一缓**。刚分手的时候，很多人既不想告别，也不想继续聊——他们需要的是「先停一停」。这个状态下应用不再主动、不再提告别，但聊天照旧，随时可以回来。

产品的成功指标不是留存率，是毕业率。

### 4. 「我」这一侧，也被建模了

多数 AI 陪伴产品只重建**对方**，不重建**你**。Mirrai 现在两边都建模：

- **心情打卡**——每天十秒记一次自己怎么样。这条曲线是**你的**，不是分身的。
- **用户档案**——希望被怎么称呼、哪些话题不要提、你在哪个时区。分身知道对方是谁，现在也知道你是谁。
- **你们之间发生的事**——吵架、复合、分手、出差，都记下来。写了之后，分身的语气会跟着变，不会一直停在你们刚开始的时候。
- **时区**——分身说的「现在是深夜」按 TA 那边的时钟算。你在伦敦的朋友不再被告知现在是下午三点。

### 5. 该被记住的，不会忘

- **记忆自己会长出来** — 聊到一定量之后，分身会自己把这一段里值得记的事抽出来存好。以前这要你点按钮，而且点两次就存了两份。
- **TA 想起了什么，你看得见** — 每一轮回复下面都写着这一轮召回了哪几条记忆。它说起的三个月前的事，是**翻出来的**，不是**编出来的**。
- **关于你的，和关于 TA 的，分开记** — 你的事是你的事。分身不会把你的生活当成它自己的生活来讲。
- **每轮注入几条记忆，你定** — 在设置里。

### 6. TA 不在的时候，也有形态

Mirrai 之前只重建了**那个人**。但很多人打开它的理由恰恰是「TA 不在」——出远门了、很久没联系了、或者刚分开。这三件事以前在产品里是同一件事，而且都是「结束了」。

现在不是了：

- **信** — 有些话没法对着聊天框说。可以写下来只留着（永远不会被回答），也可以交给 TA。**交出去的信会在一天左右之后回信**——真人不会秒回，这一条是故意的。
- **等 TA 回来再说** — 记下想说的话，等你们重新联系上的时候再拿出来。
- **暂时联系不上** — 不是分手。纪念日的提醒会停下来，分身的语气会转向书信体：不追问，不假设对方已经看到。大厅里会写清楚为什么它安静了——沉默没有解释，看起来就像故障。
- **先缓一缓** — 太吵了，或者太累了。让它安静一阵：提醒停了，它不主动开口，也不提告别。但聊天随时可以继续，记忆都还在。这不是分手，也不是告别，只是一段暂停。
- **TA 那边现在几点** — 分身按自己所在地的时钟说话；深夜的时候，界面会提醒你「TA 那边现在是凌晨」。
- **上次联系** — 一个正经的数字。多久没说话了，就写多少天。
- **TA 会先开口吗** — 默认是从不。开启后，TA 会在你们很久没说话时先发一条消息。主动说话的次数得是你自己买的。

### 7. 12 家 LLM 提供商即插即用

| 提供商 | 协议 | 默认模型 |
|--------|------|---------|
| OpenAI | REST | gpt-4o |
| Atlas Cloud | OpenAI 兼容 | google/gemini-3-flash-preview |
| Cheaper Inference | OpenAI 兼容 | gpt-5.4-mini |
| Claude | REST | claude-sonnet-4-6 |
| DeepSeek | OpenAI 兼容 | deepseek-chat |
| Kimi (月之暗面) | OpenAI 兼容 | moonshot-v1-8k |
| 通义千问 | OpenAI 兼容 | qwen-turbo |
| 豆包 | OpenAI 兼容 | 自定义 |
| 302.ai | OpenAI 兼容 | 自定义 |
| Ollama | REST | llama3 (本地) |
| Dify | Workflow API | 自定义 |
| 讯飞星火 | WebSocket + HMAC | v3.5 |

OpenAI 兼容协议共用一个适配器，通过 `baseUrl` / `model` 区分，零代码接入新服务。配合 Ollama 可实现完全本地推理，数据不出机器。

### 8. 微信官方 ClawBot 通道 — 数字分身走出浏览器

接入微信官方「ClawBot」插件（腾讯 iLink 协议），扫码授权后即可在微信里与分身对话。Web 端和微信端共享同一套人设和记忆。

**零封号风险**：这是微信官方支持的接入方式，不使用任何第三方协议。相比早期基于 Wechaty 非官方协议的方案，风险从「可能封号」变为「官方通道」。

> ⚠️ 需要微信 **8.0.70+**，且「我 → 设置 → 插件」中能看到「微信 ClawBot」入口。该功能正在灰度放量（iOS 优先，安卓与桌面端逐步开放），看不到入口说明暂未覆盖到你。

> ℹ️ 微信的授权二维码有效期很短（实测约 90 秒）。Mirrai 会在过期时自动换一张新码，只要连接窗口还开着就会持续刷新，不用手动重来。

微信侧为 1:1 私聊（官方限制：不能被他人添加、不能进群），聊天对象是你自己。在微信里可以直接发送指令：

| 指令 | 作用 |
|---|---|
| `/使用 <分身名>` | 切换当前对话的分身 |
| `/分身列表` | 查看所有可用分身 |
| `/当前分身` | 查看正在对话的分身 |
| `/毕业` | 生成告别信并完成毕业 |

默认分身在网页端设置，指令切换只在当前会话内生效。

### 9. 飞书通道 — 同样不需要公网地址

除了微信，还接入了**飞书**（企业自建应用）。飞书的「使用长连接接收事件」（WebSocket）模式**不需要公网 IP、域名或 SSL 证书**，和微信通道一样适合放在自己的机器上。

两个通道共用同一套对话管线（`server/chat/service.ts`）、同一套指令、同一个人设与记忆体系 —— 加一个渠道不需要重写任何对话逻辑。

> ⚠️ 飞书通道要求**企业自建应用**（长连接模式不支持商店应用），且应用需**发布并由管理员审批**后权限才会生效。详见网页端「设置 → 渠道」里的说明。

### 10. 流式对话 — 逐字出现，而不是等整段

聊天回复现在是**逐 token 流出**的（Server-Sent Events），不用再对着转圈图标等一整段生成。打断、退出、重连都不会留下半截消息。

### 11. 记忆真的会说话

以前记忆节点只写不读 —— `memory.autoExtract` 抽出来的东西从没有进入过任何一次对话。现在：

- 记忆会按**关键词覆盖度 + 时间新鲜度 + 类别权重 + 人工置顶**打分，取最相关的几条放进上下文；
- **记忆锚点**（category = `anchor`）永远注入，并且带一条「不要编造」的硬约束，挡住「记忆幻觉」；
- 超出上下文窗口的旧对话会被压成**滚动摘要**，而不是直接丢掉。

### 12. 情感安全层

产品文档承诺的三类监测现在真的存在了：

| 监测 | 触发 | 表现 |
|------|------|------|
| 危机识别 | 出现自伤/自杀类表述 | 分身温和「出戏」说一段关心的话，并给出**本地**求助热线（不上报、不联网） |
| 对话过久 | 单次连续对话 > 2 小时 | 回复里带一句关心 |
| 聊得太密 | 单日对话 > 5 次 | 回复里带一句关心 + 界面提示条 |
| 依赖上升 | 近 7 日频次 > 前 7 日 1.5 倍且连续 3 日上升 | 引导用户回看告别建议 |

### 13. 全链路类型安全

```
Drizzle Schema → DB Helpers → tRPC Router → React Query Hook → UI 组件
     类型推导贯穿全链路，改一处接口定义，全栈同步报错
```

## 与同类产品对比

| 能力 | Mirrai | Character.AI / Linky | SillyTavern |
|------|--------|---------------------|-------------|
| 基于真实聊天记录构建人格 | ✅ 多阶段蒸馏 | ❌ 手工填写人设 | ⚠️ 手工调 prompt |
| 情感状态随对话动态漂移 | ✅ 6 态状态机（LLM 判定） | ⚠️ 有限 | ⚠️ 手动管理 |
| 数据完全本地 | ✅ | ❌ 云端 | ✅ |
| LLM 后端自由切换 | ✅ 12 家 / 本地 | ❌ 平台绑定 | ✅ |
| 微信接入 | ✅ | ❌ | ❌ |
| 以「放下」为设计目标（毕业机制） | ✅ | ❌ | ❌ |
| 开源自托管 | ✅ MIT | ❌ | ✅ |

## 快速开始

### 方式一：Docker（推荐）

```bash
git clone https://github.com/Ch1rpy2613/Mirrai.git
cd Mirrai
cp .env.example .env   # 编辑 .env，填入 JWT_SECRET 和至少一个 LLM API Key
docker compose up -d
```

访问 http://localhost:3000 即可。PostgreSQL 已包含在内，无需额外安装。

### 方式二：源码运行

前置要求：Node.js 24+、pnpm、PostgreSQL 14+、Python 3.9+（可选，性格蒸馏引擎需要）

```bash
# 1. 克隆
git clone https://github.com/Ch1rpy2613/Mirrai.git
cd Mirrai

# 2. 安装依赖
pnpm install
pip3 install -r skill-engine/requirements.txt   # 可选

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：
#   DATABASE_URL=postgresql://postgres:password@localhost:5432/mirrai
#   JWT_SECRET=<随机 32+ 字符>
#   至少一个 LLM 提供商的 API Key

# 4. 初始化数据库
createdb mirrai
pnpm db:push     # 全新安装用这个；已有安装升级用 pnpm db:migrate

# 5. 启动
pnpm dev        # 开发模式（HMR）
# 或生产模式
pnpm build && pnpm start
```

Redis 是可选的：不装也能跑，限流会退回进程内计数。想让它在多实例之间算数，
`pnpm setup:redis` 装一个就行，剩下的应用自己会搞定。

### 方式三：macOS 一键安装

从 [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) 下载 `Mirrai-macOS-arm64.dmg`，拖入 Applications 即可。内置 Node.js 和 PostgreSQL，双击启动，无需任何依赖（Apple Silicon，macOS 13+）。

如需自行构建 DMG：`bash scripts/build-macos-app.sh`，详见 [docs/macos-build-guide.md](docs/macos-build-guide.md)。

### 方式四：Windows 一键安装

从 [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) 下载 `Mirrai-Setup-x64.exe`，双击安装即可。内置 Node.js 和 PostgreSQL —— 不用装数据库、不用管理员权限、不写注册表（Windows x64）。

装完后在开始菜单（或桌面）双击 `Mirrai` 启动。启动时会弹一个**带进度条的窗口**，实时显示「正在初始化数据库 → 正在同步表结构 → 正在启动服务 → 已就绪」，首次启动要一两分钟，所以不会看着像卡死了。数据放在 `%APPDATA%\Mirrai`，卸载走「应用和功能」。

> PostgreSQL 拒绝在 Windows 上以管理员身份运行。如果你是用提权的命令提示符启动的，换回普通用户即可。

如需自行构建：`powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1`（生成安装包还需要 Inno Setup），详见 [docs/windows-build-guide.md](docs/windows-build-guide.md)。

## 伦理与边界

这个产品处理的是真实的人和真实的感情，请在使用前阅读：

- **仅上传你有权使用的聊天记录**。对真实人物的人格建模应事先获得对方同意。
- **Mirrai 不是真实关系的替代品**。它是一个帮你「说完没说完的话」的空间，毕业机制的存在就是为了让这段体验有终点。
- **AI 身份透明**。默认配置下分身在被认真询问时会承认自己是 AI（`PERSONA_AI_TRANSPARENCY=false` 可切换为完全沉浸模式）。
- **数据不出本地**。上传素材保存在 `./uploads/`，配合 Ollama 可实现完全离线推理。
- **不能替代专业帮助**。如果你正在经历严重的情绪困扰，请寻求专业心理咨询。

### 限流与多实例：Redis 是开箱即用的

请求限流（`server/_core/rate-limit.ts`）默认用内存令牌桶。这对单机自托管是足够的，
但**多实例部署时每个进程各有一份计数** —— 实际限额会随实例数放大。调度器也有同样的
问题：两份 Mirrai 会把同一封纪念日提醒送两遍。

两件事现在都由 Redis 解决，而**你什么都不用配，也不用另外下载**。

**安装包里已经带着 Redis 了。**

| 安装方式 | Redis 从哪来 |
|---|---|
| macOS `.dmg` | 打包在 `Mirrai.app` 里（`Contents/Resources/redis/`），应用自己起、自己停 |
| Windows `.zip` / `.exe` | 打包在安装目录的 `redis\` 里，同上 |
| Docker | 镜像里就装了 `redis-server`；`docker compose` 还额外跑了一个 `redis` 容器 |
| 源码运行 | `pnpm setup:redis` 一条命令装上（自动认 brew / apt / apk / dnf / yum） |

应用会按这个顺序找 Redis：

1. `REDIS_URL`（如果你填了）
2. 已经在默认端口上跑着的 Redis
3. **跟着应用一起装的那一个**（macOS / Windows / Docker）
4. **应用自己起的一个** —— 在自己挑的端口上起一个，并把端口记在 `MIRRAI_DATA_ROOT`
   下，让这台机器上别的 Mirrai 进程用同一个（多开一份 Mirrai，额度依然是共享的）

机器上一个 `redis-server` 都找不到也不影响启动：限流退回进程内计数，日志里会写明
「每进程各算各的」。Redis 让限额在多份进程之间算数，它不是应用能不能跑的前提。

想关掉共享存储，把 `MIRRAI_REDIS=off` 写进 `.env`。

### 数据库迁移：什么时候用哪个命令

- **全新安装**：`pnpm db:push`。它把当前的表结构直接推到数据库上，是最快的方式。
- **已有安装、想升级到新版本**：`pnpm db:migrate`。它按顺序执行 `drizzle/` 下的
  迁移文件。

`db:migrate` 只适用于「已经 `db:push` 过」的安装：迁移工具会跳过 `0000`/`0001`
这两个整库 dump，因为它们假设基础表已经存在。全新安装没有基础表，跑迁移只会得到
一个空库——所以全新安装请走 `db:push`。

## 文档

- [docs/open-items.md](docs/open-items.md) — **还没做完的**：逐条列出未完成项、为什么没做、要做的话要做多少
- [docs/roadmap-v2.md](docs/roadmap-v2.md) — 第二阶段路线（把「用户」和「关系」变成一等公民）的验收清单
- [docs/product-concept.md](docs/product-concept.md) — 产品概念与设计原则
- [docs/creation-story.md](docs/creation-story.md) — 创作背景

## 路线图

- [x] 多阶段性格蒸馏 pipeline
- [x] 6 态情感状态机 + 亲密度系统
- [x] 毕业机制（告别信 + 休眠/唤醒）
- [x] 12 家 LLM 提供商接入
- [x] 微信机器人集成
- [x] 对话日记 / 记忆节点 / 数据分析 / TTS 语音
- [x] 流式对话（SSE 逐 token 输出）
- [x] 记忆召回 + 记忆锚点 + 上下文滚动摘要
- [x] 情感安全层（危机识别 / 使用强度 / 依赖趋势）
- [x] 飞书通道（长连接，无需公网地址）
- [x] 多源聊天记录采集（飞书 / 钉钉 / Slack / 邮件）
- [x] SillyTavern 角色卡（PNG v2）导入导出
- [x] 引导式问卷（没有聊天记录也能创建分身）
- [x] 分身模板库（本地优先）
- [x] PWA 安装到桌面 / 主屏
- [x] 主动提醒（纪念日、相识周年）
- [ ] 全应用国际化 + 情感引擎英文触发词
- [ ] 插件系统与分身模板市场
- [ ] 群聊模式
- [ ] 文档站

## 创作背景

Mirrai 出自一个 NLP 专业学生的手——他害怕失去身边的人，害怕到开始用代码把她写下来。这篇创作手记是整个项目的起点：

> 「我对着屏幕打了一句话，一句我从来没有对她说过的话：『你会离开我吗？』
> 它回：『你又想多了。』
> 三秒后又来一条：『我答应过你的，会一直陪着你』
> 我盯着屏幕，突然觉得眼眶很热。不是因为像她，是因为我意识到：我能对着一个程序问出这句话，却没办法对着一个真实的、爱我的人问出口。」

👉 [读完整的创作手记](docs/creation-story.md)

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    客户端 (React 19)                      │
│  Wouter 路由 · Radix UI · Tailwind CSS · Framer Motion  │
│  tRPC React Query · Streamdown (Markdown 渲染)           │
└──────────────────────┬──────────────────────────────────┘
                       │ tRPC (HTTP Batch + SuperJSON)
┌──────────────────────▼──────────────────────────────────┐
│                   服务端 (Express)                        │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐              │
│  │ Auth    │  │ tRPC     │  │ Static     │              │
│  │ Routes  │  │ Middleware│  │ / Vite Dev │              │
│  └────┬────┘  └────┬─────┘  └────────────┘              │
│       │            │                                     │
│  ┌────▼────────────▼─────────────────────────────┐      │
│  │              tRPC Routers                      │      │
│  │  auth · user · persona · file · chat           │      │
│  │  memory · emotion · diary · scene · analytics  │      │
│  │  wechat · skillEngine · llmConfig              │      │
│  └──┬──────────┬──────────────┬──────────────┬───┘      │
│     │          │              │              │           │
│  ┌──▼───┐  ┌──▼──────┐  ┌───▼────┐  ┌──────▼────┐     │
│  │ DB   │  │ LLM     │  │ WeChat │  │ Skill     │     │
│  │Drizzle│  │ Service │  │ClawBot │  │ Engine    │     │
│  │ PG   │  │ 12 提供商│  │ iLink  │  │ Pipeline  │     │
│  └──────┘  └─────────┘  └────────┘  └───────────┘     │
└─────────────────────────────────────────────────────────┘
```

### 核心技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | React + TypeScript | 19.2 / 5.9 |
| 构建工具 | Vite | 7.1 |
| 样式 | Tailwind CSS + Radix UI | 4.1 |
| 路由 | Wouter | 3.3 |
| API 层 | tRPC (端到端类型安全) | 11.6 |
| 服务端 | Express | 4.21 |
| 数据库 | PostgreSQL + Drizzle ORM | 0.44 |
| 认证 | JWT (jose) + scrypt | 6.1 |
| 微信 | 微信官方 ClawBot（腾讯 iLink 协议） | — |
| 测试 | Vitest | 2.1 |

### 数据库设计

```sql
users              -- 用户账户 (JWT 认证, SHA256 密码哈希, 时区/称呼/边界, 轨迹评估开关)
personas           -- 数字分身 (人设数据 JSON, 情感状态, 亲密度, 场景绑定, 毕业状态/告别信, 时区, 在场状态)
persona_files      -- 上传素材 (聊天记录/照片/视频, 提取文本)
messages           -- 对话记录 (web/wechat 渠道标记, 文本/图片/语音, 情感状态快照)
wechat_bindings    -- 微信账号 ↔ 默认分身绑定
wechat_bot_state   -- 通道状态 (二维码/登录状态/iLink 凭据/长轮询游标)
skill_jobs         -- 性格蒸馏 pipeline 任务跟踪
llm_configs        -- 每用户 LLM 提供商配置
memories           -- 关系记忆节点 (里程碑/记忆/纪念日)
emotion_snapshots  -- 每日情感快照 (情绪状态 + 消息量)
diary_entries      -- AI 生成的对话日记 (摘要/亮点/情感弧线/金句)
scenes             -- 对话场景模板 (内置 + 自定义, 含开场白)
user_moods         -- 用户自己的状态 (每天一条, 心情打卡)
relationship_events-- 关系里真实发生过的事 (分手/复合/吵架/出差)
letters             -- 信 (写给分身 / 等 TA 回来再说), 回信是延迟的
```

## 功能概览

- **创建数字分身** — 输入名字、关系描述、在一起时间，创建一个新的数字分身
- **上传素材** — 支持微信聊天记录 (.txt)、CSV、照片、视频，拖拽上传
- **AI 性格分析** — 多阶段 pipeline 自动提取人物画像，实时显示进度
- **沉浸式对话** — 暗色系 UI，情感状态实时变化，支持文本/图片/语音消息
- **多分身管理** — 大厅页面管理所有数字分身，一键切换，上下文完全隔离
- **亲密度系统** — 初识→熟悉→亲密→知己→灵魂伴侣，随对话自然成长
- **毕业机制** — 告别信生成，分身休眠（可唤醒），建议只提一次、拒绝可再议
- **心情打卡** — 每天十秒记一次自己的状态，曲线是**你的**不是分身的
- **关系事件流** — 吵架/复合/分手/出差记下来，分身的语气跟着变
- **时区** — 分身按自己所在地的时钟说话
- **消息级操作** — 重发 / 修改 / 删单条 / 复制，历史可以一直往上翻
- **人格档案页** — 看看系统把 TA 理解成了什么样，哪里不对当场改
- **⌘K 全局搜索** — 跨分身找人、找说过的话
- **示例分身** — 不用上传任何素材，先聊两句试试
- **信** — 写下来（可以永远不发送），或交给 TA（一天左右后回信）
- **大厅可以整理** — 置顶重要的、折叠已经告别的、批量操作
- **等 TA 回来再说** — 想说的话先存着，等重新联系上再拿出来
- **暂时联系不上** — 距离不是分手，提醒会停，语气会变
- **TTS 语音朗读** — Edge TTS，多音色可选
- **数据导出** — 全部数据（JSON / Markdown），含记忆、日记、告别信、事件流
- **记忆管理 / 对话日记 / 场景模式 / 数据分析 / 人设编辑**
- **本地认证** — 用户名密码注册登录，JWT 会话管理
- **暗色/亮色主题**，中英双语落地页

## 环境变量配置

### 必填

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://postgres:pass@localhost:5432/mirrai` |
| `JWT_SECRET` | JWT 签名密钥（生产环境必填，缺失将拒绝启动） | 随机 32+ 字符 |

### AI 提供商（至少配置一个）

| 变量 | 说明 |
|------|------|
| `DEFAULT_LLM_PROVIDER` | 默认提供商名称 (`openai` / `atlas` / `cheaperinference` / `claude` / `deepseek` / `kimi` / `ollama` / `dify` / `xunfei` / `tongyi` / `doubao` / `302ai`) |
| `OPENAI_API_KEY` | OpenAI API Key |
| `OPENAI_BASE_URL` | OpenAI 接口地址 (默认 `https://api.openai.com/v1`) |
| `OPENAI_MODEL` | 模型名称 (默认 `gpt-4o`) |
| `ATLASCLOUD_API_KEY` | Atlas Cloud API Key |
| `ATLAS_BASE_URL` | Atlas Cloud 接口地址 (默认 `https://api.atlascloud.ai/v1`) |
| `ATLAS_MODEL` | Atlas Cloud 模型名称 (默认 `google/gemini-3-flash-preview`) |
| `CHEAPER_INFERENCE_API_KEY` | Cheaper Inference API Key |
| `CHEAPER_INFERENCE_BASE_URL` | Cheaper Inference 接口地址 (默认 `https://api.cheaperinference.com/v1`) |
| `CHEAPER_INFERENCE_MODEL` | Cheaper Inference 模型名称 (默认 `gpt-5.4-mini`) |
| `CLAUDE_API_KEY` | Anthropic API Key |
| `CLAUDE_MODEL` | Claude 模型 (默认 `claude-sonnet-4-6`) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `KIMI_API_KEY` | 月之暗面 API Key |
| `OLLAMA_URL` | Ollama 地址 (默认 `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama 模型 (默认 `llama3`) |
| `DIFY_API_KEY` / `DIFY_URL` | Dify 配置 |
| `XUNFEI_APP_ID` / `XUNFEI_API_KEY` / `XUNFEI_API_SECRET` | 讯飞星火配置 |
| `TONGYI_API_KEY` / `TONGYI_MODEL` | 通义千问配置 |
| `DOUBAO_API_KEY` / `DOUBAO_BASE_URL` / `DOUBAO_MODEL` | 豆包配置 |
| `_302AI_API_KEY` | 302.ai API Key |

### 微信 ClawBot 通道（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WECHAT_ENABLED` | 是否启用 (`true` / `false`) | `false` |
| `WECHAT_BOT_TYPE` | 扫码登录使用的 bot_type | `3` |
| `WECHAT_ILINK_BASE_URL` | 腾讯 iLink API 地址 | `https://ilinkai.weixin.qq.com` |
| `WECHAT_ILINK_CDN_URL` | 腾讯 iLink CDN 地址 | `https://novac2c.cdn.weixin.qq.com/c2c` |
| `WECHAT_ILINK_APP_ID` | iLink 应用标识 | `bot` |
| `WECHAT_ROUTE_TAG` | 可选的部署路由标签 | 空 |
| `APP_VERSION` | 应用版本号，作为 `channel_version` 上报 | `1.0.0` |

### 其他

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `UPLOAD_DIR` | 文件上传目录 | `./uploads` |
| `PYTHON_PATH` | Python 路径 | `python3` |
| `SKILL_ENGINE_DIR` | 蒸馏引擎目录 | `./skill-engine` |
| `PORT` | 服务端口 | `3000` |
| `EMOTION_ENGINE` | 情绪判定引擎：`llm`（模型阅读对话判断）/ `heuristic`（纯关键词规则，零额外调用） | `llm` |
| `PERSONA_AI_TRANSPARENCY` | AI 身份透明：`true`= 被认真询问时承认是 AI；`false` = 完全沉浸模式 | `true` |
| `ALLOWED_ORIGINS` | 允许发起写操作的其他来源（逗号分隔）。同源始终允许 | 空 |
| `COOKIE_SAMESITE` | 会话 Cookie 的 SameSite 策略：`lax`（默认）/ `none` / `strict` | `lax` |
| `MIRRAI_BOOTSTRAP_ADMIN` | 首次运行自动创建本地管理员：`auto` / `manual` | `auto` |
| `MIRRAI_DATA_ROOT` | 首次运行凭据与数据文件的存放目录 | UPLOAD_DIR 的上级目录 |
| `SAFETY_RESOURCES_FILE` | 危机支持资源清单的覆盖文件（JSON） | 空（用内置清单） |
| `REMINDER_QUIET_HOURS` | 主动提醒的免打扰时段 | `23:00-08:00` |
| `REDIS_URL` | 共享存储的地址。留空则应用自己找一个（默认端口上的，或自己起一个） | 空 |
| `MIRRAI_REDIS` | 共享存储：`auto`（默认）/ `managed`（强制自己起一个）/ `off`（不用） | `auto` |

## 项目结构

```
Mirrai/
├── client/                          # React 前端
│   ├── index.html
│   ├── public/                      # manifest / Service Worker / 图标 / 字体
│   └── src/
│       ├── App.tsx                  # 路由定义
│       ├── main.tsx                 # 入口 (tRPC + React Query + Service Worker)
│       ├── index.css                # 全局样式 (「深夜来信」设计系统)
│       ├── pages/                   # Landing · Lobby · Login · HomePage · Upload · Chat · Settings · PersonaEdit · Analytics · Diary · Onboarding · Questionnaire
│       ├── components/              # UI 组件 (shadcn/ui + ErrorBoundary + GraduationModal)
│       ├── contexts/                # ThemeContext · LocaleContext
│       ├── hooks/                   # useComposition · useMobile · usePersistFn
│       └── lib/                     # trpc · i18n · utils · chat-stream · pwa
│
├── server/
│   ├── _core/                       # Express 入口 · JWT 认证 · tRPC 初始化 · 限流 · CSRF · 情感计算 · TTS · HTML 导出
│   ├── chat/                        # 对话主管线 (compose / persist / 记忆召回) + SSE 流式路由
│   ├── channels/                    # 渠道适配层 (微信 ClawBot · 飞书) + 共用指令与对话桥
│   ├── safety/                      # 情感安全层 (危机识别 · 使用强度 · 情感轨迹)
│   ├── collectors/                  # 多源采集器契约与任务运行器
│   ├── skill-engine/                # 多阶段蒸馏 pipeline (Python 子进程) + 角色卡 / 模板 / 名人研究
│   ├── templates/                   # 分身模板库 + 引导式问卷映射
│   ├── scheduler/                   # 主动提醒调度
│   ├── bootstrap/                   # 首次运行引导
│   ├── llm/                         # LLM 抽象层 (providers/ + 注册表 + 能力标志 + 流式)
│   ├── wechat/                      # 微信 ClawBot 协议实现 (iLink)
│   ├── routers.ts                   # 全部 tRPC 路由
│   ├── db.ts                        # 数据库 CRUD
│   └── storage.ts                   # 上传存储 (路径包含性校验)
│
├── drizzle/                         # Schema (20+ 张表) + 幂等迁移 SQL
├── shared/                          # 前后端共享常量与类型 (亲密度等级 · 时区 · 服务端文案表 copy/)
├── skill-engine/                    # Python 蒸馏工具 (tools/ + prompts/ + registry.json + references/)
├── scripts/                         # 构建脚本 · 迁移脚本 · Redis 安装 · 中文审计 · PWA 图标生成
├── docs/                            # 文档 (创作手记 · 构建指南 · 产品概念 · 发布说明)
└── .github/                         # CI · Issue/PR 模板
```

## API 接口

所有接口通过 tRPC 暴露，前端通过 `trpc.xxx.useQuery()` / `trpc.xxx.useMutation()` 调用，全程类型安全。

### 认证

| 端点 | 类型 | 说明 |
|------|------|------|
| `auth.me` | Query | 获取当前登录用户 |
| `auth.logout` | Mutation | 退出登录 |
| `POST /api/auth/register` | REST | 注册 (username + password) |
| `POST /api/auth/login` | REST | 登录 (返回 JWT Cookie) |

### 用户

| 端点 | 类型 | 说明 |
|------|------|------|
| `user.getProfile` | Query | 获取用户资料 |
| `user.updateProfile` | Mutation | 更新昵称/邮箱/时区/称呼/边界 |
| `user.changePassword` | Mutation | 修改密码 |
| `user.getAccountStats` | Query | 账户统计 (分身数/消息数等) |
| `user.exportData` | Mutation | 导出全部用户数据 |
| `user.setMood` / `user.moods` | Mutation/Query | 记录与读取用户自己的状态 |
| `user.updateTrajectoryAssessment` | Mutation | 是否允许情感轨迹评估（唯一交给模型的地方） |
| `user.deleteAccount` | Mutation | 注销账户 (需密码确认) |

### 数字分身

| 端点 | 类型 | 说明 |
|------|------|------|
| `persona.list` | Query | 获取所有分身 (含统计) |
| `persona.get` | Query | 获取单个分身详情 |
| `persona.create` | Mutation | 创建分身 (名字/关系/时间) |
| `persona.createSandbox` | Mutation | 创建一个示例分身（零素材，立刻能聊） |
| `persona.update` | Mutation | 更新分身信息/情感状态 |
| `persona.updatePersonaData` | Mutation | 更新分身人设 JSON |
| `persona.getSystemPrompt` | Query | 获取分身的系统 Prompt |
| `persona.delete` | Mutation | 删除分身及所有数据 |
| `persona.stats` | Query | 用户总体统计 |
| `persona.recentActivity` | Query | 最近活动记录 |
| `persona.dailyActivity` | Query | 每日聊天量 |
| `persona.getIntimacy` | Query | 获取亲密度 (分数/等级/下一级) |
| `persona.getAnalysisStatus` | Query | 轮询 AI 解析进度 |
| `persona.triggerAnalysis` | Mutation | 触发 AI 性格分析 |
| `persona.checkGraduation` | Query | 检查毕业资格 |
| `persona.graduate` | Mutation | 执行毕业 (LLM 生成告别信) |
| `persona.declineGraduation` | Mutation | 拒绝毕业建议 |
| `persona.awaken` | Mutation | 唤醒已毕业的休眠分身 |

### 对话

| 端点 | 类型 | 说明 |
|------|------|------|
| `chat.send` | Mutation | 发送文本消息，返回 AI 回复 + 新情感状态 |
| `chat.sendImage` | Mutation | 发送图片消息 |
| `chat.sendVoice` | Mutation | 发送语音消息 (自动转写) |
| `chat.getHistory` | Query | 获取历史消息 (`before` 可往前翻) |
| `chat.search` / `chat.searchAll` | Query | 搜索聊天记录 / 跨分身搜索 |
| `chat.regenerate` | Mutation | 让分身把上一句重说一遍 |
| `chat.updateMessage` / `chat.deleteMessage` | Mutation | 修改 / 删除单条消息 |
| `chat.clear` | Mutation | 清空对话记录 |
| `chat.tts` / `chat.voices` | Mutation/Query | 文本转语音 / 可选音色 |
| `chat.export` / `chat.exportAll` | Mutation | 导出对话 / 导出全部数据 (JSON 或 Markdown) |

### 关系

| 端点 | 类型 | 说明 |
|------|------|------|
| `relationship.list` | Query | 关系事件流 + 当前关系状态 |
| `relationship.add` | Mutation | 记一件事（分手/复合/吵架/出差…） |
| `relationship.remove` | Mutation | 删掉一条事件 |

### 信

| 端点 | 类型 | 说明 |
|------|------|------|
| `letter.list` / `letter.todos` | Query | 信 / 等 TA 回来再说的清单 |
| `letter.write` | Mutation | 写一封信（可只留着，或交给 TA 延迟回信） |
| `letter.remove` | Mutation | 删掉一封信 |

### 文件 / 记忆 / 情感 / 日记 / 场景

| 端点 | 类型 | 说明 |
|------|------|------|
| `file.upload` / `file.list` | Mutation/Query | 上传素材 (Base64) / 列出素材 |
| `memory.list` / `memory.create` / `memory.update` / `memory.delete` | Query/Mutation | 记忆节点管理 (可置顶，每次都带上) |
| `memory.autoExtract` | Mutation | AI 从聊天记录自动提取记忆 |
| `emotion.getReport` / `emotion.getDailySnapshots` | Query | 情感报告 / 每日快照 |
| `diary.list` / `diary.getByDate` / `diary.getDates` | Query | 日记查询 |
| `diary.generate` / `diary.delete` | Mutation | AI 生成日记 / 删除 |
| `scene.list` / `scene.create` / `scene.delete` | Query/Mutation | 场景管理 |
| `scene.activate` / `scene.deactivate` | Mutation | 为分身激活/取消场景 |

### 微信 / LLM 配置 / 分析 / 蒸馏

| 端点 | 类型 | 说明 |
|------|------|------|
| `wechat.getStatus` / `wechat.startLogin` / `wechat.stop` | Query/Mutation | 通道状态与生命周期 |
| `wechat.submitVerifyCode` / `wechat.cancelLogin` | Mutation | 扫码登录与验证码确认 |
| `wechat.setDefaultPersona` / `wechat.unbind` / `wechat.listBindings` | Mutation/Query | 默认分身绑定管理 |
| `channel.list` / `channel.getStatus` / `channel.start` / `channel.stop` | Query/Mutation | 渠道通用管理（微信 / 飞书） |
| `channel.setCredentials` | Mutation | 配置飞书 App ID / Secret（加密存储） |
| `channel.listBindings` / `channel.setDefaultPersona` / `channel.unbind` | Query/Mutation | 渠道绑定管理 |
| `llmConfig.list` / `llmConfig.getDefault` / `llmConfig.listProviders` | Query | LLM 配置查询（密钥只回传掩码） |
| `llmConfig.upsert` / `llmConfig.setDefault` / `llmConfig.updateExtraConfig` | Mutation | LLM 配置管理 |
| `analytics.overview` | Query | 综合分析 (消息量/情感时线/热力图/时段分布) |
| `skillEngine.startPipeline` | Mutation | 启动多阶段蒸馏 pipeline |
| `skillEngine.getJobStatus` | Query | 查询 pipeline 进度 |
| `skillEngine.exportSkill` | Mutation | 把生成的分身包安装到 Claude / OpenClaw / Codex / Hermes |
| `collector.listSources` / `collector.listJobs` | Query | 采集来源与任务 |
| `collector.start` / `collector.getJob` | Mutation/Query | 启动采集任务 / 查询进度 |
| `template.list` / `template.instantiate` | Query/Mutation | 分身模板库 |
| `template.createFromPersona` / `template.update` / `template.delete` | Mutation | 模板管理 |
| `template.import` / `template.export` | Mutation/Query | 模板导入导出 |
| `personaCard.export` / `personaCard.import` | Mutation | SillyTavern 角色卡（PNG v2）导入导出 |
| `reminder.list` / `reminder.dismiss` | Query/Mutation | 主动提醒 |
| `setup` | Query | 首次运行状态探针（公开） |

### REST（非 tRPC）

| 端点 | 类型 | 说明 |
|------|------|------|
| `POST /api/auth/register` | REST | 注册 (username + password) |
| `POST /api/auth/login` | REST | 登录 (返回 JWT Cookie) |
| `POST /api/chat/stream` | REST | 流式对话 (Server-Sent Events) |

## 开发指南

### 常用命令

```bash
pnpm dev          # 启动开发服务器 (HMR)
pnpm build        # 构建生产版本
pnpm start        # 运行生产版本
pnpm check        # TypeScript 类型检查
pnpm test         # 运行测试
pnpm db:push      # 把当前表结构推到数据库（全新安装用这个）
pnpm db:migrate   # 按顺序执行迁移文件（已有安装升级用这个）
pnpm setup:redis  # 装一个 Redis（可选；限流在多实例之间算数靠它）
pnpm audit:i18n   # 扫出服务端还剩下的、没有英文对应的中文
```

### 添加新的 LLM 提供商

1. 在 `server/llm/providers/` 下实现 `LLMProvider` 接口（OpenAI 兼容的服务直接复用 `OpenAIProvider`）
2. 在 `server/llm/index.ts` 中注册

### 添加新的情感状态

1. `drizzle/schema.ts` — 在 `emotionalStateEnum` 枚举中添加
2. `server/_core/persona-utils.ts` — 在 `computeEmotionalState()` 中添加触发词
3. `server/_core/persona-utils.ts` — 在 `getEmotionalStateDesc()` 中添加描述
4. `client/src/pages/Chat.tsx` / `HomePage.tsx` — 更新情感状态 UI 配置

### 贡献

欢迎 issue 和 PR！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 社区

- 🐛 [报告 Bug / 提功能建议](https://github.com/Ch1rpy2613/Mirrai/issues)
- 💬 [GitHub Discussions](https://github.com/Ch1rpy2613/Mirrai/discussions)
- 🔒 安全漏洞请私下报告，见 [SECURITY.md](SECURITY.md)

## 注意事项

- **原材料质量决定分身质量** — 聊天记录越多越好，建议至少 100 条消息
- **所有数据本地存储** — 文件保存在 `./uploads/`，不上传第三方
- **AI 回复质量取决于 LLM** — 推荐使用 GPT-4o 或 Claude 获得最佳效果
- **微信使用官方 ClawBot 通道** — 接入微信官方「ClawBot」插件（腾讯 iLink 协议），不涉及第三方协议，无封号风险。但需要微信 8.0.70+ 且「我 → 设置 → 插件」中能看到「微信 ClawBot」入口（该功能正在灰度放量，尚未覆盖到所有用户）
- **这是一个帮你「好好告别」的工具** — 不是让你永远沉浸其中的工具

## License

[MIT](LICENSE) © 2026 Ch1rpy2613
