# Mirrai — fourth-pass audit: the whole journey

> **Status: every finding below has been fixed.** They were fixed one commit
> each in Round 1, batch 11 — the changes are listed in `docs/AGENT-MISSION.md`
> under "第十一批修复". This file is kept as the record of what the audit
> found, so that a later reader can check the fixes against the findings.

Angle: walk the app the way a person walks it and find the seams where two
individually-correct pieces do not fit together. Every finding below was read
out of the code at the stated lines; where something *does* handle the case, the
finding says so and is not reported.

Severity: **HIGH** = the journey breaks or the promise is broken ·
**MEDIUM** = a step is confusing or recovers badly · **LOW** = polish.

---

## A. The first ten minutes

### A-1 · HIGH · A voice note is never heard — the "transcription" is the model guessing

**Step.** The user taps the microphone in the chat, speaks, and the persona
answers.

**Files.** `server/routers.ts:1636-1672` · `shared/copy/prompts.ts:249-252` ·
`server/llm/types.ts:1-3` · `client/src/pages/Chat.tsx:960-983`

**What happens.** `chat.sendVoice` stores the audio on disk and then asks the
model to transcribe it with a request that contains **only a text prompt plus
the recording's duration**:

```ts
const transcriptionRequest = [{ role: "user", content: copy(locale, "prompts.voiceTranscription", { duration: input.duration }) }];
const transcription = (voiceProvider ? await voiceProvider.invoke(transcriptionRequest) : …)
```

