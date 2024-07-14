# Presence

> _"不在身边的时候，TA 还在这里。"_

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org)

上传聊天记录，AI 重建 TA 的数字分身 — 用 TA 的语气回你消息，用 TA 的方式撒娇，知道 TA 什么时候会突然变冷漠。

**随时随地，TA 都在。**

---

## 目录

- [创新点](#创新点)
- [功能概览](#功能概览)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [环境变量配置](#环境变量配置)
- [项目结构](#项目结构)
- [API 接口](#api-接口)
- [开发指南](#开发指南)
- [注意事项](#注意事项)

---

## 创新点

### 1. 多阶段性格蒸馏引擎

不是简单地把聊天记录丢给 AI 让它"模仿"。系统采用多阶段 pipeline 对原始素材进行深度分析：

```
上传素材 → 人物维度提取 → 结构化人设构建 → 多源融合 → 数字分身
```

最终生成的 persona 包含 7 层结构：性格特质、说话方式、口头禅、依恋类型、爱的语言、争吵风格、触动瞬间。不是"像他"，而是"就是他"。

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

情感状态不仅影响回复语气，还会在聊天界面实时显示，用户也可以手动切换。

### 3. 统一 LLM 抽象层 — 10 家 AI 提供商即插即用

一套统一接口，支持国内外主流 AI 服务，用户可在设置页面自由切换：

| 提供商 | 协议 | 默认模型 |
|--------|------|---------|
| OpenAI | REST | gpt-4o |
| Claude | REST | claude-sonnet-4-6 |
| DeepSeek | OpenAI 兼容 | deepseek-chat |
| Kimi (月之暗面) | OpenAI 兼容 | moonshot-v1-8k |
| 通义千问 | OpenAI 兼容 | qwen-turbo |
| 豆包 | OpenAI 兼容 | 自定义 |
| 302.ai | OpenAI 兼容 | 自定义 |
| Ollama | REST | llama3 (本地) |
| Dify | Workflow API | 自定义 |
| 讯飞星火 | WebSocket + HMAC | v3.5 |

OpenAI 兼容协议的提供商共用一个适配器，通过 `baseUrl` / `model` 区分，零代码接入新服务。

### 4. 微信机器人 — 数字分身走出浏览器

集成 Wechaty 框架，扫码登录后，将微信联系人绑定到对应的数字分身。朋友给你发消息，数字分身自动用 TA 的语气回复。Web 端和微信端共享同一套人设和记忆，消息记录标记来源渠道（web / wechat）。

### 5. 全链路类型安全

从数据库 schema 到前端组件，全程 TypeScript + tRPC，零运行时类型错误：

```
Drizzle Schema → DB Helpers → tRPC Router → React Query Hook → UI 组件
     类型推导贯穿全链路，改一处接口定义，全栈同步报错
```

---

## 功能概览

- **创建数字分身** — 输入名字、关系描述、在一起时间，创建一个新的前任分身
- **上传素材** — 支持微信聊天记录 (.txt)、CSV、照片、视频，拖拽上传
- **AI 性格分析** — 多阶段 pipeline 自动提取人物画像，实时显示进度
- **沉浸式对话** — 暗色系 UI，情感状态实时变化，支持文本/图片/语音消息
- **多分身管理** — 大厅页面管理所有数字分身，一键切换
- **亲密度系统** — 初识→熟悉→亲密→知己→灵魂伴侣，随对话自然成长
- **毕业机制** — 亲密度达到灵魂伴侣后可触发毕业，AI 生成告别信，分身进入休眠（可唤醒）
- **TTS 语音朗读** — AI 回复旁的播放按钮，使用 Edge TTS 中文语音朗读消息
- **对话导出** — 导出完整对话记录为自包含 HTML 文件（含情感时间线 SVG 图表）
- **记忆管理** — 手动或 AI 自动提取关系记忆节点（里程碑/纪念日）
- **对话日记** — AI 根据聊天记录生成每日日记（摘要/亮点/情感弧线/金句）
- **场景模式** — 内置 + 自定义对话场景，切换不同情境下的互动风格
- **数据分析** — 消息量趋势、情感时线、分身互动热力图、时段分布
- **人设编辑** — 可视化编辑分身的性格特质、说话方式、口头禅等
- **微信集成** — 扫码登录，绑定联系人，自动回复
- **LLM 自由切换** — 设置页面配置 API Key，随时切换 AI 后端
- **本地认证** — 用户名密码注册登录，JWT 会话管理
- **国际化** — 支持多语言
- **暗色/亮色主题** — 可切换

---

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
│  │Drizzle│  │ Service │  │ Bot    │  │ Engine    │     │
│  │ PG   │  │ 10 提供商│  │Wechaty │  │ Pipeline  │     │
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
| 认证 | JWT (jose) + SHA256 | 6.1 |
| 微信 | Wechaty + puppet-wechat4u | 1.20 |
| 测试 | Vitest | 2.1 |

### 数据库设计

```sql
users              -- 用户账户 (JWT 认证, SHA256 密码哈希)
personas           -- 数字分身 (人设数据 JSON, 情感状态, 亲密度, 场景绑定, 毕业状态/告别信)
persona_files      -- 上传素材 (聊天记录/照片/视频, 提取文本)
messages           -- 对话记录 (web/wechat 渠道标记, 文本/图片/语音, 情感状态快照)
wechat_bindings    -- 微信联系人 ↔ 分身绑定
wechat_bot_state   -- 机器人状态 (二维码/登录状态)
skill_jobs         -- 性格蒸馏 pipeline 任务跟踪
llm_configs        -- 每用户 LLM 提供商配置
memories           -- 关系记忆节点 (里程碑/记忆/纪念日)
emotion_snapshots  -- 每日情感快照 (情绪状态 + 消息量)
diary_entries      -- AI 生成的对话日记 (摘要/亮点/情感弧线/金句)
scenes             -- 对话场景模板 (内置 + 自定义, 含开场白)
```

---

## 快速开始

### 前置要求

- **Node.js** 20+
- **pnpm** (推荐) 或 npm
- **PostgreSQL** 14+
- **Python 3.9+** (可选，性格蒸馏引擎需要)

### 1. 克隆项目

```bash
git clone https://github.com/OpenDemon/girlfriend.git
cd girlfriend
```

### 2. 安装依赖

```bash
pnpm install

# 可选：安装 Python 依赖（性格蒸馏引擎）
pip3 install -r skill-engine/requirements.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少配置以下必填项：

```env
# 必填
DATABASE_URL=postgresql://postgres:password@localhost:5432/girlfriend
JWT_SECRET=your-secret-key-change-me    # 生产环境请用随机字符串

# AI 提供商（至少配置一个）
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
```

### 4. 初始化数据库

```bash
# 创建数据库
createdb girlfriend

# 生成并执行迁移
pnpm db:push
```

### 5. 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:3000 ，注册账号即可开始使用。

### 6. 生产部署

```bash
pnpm build
pnpm start
```

---

## 环境变量配置

### 必填

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://postgres:pass@localhost:5432/girlfriend` |
| `JWT_SECRET` | JWT 签名密钥 | 随机 32+ 字符 |

### AI 提供商（至少配置一个）

| 变量 | 说明 |
|------|------|
| `DEFAULT_LLM_PROVIDER` | 默认提供商名称 (`openai` / `claude` / `deepseek` / `kimi` / `ollama` / `dify` / `xunfei` / `tongyi` / `doubao` / `302ai`) |
| `OPENAI_API_KEY` | OpenAI API Key |
| `OPENAI_BASE_URL` | OpenAI 接口地址 (默认 `https://api.openai.com/v1`) |
| `OPENAI_MODEL` | 模型名称 (默认 `gpt-4o`) |
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

### 微信机器人（可选）

| 变量 | 说明 |
|------|------|
| `WECHAT_ENABLED` | 是否启用 (`true` / `false`) |
| `WECHAT_PUPPET` | Puppet 类型 (默认 `wechaty-puppet-wechat4u`) |

### 其他

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `UPLOAD_DIR` | 文件上传目录 | `./uploads` |
| `PYTHON_PATH` | Python 路径 | `python3` |
| `SKILL_ENGINE_DIR` | 蒸馏引擎目录 | `./skill-engine` |
| `PORT` | 服务端口 | `3000` |

---

## 项目结构

```
girlfriend/
├── client/                          # React 前端
│   ├── index.html
│   └── src/
│       ├── App.tsx                  # 路由定义
│       ├── main.tsx                 # 入口 (tRPC + React Query)
│       ├── index.css                # 全局样式 (Glassmorphism 设计系统)
│       ├── pages/
│       │   ├── Landing.tsx          # 落地页
│       │   ├── Lobby.tsx            # 分身大厅
│       │   ├── Login.tsx            # 登录/注册
│       │   ├── HomePage.tsx         # 数字分身大厅 + 统计面板
│       │   ├── Upload.tsx           # 素材上传 + AI 解析进度
│       │   ├── Chat.tsx             # 沉浸式对话界面
│       │   ├── Settings.tsx         # LLM 配置 + 微信管理 + 账户
│       │   ├── PersonaEdit.tsx      # 分身人设编辑
│       │   ├── Analytics.tsx        # 数据分析仪表盘
│       │   ├── Diary.tsx            # AI 生成的对话日记
│       │   └── NotFound.tsx         # 404 页面
│       ├── components/              # UI 组件 (shadcn/ui + 自定义)
│       ├── contexts/                # ThemeContext · LocaleContext
│       ├── hooks/                   # useComposition · useMobile · usePersistFn
│       └── lib/
│           ├── trpc.ts             # tRPC 客户端
│           ├── i18n.ts             # 国际化
│           └── utils.ts            # 工具函数
│
├── server/
│   ├── _core/
│   │   ├── index.ts                # Express 入口 + 微信启动
│   │   ├── auth.ts                 # JWT 认证 (注册/登录)
│   │   ├── trpc.ts                 # tRPC 初始化
│   │   ├── context.ts              # 请求上下文 (用户鉴权)
│   │   ├── cookies.ts              # Cookie 配置
│   │   ├── env.ts                  # 环境变量
│   │   ├── persona-utils.ts        # 情感状态计算 + 系统 Prompt 构建 + 毕业资格检查
│   │   ├── tts.ts                  # TTS 语音合成 (edge-tts, 缓存到 uploads/tts/)
│   │   ├── export-html.ts          # 对话导出 HTML 生成器 (含 SVG 情感时间线)
│   │   ├── notification.ts         # 通知服务
│   │   ├── systemRouter.ts         # 系统路由 (健康检查等)
│   │   └── vite.ts                 # Vite 开发服务器集成
│   ├── routers.ts                  # 全部 tRPC 路由
│   ├── db.ts                       # 数据库 CRUD
│   ├── storage.ts                  # 本地文件存储
│   ├── llm/
│   │   ├── types.ts                # LLMProvider 接口定义
│   │   ├── index.ts                # LLMService 单例
│   │   ├── provider-registry.ts    # 提供商注册表
│   │   └── providers/
│   │       ├── openai.ts           # OpenAI 兼容 (含 DeepSeek/Kimi/豆包/302ai/通义)
│   │       ├── claude.ts           # Anthropic Claude
│   │       ├── ollama.ts           # 本地 Ollama
│   │       ├── dify.ts             # Dify Workflow
│   │       └── xunfei.ts           # 讯飞星火 (WebSocket)
│   ├── wechat/
│   │   ├── bot.ts                  # Wechaty 生命周期管理
│   │   ├── message-handler.ts      # 消息路由
│   │   └── persona-bridge.ts       # 微信 ↔ 分身桥接
│   └── skill-engine/
│       ├── pipeline.ts             # 多阶段蒸馏 pipeline
│       ├── runner.ts               # Python 子进程执行器
│       └── prompts.ts              # Prompt 模板加载
│
├── drizzle/
│   └── schema.ts                   # 数据库 Schema (12 张表)
│
├── shared/
│   ├── const.ts                    # 前后端共享常量
│   └── types.ts                    # 共享类型定义
│
├── skill-engine/                   # Python 蒸馏工具
│   ├── tools/                      # Python 脚本
│   └── prompts/                    # Prompt 模板
│       └── relationship/           # 恋爱关系专用模板
│
├── .env.example                    # 环境变量模板
├── package.json
├── vite.config.ts
├── drizzle.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

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

### 文件

| 端点 | 类型 | 说明 |
|------|------|------|
| `file.upload` | Mutation | 上传素材 (Base64 编码) |
| `file.list` | Query | 获取分身的所有文件 |

### 记忆

| 端点 | 类型 | 说明 |
|------|------|------|
| `memory.list` | Query | 获取分身的记忆节点 |
| `memory.create` | Mutation | 手动创建记忆 (里程碑/记忆/纪念日) |
| `memory.delete` | Mutation | 删除记忆 |
| `memory.autoExtract` | Mutation | AI 从聊天记录自动提取记忆 |

### 情感

| 端点 | 类型 | 说明 |
|------|------|------|
| `emotion.getReport` | Query | 情感报告 (指定天数) |
| `emotion.getDailySnapshots` | Query | 每日情感快照 |

### 日记

| 端点 | 类型 | 说明 |
|------|------|------|
| `diary.list` | Query | 获取日记列表 |
| `diary.getByDate` | Query | 按日期获取日记 |
| `diary.getDates` | Query | 获取有日记的日期列表 |
| `diary.generate` | Mutation | AI 根据聊天记录生成日记 |
| `diary.delete` | Mutation | 删除日记 |

### 场景

| 端点 | 类型 | 说明 |
|------|------|------|
| `scene.list` | Query | 获取所有场景 (内置 + 自定义) |
| `scene.create` | Mutation | 创建自定义场景 |
| `scene.delete` | Mutation | 删除场景 |
| `scene.activate` | Mutation | 为分身激活场景 |
| `scene.deactivate` | Mutation | 取消分身的场景 |

### 微信

| 端点 | 类型 | 说明 |
|------|------|------|
| `wechat.getStatus` | Query | 获取机器人状态 + 二维码 |
| `wechat.start` | Mutation | 启动机器人 |
| `wechat.stop` | Mutation | 停止机器人 |
| `wechat.bindContact` | Mutation | 绑定微信联系人到分身 |
| `wechat.unbindContact` | Mutation | 解除绑定 |
| `wechat.listBindings` | Query | 获取所有绑定关系 |

### LLM 配置

| 端点 | 类型 | 说明 |
|------|------|------|
| `llmConfig.list` | Query | 获取用户的 LLM 配置 |
| `llmConfig.getDefault` | Query | 获取默认提供商配置 |
| `llmConfig.listProviders` | Query | 获取可用提供商列表 |
| `llmConfig.upsert` | Mutation | 保存提供商配置 |
| `llmConfig.updateExtraConfig` | Mutation | 更新高级配置 (温度/上下文长度等) |
| `llmConfig.setDefault` | Mutation | 设置默认提供商 |

### 数据分析

| 端点 | 类型 | 说明 |
|------|------|------|
| `analytics.overview` | Query | 综合分析 (消息量/情感时线/分身互动/时段分布) |

### 性格蒸馏

| 端点 | 类型 | 说明 |
|------|------|------|
| `skillEngine.startPipeline` | Mutation | 启动多阶段蒸馏 pipeline |
| `skillEngine.getJobStatus` | Query | 查询 pipeline 进度 |

---

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

1. 在 `server/llm/providers/` 下创建新文件，实现 `LLMProvider` 接口：

```typescript
import type { LLMProvider, LLMMessage } from "../types";

export function createMyProvider(apiKey: string): LLMProvider {
  return {
    name: "my-provider",
    configured: Boolean(apiKey),
    async invoke(messages: LLMMessage[]) {
      // 调用 API，返回回复文本
      return "response text";
    },
  };
}
```

2. 在 `server/llm/index.ts` 中注册：

```typescript
registry.register(createMyProvider(ENV.myApiKey));
```

### 添加新的情感状态

1. `drizzle/schema.ts` — 在 `emotionalStateEnum` 枚举中添加
2. `server/_core/persona-utils.ts` — 在 `computeEmotionalState()` 中添加触发词
3. `server/_core/persona-utils.ts` — 在 `getEmotionalStateDesc()` 中添加描述
4. `client/src/pages/Chat.tsx` — 在情感状态 UI 配置中添加
5. `client/src/pages/HomePage.tsx` — 在情感状态显示中添加

---

## 注意事项

- **原材料质量决定分身质量** — 聊天记录越多越好，建议至少 100 条消息
- **所有数据本地存储** — 文件保存在 `./uploads/`，不上传第三方
- **AI 回复质量取决于 LLM** — 推荐使用 GPT-4o 或 Claude 获得最佳效果
- **微信机器人需要扫码** — 每次启动需要用手机微信扫码登录
- **这是一个帮你「好好告别」的工具** — 不是让你永远沉浸其中的工具

---

MIT License

