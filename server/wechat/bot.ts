/**
 * Weixin ClawBot channel client.
 *
 * Replaces the previous Wechaty-based implementation (which drove an
 * unofficial protocol and carried a real account-ban risk) with the official
 * Tencent iLink backend used by the WeChat "ClawBot" plugin.
 *
 * Flow:
 *   1. `startLogin` requests a QR code; the user scans it in WeChat.
 *   2. The server polls the QR status until it is confirmed, then stores the
 *      bot token (encrypted) and starts the long-poll loop.
 *   3. `monitor` long-polls for inbound messages and routes them to
 *      Mirrai's persona engine.
 *
 * Only one account is supported per Mirrai user, and only one long-poll loop
 * runs per process (the plan calls for a process-level guard so multiple
 * instances do not poll the same account concurrently).
 */
import { ENV } from "../_core/env";
import { decryptSecret, encryptSecret } from "../_core/crypto";
import * as db from "../db";
import {
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  buildClientVersion,
  classifyFetchError,
  getUpdates,
  notifyStart,
  notifyStop,
  type WeixinApiOptions,
} from "./ilink/client";
import {
  DEFAULT_ILINK_BOT_TYPE,
  FIXED_BASE_URL,
  pollQrLogin,
  startQrLogin,
} from "./ilink/login";
import { parseInboundMessage, type ParsedInbound } from "./ilink/parse";
import { sendTextMessage } from "./ilink/send";
import { handleWeixinMessage } from "./message-handler";
import { copy } from "@shared/copy";

/** Error code returned by the backend when the bot token is stale/expired. */
export const STALE_TOKEN_ERRCODE = -14;

/** How long to pause the account after a stale-token error. */
const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

/** Consecutive failures before backing off. */
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
/**
 * The shortest gap between two polls.
 *
 * Both the login poll and the message poll are long polls: the request
 * is held open and the answer comes when there is something to say. A
 * backend that answers at once — because it is down, or because it has
 * decided there is nothing to report — would otherwise be asked again
 * and again with no gap, which is a hot loop against somebody else's
 * server and a good way to get the account throttled.
 */
const MIN_POLL_INTERVAL_MS = 1_500;

export type WechatBotStatus = "stopped" | "scanning" | "scaned" | "need_verifycode" | "logged_in" | "error";

export type BotStatusSnapshot = {
  status: WechatBotStatus;
  qrCodeUrl: string | null;
  loggedInUser: string | null;
  lastError: string | null;
  /** Set when the backend asked for the numeric code shown in WeChat. */
  needsVerifyCode: boolean;
};

type LoginSession = {
  qrcode: string;
  baseUrl: string;
  verifyCode?: string;
  refreshCount: number;
  startedAt: number;
};

/**
 * The iLink QR code expires quickly — measured at roughly 90 seconds against
 * the live backend, not the 5 minutes the upstream plugin assumes. The code
 * is therefore refreshed on every expiry, without a hard limit, matching the
 * official CLI's behaviour: as long as the user is still trying, a valid code
 * is always on screen.
 */
const LOGIN_TTL_MS = 3 * 60 * 1000;

// ── Per-user state ──────────────────────────────────────────────────────────

/**
 * State for one connected WeChat account.
 *
 * Each Mirrai user connects their own WeChat account, so the channel state
 * must be per user rather than global — otherwise one user's login would
 * clobber another's.
 */
type AccountState = {
  monitorAbort: AbortController | null;
  monitorPromise: Promise<void> | null;
  loginSession: LoginSession | null;
  loginPolling: boolean;
  status: WechatBotStatus;
  qrCodeUrl: string | null;
  loggedInUser: string | null;
  lastError: string | null;
  needsVerifyCode: boolean;
  pauseUntil: number;
};

const accounts = new Map<number, AccountState>();

/**
 * What the user is told when the bot's credentials have expired.
 *
 * The token has to be obtained again — the pause is an hour, and the
 * token does not come back on its own.
 */
/**
 * The notice, in the reader's language.
 *
 * It used to be a hard-coded Chinese string, so an English user was
 * told, in Chinese, to scan the code again.
 */
