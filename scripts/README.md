# Live WeChat channel verification scripts

These scripts verify Mirrai's WeChat channel against the **real** Tencent iLink
backend (the protocol behind the official WeChat「ClawBot」plugin). They exist
because the channel's failure modes are invisible to unit tests: a QR that
expires in 90 seconds, a `context_token` that must be echoed back, a uint64
`message_id` that `JSON.parse` silently truncates.

Every script imports Mirrai's **shipped** modules (compiled with esbuild into
the scratch work directory) rather than a copy, so a passing run means the
shipping code path works.

## Setup

```bash
node scripts/live-build.mjs          # compile the modules the scripts import
```

The compiled output lands in `.live-test/` (gitignored).

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `MIRRAI_ROOT` | Repository root | parent of `scripts/` |
| `MIRRAI_LIVE_WORK_DIR` | Scratch dir for compiled modules | `<root>/.live-test` |
| `MIRRAI_LIVE_STATE_FILE` | QR cursor / bot token state | `<root>/.live-wechat-state.json` |
| `MIRRAI_LIVE_QR_PNG` | Rendered QR image | `<root>/live-wechat-qr.png` |
| `MIRRAI_LIVE_QR_URL_FILE` | Current QR URL | `<root>/live-wechat-qr-url.txt` |
| `MIRRAI_LIVE_QR_PORT` | QR page port | `8898` |
| `MIRRAI_LIVE_LLM_PROXY_PORT` | LLM proxy port | `8899` |
| `MIRRAI_LIVE_STUB_PORT` | Stub iLink port | `9911` |
| `MIRRAI_LIVE_LLM_API_KEY` | Token for the LLM gateway | — |
| `MIRRAI_LIVE_LLM_BASE_URL` | LLM gateway base URL (ends in `/llm`) | — |
| `MIRRAI_LIVE_LLM_MODEL` | Model to request | — |
| `DATABASE_URL` | Test database | — |
| `WECHAT_ILINK_BASE_URL` | iLink API base | `https://ilinkai.weixin.qq.com` |
| `WECHAT_ILINK_APP_ID` | iLink app id | `bot` |
| `WECHAT_BOT_TYPE` | QR `bot_type` | `3` |
| `APP_VERSION` | Reported as `channel_version` | `1.0.0` |

## Scripts

### Login and QR

| Script | Purpose |
|---|---|
| `live-qr-page.mjs` | Serves a local page that mints a **fresh** QR on every view and re-mints every 20s. The iLink QR lives ~90s, so a static image goes stale; this one does not. Also drives the status poll and stores the bot token on confirmation. |
| `live-qr-page.mjs` → open `http://127.0.0.1:8898` | Scan with WeChat, confirm on the phone. |
| `live-wechat-watch.mjs` | Headless variant: keeps a fresh QR on disk and polls for confirmation. |
| `live-wechat-test.mjs` | Low-level QR issue / poll / update / send primitives. |
| `live-seed-token.mjs` | Writes a confirmed bot token into the database (encrypted, as the server does). |
| `live-real-poll.mjs` | One real `getUpdates` long-poll against the live backend. |
| `live-raw-poll.mjs` | Same, but prints the raw wire response — useful for protocol changes. |

### Channel behaviour

| Script | Purpose |
|---|---|
| `live-inbound-chain.mjs` | Full inbound path with a **stub** iLink backend: `getUpdates` → parse → commands/persona bridge → LLM → `sendMessage`. Only the network peer is faked. |
| `live-e2e.mjs` | Drives the real HTTP API (register, login, create persona, start WeChat login, send a chat). |
| `live-wechat-paths.mjs` | Exercises the WeChat-specific code paths: default-persona binding, slash commands, graduation (including the delivery-failure fallback). |
| `live-concurrency-test.mjs` | Checks whether two concurrent `getUpdates` polls on one token are safe. |

### Diagnostics

| Script | Purpose |
|---|---|
| `live-llm-check.mjs` | Verifies Mirrai's `ClaudeProvider` against a configured gateway. |
| `live-llm-proxy.mjs` | Adds the `Authorization: Bearer` header some Anthropic-protocol gateways require, so the shipped provider can be exercised unmodified. |
| `live-abort-test.mjs` | Compares `getUpdates` with and without an abort signal / short timeout. |
| `live-compare.mjs` | Builds the API options the way the server does and compares. |
| `live-repro.mjs` | Reproduces the server's exact `getUpdates` call shape. |
| `run-live-test.mjs` | Thin wrapper around `live-wechat-test.mjs`. |

## Typical flow

```bash
# 1. build the modules
node scripts/live-build.mjs

# 2. serve a fresh QR and scan it
node scripts/live-qr-page.mjs
#    open http://127.0.0.1:8898, scan with WeChat, confirm

# 3. verify the channel end to end
export DATABASE_URL=postgresql://.../mirrai_test
node scripts/live-inbound-chain.mjs
```

## Notes

- The scripts write a bot token to the state file. Treat that file as a
  credential — it grants access to the bound WeChat account.
- `live-qr-page.mjs` is the practical way to get a scannable code: the
  backend expires codes in about 90 seconds, which is shorter than a chat
  round-trip.
