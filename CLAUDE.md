# Presence — AI 数字分身平台

上传聊天记录，AI 重建 TA 的数字分身。用 TA 的语气回消息，用 TA 的方式撒娇。

## 技术栈

- **前端**: React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 + Radix UI
- **路由**: Wouter (轻量 React 路由)
- **API**: tRPC 11 (端到端类型安全) + SuperJSON + React Query
- **后端**: Express 4 + Node.js 20+
- **数据库**: PostgreSQL + Drizzle ORM
- **认证**: JWT (jose) + SHA256 密码哈希
- **微信**: Wechaty + puppet-wechat4u
- **测试**: Vitest

## 常用命令

```bash
pnpm dev          # 启动开发服务器 (tsx watch + Vite HMR)
pnpm build        # 构建 (Vite 前端 + esbuild 后端)
pnpm start        # 运行生产版本
pnpm check        # TypeScript 类型检查
pnpm test         # Vitest 测试
pnpm db:push      # drizzle-kit generate + migrate (已有迁移历史)
```

## 项目结构

```
client/src/pages/   — 前端页面 (Landing, Lobby, HomePage, Login, Chat, Upload, Settings, PersonaEdit, Analytics, Diary, NotFound)
client/src/components/ — UI 组件 (shadcn/ui + GraduationModal 等自定义组件)
server/_core/       — 服务端核心 (Express 入口, auth, trpc, env, persona-utils, tts, export-html)
server/routers.ts   — 全部 tRPC 路由定义
server/db.ts        — 数据库 CRUD 操作
server/llm/         — LLM 抽象层 (10 提供商, 5 个 provider 文件)
server/wechat/      — 微信机器人
server/skill-engine/— 性格蒸馏 pipeline
drizzle/schema.ts   — 数据库 Schema (12 张表)
shared/             — 前后端共享常量和类型
```

## 环境变量

必填: `DATABASE_URL` (PostgreSQL), `JWT_SECRET`
AI: 至少配置一个 LLM 提供商 (OPENAI_API_KEY / CLAUDE_API_KEY / DEEPSEEK_API_KEY / ...)
可选: `WECHAT_ENABLED`, `UPLOAD_DIR`, `PYTHON_PATH`, `PORT`

详见 `.env.example`

## 数据库

PostgreSQL, 通过 Drizzle ORM 管理。Schema 在 `drizzle/schema.ts`。
12 张表: users, personas, persona_files, messages, wechat_bindings, wechat_bot_state, skill_jobs, llm_configs, memories, emotion_snapshots, diary_entries, scenes

personas 表含毕业机制字段: graduationStatus (enum: suggested/graduated/declined), graduatedAt, farewellLetter

注意: 数据库最初用 `drizzle-kit push` 创建，后已切换到 `drizzle-kit generate && migrate` 流程（已有迁移历史）。Schema 变更用 `pnpm db:push`。

## tRPC 路由

auth · user · persona · file · chat · memory · emotion · diary · scene · analytics · wechat · skillEngine · llmConfig · system

路由定义在 `server/routers.ts`，情感计算和 Prompt 构建在 `server/_core/persona-utils.ts`。

新增端点（2026-04-30）:
- `chat.tts` — 文本转语音 (edge-tts, 缓存到 uploads/tts/)
- `chat.export` — 导出对话为自包含 HTML (含情感时间线 SVG)
- `persona.checkGraduation` / `persona.graduate` / `persona.declineGraduation` / `persona.awaken` — 毕业机制
- `chat.send` 返回值新增 `graduationSuggested: boolean`

## 约定

- 路径别名: `@/` → `client/src/`, `@shared/` → `shared/`
- UI 组件: shadcn/ui (Radix + Tailwind), 放在 `client/src/components/ui/`
- 数据库操作: 全部通过 `server/db.ts` 的函数，不直接在路由里写 SQL
- LLM 调用: 通过 `llmService.invoke()`, 不直接调用提供商 API
- 新增 LLM 提供商: 实现 `LLMProvider` 接口 → 注册到 `provider-registry.ts`
