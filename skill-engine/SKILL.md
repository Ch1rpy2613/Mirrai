---
name: dot-skill
description: Mirrai 数字分身技能引擎——把聊天素材与公开研究蒸馏成可安装的人格技能包（同事 / 亲密关系 / 公众人物），并把技能包安装到 Claude Code、OpenClaw、Codex、Hermes。
user-invocable: true
---

# Dot Skill Engine

`skill-engine/` 是 Mirrai 的技能引擎本体：它是一套「元技能」，负责把素材蒸馏成一个人格技能包，并把技能包安装到各个 Agent 宿主。

## 组成

- `prompts/` —— 各角色族（同事 / 亲密关系 / 公众人物）的提示词。
- `prompts/registry.json` —— 提示词的唯一事实来源：family（可选 profile）+ stage → 文件路径。
- `references/` —— 深度研究档位的方法论文档。
- `tools/` —— Python 工具链：素材采集、技能包写入、各宿主安装器、质量门。

## 蒸馏流程

1. `intake` 收集素材（聊天记录、上传文件、公开资料）。
2. `analyzing_persona` 抽取行为模式，`building` 写出结构化画像，`merging` 归一到统一契约。
3. 公众人物的 `budget-unfriendly` 档位额外走研究四段：`research` → `audit` → `synthesis` → `validation`，并由 `tools/research/quality_check.py` 做代码级质量门。

## 技能包写入

`tools/skill_writer.py` 负责生成 `SKILL.md`、`work.md`、`persona.md` 与 `manifest.json`；`--work` / `--persona` 传入内容文件路径，`--slug` / `--base-dir` 决定输出位置。

## 安装到宿主

- Claude Code —— `tools/install_claude_generated_skill.py`
- OpenClaw —— `tools/install_openclaw_generated_skill.py`
- Codex —— `tools/install_codex_generated_skill.py`
- Hermes —— `tools/install_hermes_skill.py`

## 使用约束

- 生成的技能正文不得包含代码块、`>` 引用块与 `HH:MM:SS` 时间戳，否则版权检查判定失败。
- 研究笔记必须使用 `merge_research.py` 认识的小节标题，并按 `Source weight: N`、`一手`、`Question: ` 的写法记录证据。