async function staleTokenMessage(userId: number): Promise<string> {
  const locale = await db.getUserLocale(userId).catch(() => "zh" as const);
  return copy(locale, "errors.wechatTokenExpired");
}

/**
 * Records that a reply could not be delivered.
 *
 * The reply is stored in the conversation before it is sent, so the web
 * interface shows it as answered. When the send fails — the token has
 * expired, the backend refused it, the user has blocked the bot —
 * nothing arrived, and the user was told nothing.
 */
export function noteDeliveryFailure(userId: number, reason: string): void {
  const account = getAccount(userId);
  account.lastError = reason;
  void db
    .upsertWechatBotState(userId, { lastError: reason })
    .catch((e) => logError(`状态写入失败: ${String(e)}`));
}

function getAccount(userId: number): AccountState {
  let account = accounts.get(userId);
  if (!account) {
    account = {
      monitorAbort: null,
      monitorPromise: null,
      loginSession: null,
      loginPolling: false,
      status: "stopped",
      qrCodeUrl: null,
      loggedInUser: null,
      lastError: null,
      needsVerifyCode: false,
      pauseUntil: 0,
    };
    accounts.set(userId, account);
  }
  return account;
}

/** Resolves when a queued inbound message has been fully processed. */
const pendingWork: Array<Promise<unknown>> = [];

export function getBotStatus(userId: number): BotStatusSnapshot {
  const account = getAccount(userId);
  return {
    status: account.status,
    qrCodeUrl: account.qrCodeUrl,
    loggedInUser: account.loggedInUser,
    lastError: account.lastError,
    needsVerifyCode: account.needsVerifyCode,
  };
}

// ── Logging helper ─────────────────────────────────────────────────────────

function log(message: string) {
  console.log(`[WeChat] ${message}`);
}

function logError(message: string) {
  console.error(`[WeChat] ${message}`);
}

// ── Config helpers ─────────────────────────────────────────────────────────

/** Builds the API options for a given account. */
function buildApiOptions(params: { token?: string; baseUrl?: string }): WeixinApiOptions {
  return {
    baseUrl: params.baseUrl || ENV.wechatIlinkBaseUrl || FIXED_BASE_URL,
    token: params.token,
    appId: ENV.wechatIlinkAppId,
    clientVersion: buildClientVersion(ENV.appVersion),
    channelVersion: ENV.appVersion,
    botAgent: `Mirrai/${ENV.appVersion}`,
    routeTag: ENV.wechatRouteTag,
  };
}

/** True when the account is inside a stale-token cooldown. */
function isSessionPaused(account: AccountState): boolean {
  if (account.pauseUntil === 0) return false;
  if (Date.now() >= account.pauseUntil) {
    account.pauseUntil = 0;
    return false;
  }
  return true;
}

