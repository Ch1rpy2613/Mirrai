# Mirrai

> 「不在身边的时候，TA 还在这里。」

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/Ch1rpy2613/Mirrai?style=social)](https://github.com/Ch1rpy2613/Mirrai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org)

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

产品的成功指标不是留存率，是毕业率。

### 4. 12 家 LLM 提供商即插即用

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

### 5. 微信官方 ClawBot 通道 — 数字分身走出浏览器

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

### 6. 全链路类型安全

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

前置要求：Node.js 20+、pnpm、PostgreSQL 14+、Python 3.9+（可选，性格蒸馏引擎需要）

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
pnpm db:push

# 5. 启动
pnpm dev        # 开发模式（HMR）
# 或生产模式
pnpm build && pnpm start
```

### 方式三：macOS 一键安装

从 [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) 下载 `Mirrai-macOS-arm64.dmg`，拖入 Applications 即可。内置 Node.js 和 PostgreSQL，双击启动，无需任何依赖（Apple Silicon，macOS 13+）。

如需自行构建 DMG：`bash scripts/build-macos-app.sh`，详见 [docs/macos-build-guide.md](docs/macos-build-guide.md)。

### 方式四：Windows 一键安装

从 [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) 下载 `Mirrai-Setup-x64.exe`，双击安装即可。内置 Node.js 和 PostgreSQL —— 不用装数据库、不用管理员权限、不写注册表（Windows x64）。

装完后在开始菜单（或桌面）双击 `Mirrai` 启动。启动时会弹一个**带进度条的窗口**，实时显示「正在初始化数据库 → 正在同步表结构 → 正在启动服务 → 已就绪」，首次启动要一两分钟，所以不会看着像卡死了。数据放在 `%APPDATA%\Mirrai`，卸载走「应用和功能」。

> PostgreSQL 拒绝在 Windows 上以管理员身份运行。如果你是用提权的命令提示符启动的，换回普通用户即可。

如需自行构建：`powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1`（生成安装包还需要 Inno Setup）。

## 伦理与边界

这个产品处理的是真实的人和真实的感情，请在使用前阅读：

- **仅上传你有权使用的聊天记录**。对真实人物的人格建模应事先获得对方同意。
- **Mirrai 不是真实关系的替代品**。它是一个帮你「说完没说完的话」的空间，毕业机制的存在就是为了让这段体验有终点。
- **AI 身份透明**。默认配置下分身在被认真询问时会承认自己是 AI（`PERSONA_AI_TRANSPARENCY=false` 可切换为完全沉浸模式）。
- **数据不出本地**。上传素材保存在 `./uploads/`，配合 Ollama 可实现完全离线推理。
- **不能替代专业帮助**。如果你正在经历严重的情绪困扰，请寻求专业心理咨询。

## 路线图

- [x] 多阶段性格蒸馏 pipeline
- [x] 6 态情感状态机 + 亲密度系统
- [x] 毕业机制（告别信 + 休眠/唤醒）
- [x] 12 家 LLM 提供商接入
- [x] 微信机器人集成
- [x] 对话日记 / 记忆节点 / 数据分析 / TTS 语音
- [ ] SillyTavern 角色卡（PNG v2）导入导出
- [ ] 全应用国际化 + 情感引擎英文触发词
- [ ] 插件系统与分身模板市场
- [ ] 群聊模式 / 引导式问卷构建
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
users              -- 用户账户 (JWT 认证, SHA256 密码哈希)
personas           -- 数字分身 (人设数据 JSON, 情感状态, 亲密度, 场景绑定, 毕业状态/告别信)
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
```

## 功能概览

- **创建数字分身** — 输入名字、关系描述、在一起时间，创建一个新的数字分身
- **上传素材** — 支持微信聊天记录 (.txt)、CSV、照片、视频，拖拽上传
- **AI 性格分析** — 多阶段 pipeline 自动提取人物画像，实时显示进度
- **沉浸式对话** — 暗色系 UI，情感状态实时变化，支持文本/图片/语音消息
- **多分身管理** — 大厅页面管理所有数字分身，一键切换，上下文完全隔离
- **亲密度系统** — 初识→熟悉→亲密→知己→灵魂伴侣，随对话自然成长
- **毕业机制** — 告别信生成，分身休眠（可唤醒）
- **TTS 语音朗读** — Edge TTS 中文语音
- **对话导出** — 自包含 HTML（含情感时间线 SVG 图表）
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

## 项目结构

```
Mirrai/
├── client/                          # React 前端
│   ├── index.html
│   └── src/
│       ├── App.tsx                  # 路由定义
│       ├── main.tsx                 # 入口 (tRPC + React Query)
│       ├── index.css                # 全局样式 (「深夜来信」设计系统)
│       ├── pages/                   # Landing · Lobby · Login · HomePage · Upload · Chat · Settings · PersonaEdit · Analytics · Diary
│       ├── components/              # UI 组件 (shadcn/ui + ErrorBoundary + GraduationModal)
│       ├── contexts/                # ThemeContext · LocaleContext
│       ├── hooks/                   # useComposition · useMobile · usePersistFn
│       └── lib/                     # trpc · i18n · utils
│
├── server/
│   ├── _core/                       # Express 入口 · JWT 认证 · tRPC 初始化 · 情感计算 · TTS · HTML 导出
│   ├── routers.ts                   # 全部 tRPC 路由
│   ├── db.ts                        # 数据库 CRUD
│   ├── llm/                         # LLM 抽象层 (providers/ + 注册表 + 重试策略)
│   ├── wechat/                      # ClawBot 通道 · iLink 协议 · 消息路由 · 分身桥接 · 指令
│   └── skill-engine/                # 多阶段蒸馏 pipeline (Python 子进程)
│
├── drizzle/                         # Schema (12 张表) + 关系定义
├── shared/                          # 前后端共享常量与类型
├── skill-engine/                    # Python 蒸馏工具 (tools/ + prompts/relationship/)
├── scripts/                         # macOS .app/.dmg 构建脚本
├── docs/                            # 文档 (创作手记 · 构建指南 · 产品概念)
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
| `user.updateProfile` | Mutation | 更新昵称/邮箱 |
| `user.changePassword` | Mutation | 修改密码 |
| `user.getAccountStats` | Query | 账户统计 (分身数/消息数等) |
| `user.exportData` | Mutation | 导出全部用户数据 |
| `user.deleteAccount` | Mutation | 注销账户 (需密码确认) |

### 数字分身

| 端点 | 类型 | 说明 |
|------|------|------|
| `persona.list` | Query | 获取所有分身 (含统计) |
| `persona.get` | Query | 获取单个分身详情 |
| `persona.create` | Mutation | 创建分身 (名字/关系/时间) |
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
| `chat.getHistory` | Query | 获取历史消息 (默认 50 条) |
| `chat.search` | Query | 搜索聊天记录 |
| `chat.clear` | Mutation | 清空对话记录 |
| `chat.tts` | Mutation | 文本转语音 (返回 audioUrl) |
| `chat.export` | Mutation | 导出对话为 HTML (返回 html + fileName) |

### 文件 / 记忆 / 情感 / 日记 / 场景

| 端点 | 类型 | 说明 |
|------|------|------|
| `file.upload` / `file.list` | Mutation/Query | 上传素材 (Base64) / 列出素材 |
| `memory.list` / `memory.create` / `memory.delete` | Query/Mutation | 记忆节点管理 |
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
| `llmConfig.list` / `llmConfig.getDefault` / `llmConfig.listProviders` | Query | LLM 配置查询 |
| `llmConfig.upsert` / `llmConfig.setDefault` / `llmConfig.updateExtraConfig` | Mutation | LLM 配置管理 |
| `analytics.overview` | Query | 综合分析 (消息量/情感时线/热力图/时段分布) |
| `skillEngine.startPipeline` | Mutation | 启动多阶段蒸馏 pipeline |
| `skillEngine.getJobStatus` | Query | 查询 pipeline 进度 |

## 开发指南

### 常用命令

```bash
pnpm dev          # 启动开发服务器 (HMR)
pnpm build        # 构建生产版本
pnpm start        # 运行生产版本
pnpm check        # TypeScript 类型检查
pnpm test         # 运行测试
pnpm db:push      # 生成并执行数据库迁移
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
