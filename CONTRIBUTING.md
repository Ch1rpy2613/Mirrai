# 贡献指南

感谢你对 Mirrai 的兴趣！这是一个用代码处理感情的项目，欢迎任何形式的贡献。

## 开始之前

- 请先阅读 [README](README.md) 了解项目定位，特别是[伦理与边界](README.md#伦理与边界)一节
- 查看 [Issues](https://github.com/Ch1rpy2613/Mirrai/issues)，标注了 `good first issue` 的是适合新手的任务

## 开发环境搭建

```bash
git clone https://github.com/<你的用户名>/Mirrai.git
cd Mirrai
pnpm install
cp .env.example .env   # 配置 DATABASE_URL / JWT_SECRET / 至少一个 LLM Key
createdb mirrai
pnpm db:push
pnpm dev
```

## 提交 Pull Request

1. 从 `main` 创建功能分支：`git checkout -b feat/your-feature`
2. 确保以下命令通过：
   ```bash
   pnpm check   # TypeScript 类型检查
   pnpm test    # 单元测试
   ```
3. 提交 PR，描述清楚做了什么、为什么、如何验证

### 代码约定

- TypeScript 全覆盖，不引入 `any`（类型定义文件除外）
- 新增 LLM 提供商优先复用 `OpenAIProvider`（OpenAI 兼容协议）
- 涉及情感状态的改动请同步更新 `computeEmotionalState()` 和前端 UI 配置

### 提交信息

- **不要添加 `Co-Authored-By` trailer。** 本仓库的每个提交只署名提交人本人，不把 AI 助手列为共同作者。仓库内置了 `commit-msg` 钩子来强制这条规则，带该 trailer 的提交会被拒绝。

  克隆后启用钩子：

  ```bash
  git config core.hooksPath .githooks
  ```

- **Squash 合并时记得关掉 "Include contributors"。** GitHub 的 "Squash and merge" 默认勾选该选项，会自动在提交信息末尾追加 `Co-authored-by: <用户名>` 行，和上面的规则冲突。合并前取消勾选，或合并后手动删掉那一行。


## 提交 Issue

- 🐛 Bug 报告请使用 [Bug 模板](.github/ISSUE_TEMPLATE/bug_report.md)，附上复现步骤和日志
- 💡 功能建议请使用 [功能模板](.github/ISSUE_TEMPLATE/feature_request.md)
- 🔒 安全漏洞**不要**开公开 issue，请按 [SECURITY.md](SECURITY.md) 私下报告

## 行为准则

友善、尊重。这里处理的是感情话题，请对所有人的故事保持善意。