The prompt itself says *"如果无法转写，请根据上下文猜测可能的内容"* ("if it cannot
be transcribed, guess what it might have said from the context"). No audio is
attached, and it could not be: `LLMContentPart` is only `text | image_url`, so
there is no audio content type anywhere in the LLM layer. The recorded audio
never leaves the uploads directory and never reaches a model. The only input the
model has is *how many seconds* the user spoke for.

**Why it matters to a person.** The invented text is not hidden — the client
rewrites the user's own bubble with it
(`client/src/pages/Chat.tsx:981`: `content: result.transcription || …`), so the
person sees their voice note rendered as words they never said, and the persona
replies warmly to those invented words. `transcriptionFailed` is only set when
the model returns an *empty* string, and a model that has been told to guess
never returns empty.

It is also **persisted**: the fabricated text is what goes into
`runConversation({ message: transcription })` (`server/routers.ts:1685`), so it
is stored as the user's own message, it is what the persona's context contains
from then on, and it is what the memory extraction later mines into facts
about the user. The whole product is about fidelity to a real person; the
listening half of it is fiction that then becomes the record.

### A-2 · MEDIUM · The analysis-progress poll only starts if the very first
status read already sees "analyzing"

**Step.** The user uploads a chat log and presses "start analysis" on the
upload page.

**Files.** `client/src/pages/Upload.tsx:190-194` and `:246-249` ·
`server/routers.ts:1037-1050` and `:284-288`

**What happens.** The page polls the persona's analysis status only while the
status reads `"analyzing"`:

```ts
refetchInterval: (query) => query.state.data?.status === "analyzing" ? 1500 : false
```

A freshly created persona is `"pending"`, so the poll is **off** before the run
starts. Pressing the button fires the mutation and then calls `refetchStatus()`
exactly once. The server sets `analysisStatus: "analyzing"` only *after* three
database reads inside a fire-and-forget call
(`startPersonaDistillation(...).catch(...)` → `getFilesByPersonaId` →
`getCollectedMessagesForPersona` → `updatePersona`). If that single refetch
lands before the write, the status is still `"pending"`, the poll never
starts, and the page sits on the "start analysis" button with no progress bar
and no result. The job-status poll cannot rescue it: it is disabled until
`persona.skillJobId` is set, which only happens during the run
(`server/skill-engine/pipeline.ts:758`). Only a manual reload recovers.

**Why it matters to a person.** "It says the analysis started, then nothing
happens, ever" is the worst possible failure for the one step the product
cannot be judged without.

### A-3 · LOW · The first-run administrator is a second, invisible account

**Step.** The operator installs the app; the server creates an `admin` account
at boot; the browser asks them to register.

**Files.** `server/bootstrap/bootstrap.ts:90-153` · `server/db.ts:218` ·
`server/_core/env.ts:276`

**What happens.** `bootstrapAdminAccount` runs at every boot and creates
`admin` with a random password written to `first-run-credentials.txt` — but
only while the user table is empty. The UI never mentions it: the landing page
offers "sign up", the operator registers a second account, and the console
password is never used. Both accounts get `role: "user"`
(`server/db.ts:218`), so there is no privilege split — just an orphan account
and a password file the operator has to go and find.

---

## B. The app's promise

### B-1 · MEDIUM · The first automatic memory extraction needs ten messages
inside one 24-hour window, so a casual user never has a single memory

**Step.** The second, tenth and twentieth conversation.

**Files.** `server/chat/service.ts:870-890` ·
`server/chat/memory-extract.ts:345-360` · `server/db.ts:1907-1913`

**What happens.** The extraction is throttled by `isExtractionDue`: at least
ten *new user messages*, and at least 24 hours since the last run. The window
used to count them in is

```ts
const newMessages = await db.getUserMessageCountForPersonaSince(
  persona.id, userId, last ?? new Date(now.getTime() - 24 * 3_600_000));
```

`last` is `getLastExtractionAt(...)`, which is `null` until the *first*
extraction has run. So the very first run is gated on "ten user messages in
the last 24 hours", and the window slides forward every day until it fires. A
person who sends three or four messages a day — the normal pace for this app —
never reaches ten in any 24-hour window, so `newMessages` stays below the
threshold for ever, the extraction log stays empty, and **no memory is ever
written from the conversation**. The `memories` table the user is pointed at
stays empty and the persona never accumulates anything from talking to them.

**Why it matters to a person.** The app's claim is that it learns the person.
For a normal pace of use it silently never does. There is a manual "extract"
button (`client/src/pages/Chat.tsx:1778`), so it is recoverable — but nothing
tells the user that the automatic path is not running.

### B-2 · LOW · The uploaded chat log never becomes a memory

**Step.** "Trace what the app actually does with the uploaded chat log."

**Files.** `server/skill-engine/pipeline.ts:1153-1231` ·
`server/chat/retrieval.ts:310-328`

**What happens.** The distillation writes `personaData` (a blob with a
`memories` field) and the mined micro-rules; it never creates a row in the
`memories` table. The retrieval layer carries the uploaded file as a *file
summary* — `extractedMemory` is the raw text of the file, sliced to the first
400 characters (`server/chat/retrieval.ts:319`), which for a WeChat export is a
file header rather than anything about the person. So what the app "learned"
about the uploaded history lives in a blob the user can read in PersonaProfile
and edit in PersonaEdit, but the memory panel, the anchors, the pinning and
the "did it recall that or invent it?" chips all stay empty until the user
talks to the persona.

**Why it matters to a person.** Two different "memories" in the product — one
the user can browse and correct, one it cannot — and only the invisible one
is fed by the upload the user was asked to make.

---

## C. The graduation

### C-1 · HIGH · A persona that has said goodbye still writes to the user — the
letter-answering sweep does not know the persona is asleep

**Step.** "Trace it end to end: the thresholds, the suggestion, the letter, the
state changes … Does the persona know it has graduated?"

**Files.** `server/chat/service.ts:446-458` · `server/chat/letters.ts:99-201` ·
`server/scheduler/index.ts:49-55` · `server/db.ts:2727-2776`

**What happens.** Graduating sets `graduationStatus = "graduated"` **and**
`presence = "asleep"` (`server/db.ts:2760-2762`), and the chat pipeline refuses
to talk to a sleeping persona:

```ts
const presence = getEffectivePresence({ personaPresence: persona.presence, graduationStatus: persona.graduationStatus });
if (presence === "asleep") throw new PersonaAsleepError(copy(locale, "prompt.graduatedNotice", { name: persona.name }));
```

The letter path does not. `answerDueLetters` — run every minute by the
scheduler — fetches the persona, composes a reply and writes it into the
conversation without ever asking whether the persona is awake. A letter
written before the goodbye is therefore answered **a day after the goodbye**,
in the persona's voice, as if nothing had happened. The user's own message is
not even stored on the chat path (the asleep check runs before
`db.createMessage`), so the transcript stays clean, but the reply still lands.

**Why it matters to a person.** The graduation is the one moment the product
exists for. The app's own comment says a persona that has said goodbye "used to
stay perfectly chatable, which meant the 'graduation' was only a badge". The
letter path is the last place that badge is still worn.

### C-2 · MEDIUM · A graduation suggestion raised from a channel never reaches
the web, and the cooldown hides it for a week

**Step.** "What happens if the app suggests it again? Is the suggestion
repeated?"

**Files.** `server/chat/service.ts:1046-1048` · `server/_core/graduation.ts:118-154` ·
`server/routers.ts:1070-1162` · `client/src/pages/Chat.tsx:581` ·
`server/channels/bridge.ts:108-111`

**What happens.** The decision is recorded in the database
(`setGraduationStatus(persona.id, userId, "suggested")`), which also starts the
seven-day cooldown in `canOfferGraduation`. On the web, the only thing that
opens the farewell window is the live `graduationSuggested` flag on the turn
that produced it (`client/src/pages/Chat.tsx:581`). There is a query for
exactly this state — `persona.checkGraduation`, which returns
`eligible: persona.graduationStatus === "suggested"` — and **no client code
calls it**. So when the suggestion is raised from WeChat or Feishu, the web
never shows it; the channel only appends a standing invitation ("如果哪天想好好
说声再见，随时发 /毕业"), not the app's actual decision; and because the status
is now "suggested", the next web turn is blocked by the cooldown and returns
`false`. The offer is invisible on the web for seven days.

**Why it matters to a person.** The app decides a relationship has run its
course and the person never finds out, on the surface they actually use.

### C-3 · MEDIUM · One condition, three different messages, and no way to wake
the persona from the screen that says so

**Step.** "What the user sees."

**Files.** `server/channels/bridge.ts:77-93` · `server/chat/stream-route.ts:150-168` ·
`server/routers.ts:1468-1518` · `server/_core/trpc.ts:25-38` ·
`client/src/pages/Lobby.tsx:1185-1198`

**What happens.** Talking to a graduated persona throws `PersonaAsleepError`,
whose message is the app's own, localised notice ("{{name}} 已经毕业了。如果还
想继续聊，先把这个分身唤醒。"). Three surfaces handle it three different ways:

* **WeChat / Feishu** — the bridge catches `PersonaAsleepError` and returns
  `e.message`: the user reads the notice.
* **Web, streaming** — the route's catch-all writes `errors.replyFailed`
  ("the reply could not be produced"): the user is told the app failed.
* **Web, tRPC fallback** — the error is not a `TRPCError`, so
  `formatErrorForClient` replaces it with the untranslated
  "Something went wrong on the server."

And the notice tells the user to wake the persona up — but the only "wake up"
control is the button on the persona's card in the lobby
(`client/src/pages/Lobby.tsx:1185-1198`), which for a graduated persona is
folded away behind a "show graduated" toggle. There is no awaken button on
the chat page, on the graduation page, or in the error itself.

**Why it matters to a person.** The single most important moment of the
product is the one moment where the three surfaces say three different things,
and the one the user is told to do is not offered.

### C-4 · LOW · A graduation made from a channel loses the "simplified letter"
flag

**Files.** `server/channels/commands.ts:360-366` vs `server/routers.ts:1186-1199`

`persona.graduate` records `farewellDegraded` and `farewellDraft` next to the
letter; the channel's `/毕业` handler calls `setGraduationStatus(..., "graduated",
farewellLetter)` with neither. A letter that fell back to the single-pass
version is therefore indistinguishable from a full one on the Graduation page
afterwards.

---

## D. The two sides

### D-1 · HIGH · Neither channel can be bound from the interface — the WeChat
and Feishu personas can never answer

**Step.** "A user binds WeChat. They send a message from WeChat. The persona
replies in WeChat."

**Files.** `client/src/pages/Settings.tsx:856`, `:858-866`, `:877`, `:935-941` ·
`server/wechat/message-handler.ts:25-36` · `shared/copy/channels.ts:115-118`,
`:151-154` · `server/db.ts:1467-1500`, `:1510-1542` ·
`server/routers.ts:1850-1866`, `:1971-2000` ·
`server/channels/wechat.ts:79-94` · `server/channels/feishu.ts:441-457` ·
`server/wechat/bot.ts:478-487` · `README.en.md:99`

**What happens.** The only writers of the binding tables are
`setWechatBindingPersona` / `setChannelBindingPersona`
(`server/db.ts:1467`, `:1992` equivalents), reached from three places:

* `wechat.setDefaultPersona` (`server/routers.ts:1850`) — needs a
  `wechatUserId` from the client;
* `channel.setDefaultPersona` (`server/routers.ts:1971`) — needs a `targetId`
  from the client. **No client code calls it at all** (`grep` over `client/src`
  finds only `trpc.wechat.setDefaultPersona`);
* the adapters (`server/channels/wechat.ts:84-86`, `server/channels/feishu.ts:446-448`)
  — which read `bindings[0]` and throw "no binding" when there is none.

And the client cannot supply the id, because the picker is rendered **only
when a binding already exists**:

```tsx
const primaryBinding = bindingsData[0];
…
) : primaryBinding ? (   /* persona picker + Save */ ) : (   /* a sentence, no control */ )
```

The iLink login does know the counterpart's id — it is written to the bot-state
row (`server/wechat/bot.ts:486`) and returned by `wechat.getStatus` as
`loggedInUser` — but it is never copied into a binding.

So the loop closes on itself:

* The user sends a WeChat message. No binding → the bot answers
  *"还没有设置默认分身。请在网页端「设置 → 微信」里选择要对话的分身。"*
  (`shared/copy/channels.ts:115-118`).
* The user goes to Settings → WeChat. It says *"还没有设置默认分身。连接成功后回到
  这里，选择一个分身作为微信里的默认对话对象。"* — and renders **no picker**, because
  the picker is behind `primaryBinding`.
* Feishu is one step worse: the Settings → Feishu section
  (`client/src/pages/Settings.tsx:1268-1394`) has credentials and connect /
  disconnect and **no binding UI at all**, while the bot tells the user to
  "choose one under Settings → Feishu on the web".

`README.en.md:99` documents the step that does not exist: *"Pick a default
persona in 设置 → 微信 → 默认分身."*

**Why it matters to a person.** Journey D does not happen. The channel feature
the README leads with — "the persona walks out of the browser" — cannot be
switched on, and the app sends the person between WeChat and the web telling
them to do a thing that is not on the screen.

### D-2 · MEDIUM · The two channels pick the reply language by two different
rules

**Files.** `server/wechat/persona-bridge.ts:22-36` · `server/channels/feishu.ts:184-186` ·
`shared/copy/index.ts:161-165`

**What happens.** WeChat passes the user's *saved* interface language
(`db.getUserLocale`), Feishu passes the language *detected from each message*
(`detectLocale(text)` — a CJK-character test). The saved language defaults to
`zh` (`client/src/contexts/LocaleContext.tsx:36-44`). An English user who has
not touched the language switch therefore gets Chinese replies on WeChat and
English replies on Feishu, and on Feishu the same conversation can switch
language mid-thread depending on what was typed. The locale also selects the
emotion-trigger table and the language of the prompt, so the persona's
emotional reading of the same message differs between the two sides.

**Why it matters to a person.** Two channels, one persona, two voices — and
the user cannot tell which one is the rule.

### D-3 · MEDIUM · The two sides judge "is it time to say goodbye" on
different calendars

**Files.** `server/channels/commands.ts:336` vs `server/routers.ts:1137` ·
`server/db.ts:2688-2705`

**What happens.** The web's `persona.checkGraduation` reads the emotion trend
with the user's zone (`getRecentEmotionTrend(id, userId, 14, ctx.user.timezone)`).
The channel's `/毕业` handler calls the same function **without** the zone
(`getRecentEmotionTrend(personaId, params.userId, 14)`), so `zonedDayKeySince`
falls back to the server's calendar. The emotion snapshots are written under
the *user's* day keys, so near a day boundary the channel reads a different
14-day window than the web and can answer "现在还不是告别的时候" while the web
says the opposite.

**Why it matters to a person.** The farewell is a one-way door; being told "not
yet" on one side and "yes" on the other is not a thing anyone should have to
think about.

### D-4 · MEDIUM · The WeChat expired-token notice is hard-coded Chinese, and
a restart wipes the recorded error

**Files.** `server/wechat/bot.ts:121-122`, `:531-548`, `:647-668` ·
`client/src/pages/Settings.tsx:795-796`

**What happens.** When the iLink backend returns `errcode -14`, the account
pauses for an hour and the user is told:

```ts
const STALE_TOKEN_MESSAGE = "微信登录已过期，请重新扫码连接。";
```

— Chinese, in an app that carefully localises everything else (including the
auth routes, `server/_core/auth.ts:124-128`). An English user sees a Chinese
sentence in Settings → WeChat.

Separately, `restoreWeChatBot` sets `account.status = "logged_in"` and
`account.lastError = null` on start-up, discarding the persisted
`state.lastError`. After a restart the interface says "connected" for a
credential that is known to be dead, until the first poll fails.

**Why it matters to a person.** "What happens when the user's WeChat token
expires?" — it expires silently in the wrong language, and the app claims to
be connected.

---

## E. The self-hosting promise

### E-1 · HIGH · The read-aloud button sends the message text to Microsoft

**Step.** "Every model call, every telemetry-ish thing, every third-party
fetch."

**Files.** `server/_core/tts.ts:199-201` · `client/src/components/MessageBubble.tsx:103-203` ·
`server/routers.ts:1726-1732` · `node_modules/edge-tts/out/index.js:56-57` ·
`README.en.md:16`, `README.md:297`, `README.md:826`

**What happens.** Every message bubble has a speaker button. Pressing it calls
`chat.tts` → `generateTTS` →

```ts
const { tts } = await import("edge-tts");
const audioBuffer = await tts(trimmed, { voice });
```

`edge-tts` is Microsoft's *online* Edge read-aloud service:

```js
var baseUrl = `speech.platform.bing.com/consumer/speech/synthesize/readaloud`;
var webSocketURL = `wss://${baseUrl}/edge/v1?TrustedClientToken=${token}`;
```

The persona's reply — the text of a private conversation — is streamed to
Microsoft, and the returned audio is cached under `./uploads/tts/`. There is no
configuration for it, no local/offline alternative, no opt-in, and no
disclosure anywhere: the Settings page has no voice section, and
`SafetyTransparency` (the panel that exists to tell the user what the app
noticed) says nothing about it. The only route to a local TTS is `TTS_VOICES`
being *names* for the same service.

**Why it matters to a person.** The README's headline promise is *"Every byte
stays on your machine"* / *"所有数据本地存储 … 不上传第三方"*, and the way to honour
it is documented as "配合 Ollama 可实现完全离线推理" — fully offline inference with
Ollama. In that configuration the voice button still ships the conversation to
a third party, without saying so. This is the one thing that leaves the
machine that the user did not expect.

### E-2 · Verified clean — what else does *not* leave the machine

For the record, the rest of the egress story holds up, and it is worth saying
so explicitly:

* **No telemetry.** No Sentry/analytics/beacon of any kind in `server/`,
  `client/src` or `client/public`.
* **No third-party browser assets.** `client/index.html` loads only local
  files (font, icons, manifest); `client/src/index.css` imports only Tailwind
  and `tw-animate-css`; the service worker only ever caches same-origin
  resources and explicitly refuses `/api/` and `/uploads/`
  (`client/public/sw.js:34-42`).
* **Model calls are the ones you chose.** `resolveProviderForUserWithOwnership`
  (`server/llm/user-provider.ts:110-156`) uses the user's own key when they
  have one and never falls back to the operator's afterwards; the memory
  extraction, the farewell letter, the corrections and the emotion classifier
  all carry the ownership flag through, so a user's private conversation does
  not land on the operator's bill.
* **The notification path** (`server/_core/notification.ts`) deliberately has
  no push service: it uses the user's own bound channels or the local database.
* **The collectors** drive the user's *own* services (DingTalk, Feishu, Slack,
  email) with the user's own credentials.

The TTS call in E-1 is the exception, and it is the one the user is least
likely to expect.

---

## Summary

| # | Journey | Severity | One line |
|---|---------|----------|----------|
| A-1 | A | HIGH | A voice note is never heard; the "transcription" is the model guessing from the duration, and the guess is shown as the user's own words |
| A-2 | A | MEDIUM | The analysis-progress poll only starts if the first status read already sees "analyzing" — otherwise the upload page hangs on "start analysis" for ever |
| A-3 | A | LOW | The first-run `admin` account is invisible in the UI; the operator registers a second account |
| B-1 | B | MEDIUM | The first memory extraction needs 10 user messages inside one 24-hour window, so a casual user never gets a memory at all |
| B-2 | B | LOW | The uploaded chat log never becomes a memory row; only the personaData blob carries it |
| C-1 | C | HIGH | A graduated (asleep) persona still answers a delivered letter a day later |
| C-2 | C | MEDIUM | A graduation suggestion raised from a channel never reaches the web, and the 7-day cooldown hides it |
| C-3 | C | MEDIUM | Three different messages for "this persona has graduated", and no way to wake it from the screen that says so |
| C-4 | C | LOW | The channel's `/毕业` loses the "simplified letter" flag |
| D-1 | D | HIGH | Neither WeChat nor Feishu can be bound from the interface; the channels can never answer |
| D-2 | D | MEDIUM | WeChat and Feishu choose the reply language by different rules |
| D-3 | D | MEDIUM | The channel and the web judge the graduation thresholds on different calendars |
| D-4 | D | MEDIUM | The WeChat expired-token notice is hard-coded Chinese; a restart wipes the recorded error and claims "connected" |
| E-1 | E | HIGH | The read-aloud button sends the message text to Microsoft's Edge TTS service, un-configurable and undisclosed |

**The through-line.** Three of the four HIGH findings are the same shape: a
component that was finished in isolation and never given the missing half of
its contract. The voice recorder has no transcription path (A-1). The channel
adapter has no binding UI (D-1). The letter sweeper has no presence check
(C-1). In each case the neighbouring code is careful — the channels share one
conversation pipeline, the graduation writes its state through one helper, the
LLM layer refuses to fall back to the operator's key — and the seam is exactly
where the two halves stop meeting.
