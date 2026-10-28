# Mirrai

> *"When they're not beside you, they're still here."*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1rpy2613/Mirrai/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/Ch1rpy2613/Mirrai?style=social)](https://github.com/Ch1rpy2613/Mirrai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-24+-339933.svg)](https://nodejs.org)

[简体中文](README.md) | **English**

![Mirrai landing page](docs/images/landing-hero.png)

Mirrai is an open-source, self-hosted AI companion that rebuilds a person's digital persona from real chat history — their tone, their habits, even the moments they go cold. Every byte stays on your machine, 13 LLM providers plug in out of the box, and it ships with something no other companion product has: a **graduation mechanism** — designed not to keep you, but to help you say goodbye.

> ⚠️ The app UI is currently Chinese-first; full English localization is on the [roadmap](#roadmap). English-speaking users can still set it up and the landing page is bilingual.

## Why Mirrai is different

| | |
|---|---|
| 🧬 **Multi-stage persona distillation** | A real pipeline (intake → persona analysis → structured build → merge) produces a 7-layer persona: personality, speaking style, catchphrases, attachment style, love language, conflict style, touching moments. Not a "paste logs into a prompt" wrapper. |
| 🎭 **Dynamic emotion state machine** | 6 emotional states (warm / playful / nostalgic / melancholic / happy / distant) drift with the conversation and change reply tone in real time. The state is inferred by the LLM reading the exchange, with a keyword heuristic as fallback. |
| 🎓 **Graduation mechanism** | Intimacy grows through conversation. When the system detects you're at peace, it offers "graduation": an AI-written farewell letter, then the persona sleeps. Success is measured by graduation rate, not retention. The mechanism is only ever a suggestion — you choose whether the app may raise it (suggest / manual only / off), globally or per persona. An offer is made once and then goes quiet for a while; a refusal is not a closed door. After graduation the persona stops receiving reminders, stops being recommended, and stops answering — but the letter is kept, and waking the persona does not destroy it. There is a third state too: **take a break**, for when you want neither a goodbye nor a conversation. |
| 🧠 **Memory that grows on its own** | After enough has been said, the persona extracts what was worth keeping on its own — no button, and pressing a button twice no longer stores everything twice. Every reply shows which memories it recalled, so a detail from three months ago is visibly *recalled* rather than invented. Memories about you and memories about them are kept apart. |
| ✉️ **Letters, and the distance** | Some things cannot be said into a chat box. Write one and keep it forever, or hand it over — it is answered about a day later, because a person does not reply in three seconds. There is also a list of things to say "when they come back", and a **"we can't reach each other right now"** state that is deliberately *not* a breakup: the reminders stop and the register turns to a letter's. |
| 💬 **They can speak first** | Off by default. The frequency is yours to set, and zero is a real value: an app that speaks first is something you buy, not something you are given. When it is on, it goes out over the channel you have already bound — WeChat, Feishu — and it respects your quiet hours. |
| 🔌 **13 LLM providers** | OpenAI, Claude, DeepSeek, Kimi, Qwen, Doubao, 302.ai, Atlas Cloud, Cheaper Inference, Opper, Dify, Xunfei — and Ollama for fully local inference. |
| 💬 **WeChat via official ClawBot** | Connect to WeChat through the official "ClawBot" plugin (Tencent iLink protocol) — scan a QR code, authorize, and chat with your persona in WeChat. Shares persona and memory with the web app. **No ban risk**: this is a first-party WeChat channel, not a third-party protocol. | |
| 🔒 **Local-first** | Uploads stay in `./uploads/`. With Ollama, nothing ever leaves your machine. |

## Comparison

| Capability | Mirrai | Character.AI / Linky | SillyTavern |
|---|---|---|---|
| Persona built from real chat logs | ✅ multi-stage distillation | ❌ manual | ⚠️ manual prompting |
| Emotion states drift with conversation | ✅ 6-state machine | ⚠️ limited | ⚠️ manual |
| Fully local data | ✅ | ❌ cloud | ✅ |
| Swappable LLM backends | ✅ 13 providers / local | ❌ locked | ✅ |
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

Requirements: Node.js 24+, pnpm, PostgreSQL 14+, Python 3.9+ (optional, for the distillation engine)

```bash
git clone https://github.com/Ch1rpy2613/Mirrai.git
cd Mirrai
pnpm install
pip3 install -r skill-engine/requirements.txt   # optional
cp .env.example .env                            # configure DATABASE_URL, JWT_SECRET, an LLM key
createdb mirrai
pnpm db:push                                    # a fresh install; use pnpm db:migrate to upgrade
pnpm dev
```

Redis is optional: without it the app still runs and the rate limiter counts in process.
To have the limits mean the same thing across instances, `pnpm setup:redis` installs one
and the app takes care of the rest.

### macOS one-click

Download `Mirrai-macOS-arm64.dmg` from [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) — Node.js and PostgreSQL bundled, zero dependencies (Apple Silicon, macOS 13+).

### Windows one-click

Download `Mirrai-Setup-x64.exe` from [Releases](https://github.com/Ch1rpy2613/Mirrai/releases) and run the installer — Node.js and PostgreSQL are bundled, so there is no database to install, no administrator rights needed, and nothing is written to the registry (Windows x64).

After the install, start Mirrai from the Start menu (or the desktop). A window with a **progress bar** shows what is happening — "initialising the database", "synchronising the schema", "starting the server", "ready" — so the first launch, which does take a minute or two, never looks like it has hung. Data lives in `%APPDATA%\Mirrai`; uninstalling goes through "Apps & features".

> PostgreSQL refuses to run under an Administrator account on Windows. If you started it from an elevated prompt, run it as a normal user instead.

To build it yourself: `powershell -ExecutionPolicy Bypass -File scripts\build-windows-app.ps1` (Inno Setup is needed for the installer) — see [docs/windows-build-guide.md](docs/windows-build-guide.md).

### WeChat (optional)

Mirrai connects to WeChat through the official **「微信ClawBot」** plugin (Tencent iLink protocol) — no third-party protocol, so no account-ban risk.

1. Update WeChat to **8.0.70+** and open 我 → 设置 → 插件. You need the 「微信ClawBot」 entry to be visible (the feature is rolling out gradually — iOS first).

> ℹ️ The WeChat authorization QR code expires quickly (measured at roughly 90 seconds). Mirrai automatically issues a fresh one whenever it expires, so the code on screen stays valid for as long as the connection window is open — no need to restart.
2. In Mirrai, go to 设置 → 微信 → 连接微信, then scan the QR code with WeChat and confirm.
3. Pick a default persona in 设置 → 微信 → 默认分身.

The channel is 1:1 private chat (an official limit: it cannot be added by other users or to groups), so the counterpart is you. You can switch personas and graduate from inside WeChat:

| Command | Effect |
|---|---|
| `/使用 <persona name>` | Switch the active persona |
| `/分身列表` | List available personas |
| `/当前分身` | Show the active persona |
| `/毕业` | Generate the farewell letter and complete graduation |

Each command also has an English spelling — `/use`, `/personas`, `/current`, `/graduate`
and `/help` — and the reply comes back in the language of the command you typed.

Commands never consume a model call. A switch applies to the current session only; the default persona is restored after a restart.

## Ethics & boundaries

- Only upload chat logs **you have the right to use**; model real people with their consent.
- Mirrai is **not a replacement for real relationships** — it's a space to finish unfinished conversations. That's why graduation exists.
- **AI transparency**: by default, a persona admits it's an AI when asked in earnest (set `PERSONA_AI_TRANSPARENCY=false` for full immersion mode).
- **Not a substitute for professional help**. If you're struggling, please talk to a professional.

### Rate limiting and multiple instances: Redis works out of the box

Request rate limiting (`server/_core/rate-limit.ts`) uses in-memory token buckets by default.
That is enough for a single self-hosted instance, but with **multiple instances each process
keeps its own counters** — so the effective limit grows with the number of instances. The
scheduler has the same problem: two copies of Mirrai would deliver the same anniversary
reminder twice.

Both are now Redis's problem, and **you do not have to configure anything, or download
anything either**. The app looks for Redis in this order:

1. `REDIS_URL`, if you set it
2. a Redis already listening on the default port
3. **the one that came with the app** (see the table below)
4. **one it starts itself** — it starts a server on a port of its own choosing, and writes
   the port down under `MIRRAI_DATA_ROOT`, so the other copies of Mirrai on this machine
   share it (run two instances and the budget is still one)

**Redis ships inside the installer.**

| How you install it | Where Redis comes from |
|---|---|
| The macOS `.dmg` | Bundled in `Mirrai.app` (`Contents/Resources/redis/`); the app starts it and stops it with itself |
| The Windows `.zip` / `.exe` | Bundled in the `redis\` folder next to the app; same arrangement |
| Docker | The image installs `redis-server`; `docker compose` additionally runs a `redis` container |
| From source | `pnpm setup:redis` — one command, and it works out whether it is brew, apt, apk, dnf or yum |

A machine without `redis-server` still starts: the limiter falls back to counting in
process, and the log says so. Redis makes the limits mean the same thing in every process;
it is not what makes the app run.

To turn the shared store off, put `MIRRAI_REDIS=off` in `.env`.

### Database migrations: which command to use

- **A fresh installation**: `pnpm db:push`. It pushes the current schema straight to the
  database, which is the fastest way in.
- **An existing installation you are upgrading**: `pnpm db:migrate`. It runs the migration
  files in `drizzle/` in order.

`db:migrate` only works on an installation that has already been `db:push`ed: the tool
skips the `0000`/`0001` whole-database dumps, because they assume the base tables are
already there. A fresh installation has no base tables, so the migrations would give you
an empty database — use `db:push` there.

## Documentation

- [docs/roadmap-v2.md](docs/roadmap-v2.md) — the acceptance checklist for the second stage (making the *user* and the *relationship* first-class citizens)
- [docs/open-items.md](docs/open-items.md) — what is still unfinished, why, and how much work it would be
- [docs/product-concept.md](docs/product-concept.md) — the product concept and its principles
- [docs/creation-story.md](docs/creation-story.md) — the story behind it (in Chinese)

## Roadmap

- [x] Multi-stage persona distillation pipeline
- [x] 6-state emotion engine + intimacy system
- [x] Graduation mechanism (farewell letter + dormancy/awakening)
- [x] 13 LLM providers
- [x] WeChat ClawBot channel integration
- [x] Diary / memory nodes / analytics / TTS
- [ ] SillyTavern character card (PNG v2) import/export
- [ ] Full app i18n + English emotion triggers
- [ ] Plugin system & persona template gallery
- [ ] Group chat mode / guided questionnaires
- [ ] Docs site

## The story

Mirrai was written by an NLP student who was terrified of losing someone — so terrified he started writing her into code. The full creation story (in Chinese) is here: [docs/creation-story.md](docs/creation-story.md).

## Tech stack

React 19 + TypeScript + Vite + Tailwind 4 + Radix UI on the client; Express + tRPC 11 (end-to-end type safety) + PostgreSQL/Drizzle on the server; the official WeChat ClawBot channel (Tencent iLink protocol); a Python skill-engine for distillation; Vitest for tests. Full architecture details in the [Chinese README](README.md#技术架构).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ch1rpy2613
