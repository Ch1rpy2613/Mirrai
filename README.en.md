# Mirrai

> *"When they're not beside you, they're still here."*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/Ch1rpy2613/Mirrai?style=social)](https://github.com/Ch1rpy2613/Mirrai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg)](https://nodejs.org)

[简体中文](README.md) | **English**

![Mirrai landing page](docs/images/landing-hero.png)

Mirrai is an open-source, self-hosted AI companion that rebuilds a person's digital persona from real chat history — their tone, their habits, even the moments they go cold. Every byte stays on your machine, 12 LLM providers plug in out of the box, and it ships with something no other companion product has: a **graduation mechanism** — designed not to keep you, but to help you say goodbye.

> ⚠️ The app UI is currently Chinese-first; full English localization is on the [roadmap](#roadmap). English-speaking users can still set it up and the landing page is bilingual.

## Why Mirrai is different

| | |
|---|---|
| 🧬 **Multi-stage persona distillation** | A real pipeline (intake → persona analysis → structured build → merge) produces a 7-layer persona: personality, speaking style, catchphrases, attachment style, love language, conflict style, touching moments. Not a "paste logs into a prompt" wrapper. |
| 🎭 **Dynamic emotion state machine** | 6 emotional states (warm / playful / nostalgic / melancholic / happy / distant) drift with the conversation and change reply tone in real time. The state is inferred by the LLM reading the exchange, with a keyword heuristic as fallback. |
| 🎓 **Graduation mechanism** | Intimacy grows through conversation. When the system detects you're at peace, it offers "graduation": an AI-written farewell letter, then the persona sleeps. Success is measured by graduation rate, not retention. |
| 🔌 **12 LLM providers** | OpenAI, Claude, DeepSeek, Kimi, Qwen, Doubao, 302.ai, Atlas Cloud, Cheaper Inference, Dify, Xunfei — and Ollama for fully local inference. |
| 💬 **WeChat bot** | Bind a WeChat contact to a persona via Wechaty; it replies in their voice. Shares persona and memory with the web app. (Unofficial protocol — ban risk, use a spare account.) |
| 🔒 **Local-first** | Uploads stay in `./uploads/`. With Ollama, nothing ever leaves your machine. |

## Comparison

| Capability | Mirrai | Character.AI / Linky | SillyTavern |
|---|---|---|---|
| Persona built from real chat logs | ✅ multi-stage distillation | ❌ manual | ⚠️ manual prompting |
| Emotion states drift with conversation | ✅ 6-state machine | ⚠️ limited | ⚠️ manual |
| Fully local data | ✅ | ❌ cloud | ✅ |
| Swappable LLM backends | ✅ 12 providers / local | ❌ locked | ✅ |
| Designed to help you let go | ✅ graduation | ❌ | ❌ |
| Open source, self-hosted | ✅ MIT | ❌ | ✅ |

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/Ch1rpy2613/Mirrai.git
cd Mirrai
cp .env.example .env   # set JWT_SECRET and at least one LLM API key
docker compose up -d
```

Then open http://localhost:3000 — PostgreSQL is included.

### From source

Requirements: Node.js 20+, pnpm, PostgreSQL 14+, Python 3.9+ (optional, for the distillation engine)

```bash
git clone https://github.com/Ch1rpy2613/Mirrai.git
cd Mirrai
pnpm install
pip3 install -r skill-engine/requirements.txt   # optional
cp .env.example .env                            # configure DATABASE_URL, JWT_SECRET, an LLM key
createdb mirrai
pnpm db:push
pnpm dev
```

### macOS one-click

Download `Mirrai-macOS-arm64.dmg` from [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) — Node.js and PostgreSQL bundled, zero dependencies (Apple Silicon, macOS 13+).

## Ethics & boundaries

- Only upload chat logs **you have the right to use**; model real people with their consent.
- Mirrai is **not a replacement for real relationships** — it's a space to finish unfinished conversations. That's why graduation exists.
- **AI transparency**: by default, a persona admits it's an AI when asked in earnest (set `PERSONA_AI_TRANSPARENCY=false` for full immersion mode).
- **Not a substitute for professional help**. If you're struggling, please talk to a professional.

## Roadmap

- [x] Multi-stage persona distillation pipeline
- [x] 6-state emotion engine + intimacy system
- [x] Graduation mechanism (farewell letter + dormancy/awakening)
- [x] 12 LLM providers
- [x] WeChat bot integration
- [x] Diary / memory nodes / analytics / TTS
- [ ] SillyTavern character card (PNG v2) import/export
- [ ] Full app i18n + English emotion triggers
- [ ] Plugin system & persona template gallery
- [ ] Group chat mode / guided questionnaires
- [ ] Docs site

## The story

Mirrai was written by an NLP student who was terrified of losing someone — so terrified he started writing her into code. The full creation story (in Chinese) is here: [docs/creation-story.md](docs/creation-story.md).

## Tech stack

React 19 + TypeScript + Vite + Tailwind 4 + Radix UI on the client; Express + tRPC 11 (end-to-end type safety) + PostgreSQL/Drizzle on the server; Wechaty for WeChat; a Python skill-engine for distillation; Vitest for tests. Full architecture details in the [Chinese README](README.md#技术架构).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ch1rpy2613