function getRemainingPauseMs(account: AccountState): number {
  return account.pauseUntil === 0 ? 0 : Math.max(0, account.pauseUntil - Date.now());
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // The listener is removed when the timer fires.
    //
    // The monitor's signal lives for the whole session and `sleep` is
    // called on every pause, so the listeners on it grew without bound
    // — thousands of retained closures on a long-lived object, and a
    // warning in the log that hid real problems.
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── Login flow ─────────────────────────────────────────────────────────────

/**
 * Starts a QR login: fetches a QR code and begins polling its status.
 */
export async function startLogin(userId: number): Promise<BotStatusSnapshot> {
  const account = getAccount(userId);
  // A fresh login supersedes any previous attempt.
  account.loginSession = null;

  const state = await db.getWechatBotState(userId);
  const localTokenList: string[] = [];
  if (state?.botTokenEnc) {
    const token = await decryptSecret(state.botTokenEnc);
    if (token) localTokenList.push(token);
  }

  const result = await startQrLogin({
    baseUrl: FIXED_BASE_URL,
    botType: ENV.wechatBotType || DEFAULT_ILINK_BOT_TYPE,
    localTokenList,
    apiOptions: buildApiOptions({}),
  });

  if (!result.ok || !result.qrcode) {
    account.status = "error";
    account.lastError = result.message;
    await db.upsertWechatBotState(userId, { status: "error", lastError: result.message });
    return getBotStatus(userId);
  }

  account.loginSession = {
    qrcode: result.qrcode,
    baseUrl: result.baseUrl,
    refreshCount: 1,
    startedAt: Date.now(),
  };

  account.status = "scanning";
  account.qrCodeUrl = result.qrcodeImgContent ?? null;
  account.lastError = null;
  account.needsVerifyCode = false;
  await db.upsertWechatBotState(userId, {
    status: "scanning",
    qrCodeUrl: account.qrCodeUrl,
    lastError: null,
  });

  void pollLoginStatus(userId);
  return getBotStatus(userId);
}

/**
 * Supplies the numeric code shown in WeChat when the backend asks for it.
 */
export async function submitVerifyCode(userId: number, code: string): Promise<BotStatusSnapshot> {
  const account = getAccount(userId);
  if (!account.loginSession) {
    account.lastError = "没有进行中的登录，请先发起连接。";
    return getBotStatus(userId);
  }
  account.loginSession.verifyCode = code.trim();
  if (!account.loginPolling) {
    void pollLoginStatus(userId);
  }
  return getBotStatus(userId);
}

/** Cancels an in-progress login attempt. */
export async function cancelLogin(userId: number): Promise<BotStatusSnapshot> {
  const account = getAccount(userId);
  account.loginSession = null;
  account.status = "stopped";
  account.qrCodeUrl = null;
  account.needsVerifyCode = false;
  account.lastError = null;
  await db.upsertWechatBotState(userId, { status: "stopped", qrCodeUrl: null, lastError: null });
  return getBotStatus(userId);
}

/**
 * Polls the QR status until the login resolves.
 *
 * Each poll is a single long-poll request; the loop re-arms as needed.
 */
async function pollLoginStatus(userId: number): Promise<void> {
  /**
   * The language the reader reads.
   *
   * The errors of the login are read by a person — and the two that
   * could be said in words were hard-coded in Chinese.
   */
  const locale = await db.getUserLocale(userId).catch(() => "zh" as const);
  const account = getAccount(userId);
  if (account.loginPolling) return;
  account.loginPolling = true;

  try {
    /**
     * When the last poll was.
     *
     * The minimum interval was applied in one branch only — the one
     * that says "nothing has happened yet". So the moment the code was
     * scanned, the loop asked again straight away, and again, and
     * again: a hot loop against Tencent's backend for as long as the
     * user took to confirm the scan in WeChat.
     */
    let lastPollAt = 0;

    while (account.loginSession) {
      const session = account.loginSession;

      // The pause comes before the poll, so every branch of the loop
      // is paced — the scan, the redirect and the refresh included.
      if (lastPollAt) {
        const sinceLast = Date.now() - lastPollAt;
        if (sinceLast < MIN_POLL_INTERVAL_MS) {
          await sleep(MIN_POLL_INTERVAL_MS - sinceLast);
        }
      }

      // Backstop only: `startedAt` is reset on every refresh, so this fires
      // only if the backend stops reporting expiry. In practice the ~90s
      // server-side expiry drives the refresh cycle.
      if (Date.now() - session.startedAt > LOGIN_TTL_MS) {
        account.status = "error";
        account.lastError = copy(locale, "errors.wechatQrExpired");
        await db.upsertWechatBotState(userId, { status: "error", lastError: account.lastError });
        account.loginSession = null;
        break;
      }

      const pollStartedAt = Date.now();
      lastPollAt = pollStartedAt;
      const result = await pollQrLogin({
        qrcode: session.qrcode,
        baseUrl: session.baseUrl,
        verifyCode: session.verifyCode,
        apiOptions: buildApiOptions({}),
      });

      if (result.status === "wait") {
        // Nothing changed yet — poll again.
        //
        // A poll that comes back at once did not wait for anything: the
        // request failed. Every failure was reported as "wait", so a
        // backend that was down was asked again immediately, for as long
        // as the QR screen was open.
        //
        // The pause before the next poll is what keeps the rate down.
        continue;
      }

      if (result.status === "scaned") {
        // Surface the intermediate state so the UI can tell the user the code
        // was scanned and now needs confirming in WeChat. The QR code stays
        // visible until the login resolves.
        if (account.status !== "scaned") {
          account.status = "scaned";
          /**
           * The status the column accepts.
           *
           * It was written as "scanned" — and the column is a Postgres
           * enum whose values are `stopped | scanning | scaned |
           * need_verifycode | logged_in | error`. So the update was
           * refused, the error was caught by the poll, and the login
           * ended with a Postgres error on the screen instead of "the
           * code has been scanned".
           */
          await db.upsertWechatBotState(userId, { status: "scaned" });
        }
        continue;
      }

      if (result.status === "need_verifycode") {
        account.status = "need_verifycode";
        account.needsVerifyCode = true;
        account.lastError = null;
        await db.upsertWechatBotState(userId, { status: "need_verifycode" });
        // The code is entered in the web UI; stop polling until it arrives.
        account.loginPolling = false;
        return;
      }

      if (result.status === "expired" || result.status === "verify_code_blocked") {
        // The QR code expires quickly, so keep refreshing it for as long as
        // the user is still trying to scan. There is no hard limit: the
        // backend's own expiry drives the cycle, and the user can cancel.
        const refreshed = await startQrLogin({
          baseUrl: FIXED_BASE_URL,
          botType: ENV.wechatBotType || DEFAULT_ILINK_BOT_TYPE,
          apiOptions: buildApiOptions({}),
        });
        if (!refreshed.ok || !refreshed.qrcode) {
          account.status = "error";
          account.lastError = refreshed.message;
          await db.upsertWechatBotState(userId, { status: "error", lastError: account.lastError });
          account.loginSession = null;
          break;
        }
        account.loginSession = {
          qrcode: refreshed.qrcode,
          baseUrl: refreshed.baseUrl,
          refreshCount: session.refreshCount + 1,
          startedAt: Date.now(),
        };
        account.status = "scanning";
        account.qrCodeUrl = refreshed.qrcodeImgContent ?? null;
        account.needsVerifyCode = false;
        account.lastError = null;
        await db.upsertWechatBotState(userId, {
          status: "scanning",
          qrCodeUrl: account.qrCodeUrl,
          lastError: null,
        });
        continue;
      }

      if (result.status === "scaned_but_redirect") {
        if (result.redirectHost) {
          session.baseUrl = `https://${result.redirectHost}`;
        }
        continue;
      }

      if (result.status === "binded_redirect") {
        /**
         * The bot is already bound to this instance.
         *
         * The path set the status to "logged_in" and stored no token,
         * and it never started the poll loop — so the interface showed
         * the green "Connected" chip while the bot received nothing
         * and could not send. It only came alive after a restart, when
         * the restore path found the token that was still there.
         *
         * So the stored credentials are kept, the stored user is
         * restored, and the monitor starts.
         */
        const stored = await db.getWechatBotState(userId).catch(() => undefined);
        account.needsVerifyCode = false;
        account.lastError = null;
        account.qrCodeUrl = null;
        account.loginSession = null;
        if (stored?.loggedInUser) account.loggedInUser = stored.loggedInUser;

        if (!stored?.botTokenEnc) {
          /**
           * There are no credentials.
           *
           * The backend says the bot is bound to this instance, but
           * there is nothing here to poll with — so saying "connected"
           * would be a lie, and the interface would show a channel that
           * cannot receive or send.
           */
          account.status = "error";
          account.lastError = copy(locale, "errors.wechatCredentialsLost");
          await db.upsertWechatBotState(userId, {
            status: "error",
            qrCodeUrl: null,
            lastError: account.lastError,
            loggedInUser: account.loggedInUser ?? null,
          });
          break;
        }

        account.status = "logged_in";
        await db.upsertWechatBotState(userId, {
          status: "logged_in",
          qrCodeUrl: null,
          lastError: null,
          loggedInUser: account.loggedInUser ?? null,
        });
        startWeChatBot(userId);
        break;
      }

      if (result.status === "confirmed") {
        if (!result.botToken || !result.accountId) {
          account.status = "error";
          account.lastError = copy(locale, "errors.wechatNoCredentials");
          await db.upsertWechatBotState(userId, { status: "error", lastError: account.lastError });
          account.loginSession = null;
          break;
        }

        const encrypted = await encryptSecret(result.botToken);
        account.loggedInUser = result.userId ?? result.accountId;
        account.status = "logged_in";
        account.needsVerifyCode = false;
        account.lastError = null;
        account.qrCodeUrl = null;
        account.loginSession = null;

        await db.upsertWechatBotState(userId, {
          status: "logged_in",
          qrCodeUrl: null,
          loggedInUser: account.loggedInUser,
          lastError: null,
          botTokenEnc: encrypted,
          accountId: result.accountId,
          baseUrl: result.baseUrl ?? null,
          wechatUserId: result.userId ?? null,
        });

        log(`登录成功，账号 ${account.loggedInUser}`);
        startWeChatBot(userId);
        break;
      }
    }
  } catch (err) {
    account.status = "error";
    account.lastError = String(err);
    logError(`登录轮询失败: ${String(err)}`);
    await db.upsertWechatBotState(userId, { status: "error", lastError: account.lastError }).catch(() => {});
  } finally {
    account.loginPolling = false;
  }
}

// ── Monitor loop ───────────────────────────────────────────────────────────

/**
 * Starts the long-poll loop for the connected account.
 *
 * The guard is per user: a Mirrai user connects their own WeChat account, so
 * two different users may each run their own loop, but the same user never
 * ends up with two concurrent polls of one account.
 */
export function startWeChatBot(userId: number) {
  const account = getAccount(userId);
  if (account.monitorPromise) {
    log("监控已在运行中");
    return;
  }

  account.monitorAbort = new AbortController();
  account.monitorPromise = runMonitor(userId, account.monitorAbort.signal).finally(() => {
    account.monitorPromise = null;
    account.monitorAbort = null;
  });
}

/**
 * Restores the long-poll loop from stored credentials, if any.
 * Called on server start so a restart does not require re-scanning.
 */
export async function restoreWeChatBot(userId: number): Promise<boolean> {
  const state = await db.getWechatBotState(userId);
  if (!state?.botTokenEnc) return false;

  /**
   * The user disconnected.
   *
   * The status was ignored and the token was enough — so the bot was
   * restarted on the next boot, the long poll began again, and it
   * answered the user's WeChat messages once more. The interface had
   * said "disconnected".
   */
  if (state.status === "stopped") {
    const account = getAccount(userId);
    account.status = "stopped";
    account.loggedInUser = null;
    return false;
  }

  const locale = await db.getUserLocale(userId).catch(() => "zh" as const);
  const token = await decryptSecret(state.botTokenEnc);
  if (!token) {
    log("凭据无法解密，需要重新扫码");
    await db.upsertWechatBotState(userId, {
      status: "error",
      lastError: copy(locale, "errors.wechatCredentialsLost"),
    });
    return false;
  }

  const account = getAccount(userId);
  /**
   * The error is not thrown away.
   *
   * A restart set the status to "logged_in" and the error to null — so
   * the interface said "connected" for a credential known to be dead,
   * and the error that said otherwise was gone.
   */
  const recordedError = state.lastError ?? null;
  account.status = recordedError ? "error" : "logged_in";
  account.loggedInUser = state.loggedInUser;
  account.lastError = recordedError;
  startWeChatBot(userId);
  return true;
}

/** Stops the long-poll loop. */
/**
 * Stops every running bot.
 *
 * It is what the process calls when it is asked to shut down: the
 * poll loop keeps running until it is told to stop, and a bot that
 * was left running would go on polling a backend that is no longer
 * being answered.
 */
export async function stopAllWeChatBots(): Promise<void> {
  for (const userId of Array.from(accounts.keys())) {
    try {
      await stopWeChatBot(userId);
    } catch {
      // A bot that will not stop must not hold the shutdown up.
    }
  }
}

export async function stopWeChatBot(userId: number) {
  const account = getAccount(userId);
  if (account.monitorAbort) {
    account.monitorAbort.abort();
  }
  // Wait for the loop to unwind so the backend is notified cleanly.
  if (account.monitorPromise) {
    await account.monitorPromise.catch(() => {});
  }
  account.monitorAbort = null;
  account.monitorPromise = null;

  account.status = "stopped";
  account.qrCodeUrl = null;
  account.needsVerifyCode = false;
  // And the in-memory error goes with it — the status is read next to
  // it, so a stale error under a "not connected" chip is a lie.
  account.lastError = null;
  account.loggedInUser = null;

  /**
   * The credentials go too.
   *
   * They were kept — and the restore path looked only for the token,
   * so a disconnect was undone by the next restart: the long poll
   * began again and the bot answered the user's WeChat messages once
   * more.
   */
  await db.upsertWechatBotState(userId, {
    status: "stopped",
    qrCodeUrl: null,
    lastError: null,
    botTokenEnc: null,
    accountId: null,
    baseUrl: null,
    wechatUserId: null,
    loggedInUser: null,
    syncBuf: null,
  }).catch(() => {});
}

/**
 * The long-poll loop.
 *
 * On a stale-token error the account is paused for an hour, matching the
 * upstream plugin's session guard.
 */
async function runMonitor(userId: number, signal: AbortSignal): Promise<void> {
  const account = getAccount(userId);
  const state = await db.getWechatBotState(userId);
  if (!state?.botTokenEnc) {
    logError("没有可用凭据，无法启动监控");
    return;
  }

  const token = await decryptSecret(state.botTokenEnc);
  if (!token) {
    logError("凭据无法解密，无法启动监控");
    await db.upsertWechatBotState(userId, { status: "error", lastError: "凭据已失效，请重新连接微信" });
    return;
  }

  const apiOptions = buildApiOptions({ token, baseUrl: state.baseUrl ?? undefined });
  let syncBuf = state.syncBuf ?? "";
  let consecutiveFailures = 0;

  log(`监控启动 (${apiOptions.baseUrl})`);

  try {
    await notifyStart(apiOptions).catch((e) => logError(`notifystart 失败: ${String(e)}`));
  } catch {
    // Non-blocking: the upstream also treats this as a warning.
  }

  while (!signal.aborted) {
    if (isSessionPaused(account)) {
      const remaining = getRemainingPauseMs(account);
      log(`凭据已失效，暂停 ${Math.ceil(remaining / 60_000)} 分钟`);
      try {
        await sleep(Math.min(remaining, 60_000), signal);
      } catch {
        return;
      }
      continue;
    }

    try {
      const pollStartedAt = Date.now();
      const resp = await getUpdates({
        ...apiOptions,
        get_updates_buf: syncBuf,
        timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
        abortSignal: signal,
      });
      const pollDuration = Date.now() - pollStartedAt;

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        if (resp.errcode === STALE_TOKEN_ERRCODE || resp.ret === STALE_TOKEN_ERRCODE) {
          account.pauseUntil = Date.now() + SESSION_PAUSE_DURATION_MS;
          logError("凭据已失效（errcode -14），暂停 1 小时");
          /**
           * The user is told.
           *
           * The account used to pause silently: its status stayed
           * "logged_in" and nothing was written to the database, so the
           * interface said "connected" while the bot was dead. The
           * pause then repeated hourly, for ever, with no error
           * anywhere — and the only way out was to notice and re-scan
           * by hand.
           */
          const expiredNotice = await staleTokenMessage(userId);
          account.status = "error";
          account.lastError = expiredNotice;
          await db
            .upsertWechatBotState(userId, { status: "error", lastError: expiredNotice })
            .catch((e) => logError(`状态写入失败: ${String(e)}`));
          consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures += 1;
        logError(`getUpdates 失败: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          try {
            await sleep(BACKOFF_DELAY_MS, signal);
          } catch {
            return;
          }
        } else {
          try {
            await sleep(RETRY_DELAY_MS, signal);
          } catch {
            return;
          }
        }
        continue;
      }

      consecutiveFailures = 0;

      // The poll is a long poll: the answer comes when there is
      // something to say. An answer that comes at once means the server
      // had nothing and asked for the next one straight away — so the
      // loop was issuing back-to-back requests for the whole life of the
      // connection.
      if (pollDuration < MIN_POLL_INTERVAL_MS) {
        try {
          await sleep(MIN_POLL_INTERVAL_MS - pollDuration, signal);
        } catch {
          return;
        }
      }

      if (resp.get_updates_buf) {
        syncBuf = resp.get_updates_buf;
        await db.saveWechatSyncBuf(userId, syncBuf).catch((e) =>
          logError(`同步游标保存失败: ${String(e)}`),
        );
      }

      /**
       * The batch is handled one conversation at a time.
       *
       * The comment here said "process messages from the same
       * conversation sequentially so the context window stays ordered"
       * — and the code started them all at once. So a user who sent
       * two messages in a row got two answers that interleaved: the
       * second answer could arrive before the first, and the persona
       * answered the second question twice.
       *
       * A command like "/毕业" is the worst case: two of them in the
       * same batch meant two graduations.
       */
      const byConversation = new Map<string, ParsedInbound[]>();
      for (const raw of resp.msgs ?? []) {
        const parsed = parseInboundMessage(raw);
        if (!parsed) continue;

        // De-duplicate: the same server message id must not be processed twice.
        if (parsed.messageId && (await hasProcessedMessage(userId, parsed.messageId))) {
          continue;
        }

        await db.touchWechatLastInbound(userId).catch(() => {});

        const key = `${parsed.isGroup ? "g" : "d"}:${parsed.fromUserId}`;
        const list = byConversation.get(key);
        if (list) list.push(parsed);
        else byConversation.set(key, [parsed]);
      }

      for (const list of byConversation.values()) {
        for (const parsed of list) {
          const work = handleWeixinMessage(userId, parsed)
            .catch((e) => logError(`消息处理失败: ${String(e)}`))
            .finally(() => {
              const idx = pendingWork.indexOf(work);
              if (idx >= 0) pendingWork.splice(idx, 1);
            });
          pendingWork.push(work);
          // The next message of the same conversation waits for this
          // one — the answers have to be in the order the messages
          // were sent.
          await work;
        }
      }
    } catch (err) {
      if (signal.aborted) {
        log("监控已停止");
        return;
      }
      consecutiveFailures += 1;
      // Include the classified cause — "fetch failed" alone hides the real
      // reason (DNS, TLS, timeout, ...).
      const classified = classifyFetchError(err);
      logError(
        `getUpdates 异常: ${String(err)} | type=${classified.type} ${classified.description}` +
          `${classified.code ? ` code=${classified.code}` : ""}`,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        try {
          await sleep(BACKOFF_DELAY_MS, signal);
        } catch {
          return;
        }
      } else {
        try {
          await sleep(RETRY_DELAY_MS, signal);
        } catch {
          return;
        }
      }
    }
  }
}

/** Tracks processed inbound message ids to avoid duplicate replies. */
const processedMessageIds = new Set<string>();
const PROCESSED_ID_MAX = 5000;

function processedKey(userId: number, messageId: string): string {
  return `${userId}:${messageId}`;
}

async function hasProcessedMessage(userId: number, messageId: string): Promise<boolean> {
  const key = processedKey(userId, messageId);
  if (processedMessageIds.has(key)) return true;
  if (processedMessageIds.size >= PROCESSED_ID_MAX) {
    // Drop the oldest entry to bound memory usage.
    const oldest = processedMessageIds.values().next().value;
    if (oldest) processedMessageIds.delete(oldest);
  }
  processedMessageIds.add(key);
  return false;
}

/** Waits for all in-flight message handling to complete. */
export async function drainPendingWork(): Promise<void> {
  while (pendingWork.length > 0) {
    await Promise.allSettled([...pendingWork]);
  }
}

/**
 * Sends a text message to a WeChat conversation.
 *
 * Returns false when the message could not be delivered (missing credentials,
 * expired token, or a backend rejection) so callers can degrade gracefully
 * rather than throwing.
 */
export async function sendWeixinText(
  userId: number,
  to: string,
  text: string,
  contextToken?: string,
): Promise<boolean> {
  try {
    const state = await db.getWechatBotState(userId);
    if (!state?.botTokenEnc) {
      logError("没有可用凭据，无法发送消息");
      return false;
    }
    const token = await decryptSecret(state.botTokenEnc);
    if (!token) {
      logError("凭据无法解密，无法发送消息");
      return false;
    }

    const apiOptions = buildApiOptions({ token, baseUrl: state.baseUrl ?? undefined });
    await sendTextMessage({ to, text, contextToken, opts: apiOptions });
    return true;
  } catch (e) {
    logError(`发送消息失败: ${String(e)}`);
    return false;
  }
}
