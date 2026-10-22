/**
 * Weixin iLink HTTP client.
 *
 * Ported from the official Tencent plugin `@tencent-weixin/openclaw-weixin`
 * (MIT licensed, Copyright (C) 2026 Tencent), file `src/api/api.ts`.
 *
 * Differences from upstream, all deliberate:
 * - `accounts.js` / `logger.js` coupling removed. The upstream reads the bot
 *   agent and route tag from the OpenClaw config file; Mirrai takes them from
 *   explicit options instead.
 * - `iLink-App-ClientVersion` and `channel_version` are derived from Mirrai's
 *   own version rather than the plugin's.
 */
import crypto from "node:crypto";

import type {
  BaseInfo,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  NotifyStartResp,
  NotifyStopResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  SendTypingResp,
} from "./types";

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  /** Long-poll timeout for getUpdates (server may hold the request up to this). */
  longPollTimeoutMs?: number;
  /** App id sent as `iLink-App-Id`. */
  appId?: string;
  /** Client version encoded as 0x00MMNNPP, sent as a decimal string. */
  clientVersion?: number;
  /** Channel version reported in `base_info`. */
  channelVersion?: string;
  /** Observability identifier reported in `base_info.bot_agent`. */
  botAgent?: string;
  /** Optional deployment route tag. */
  routeTag?: string;
  /** External abort signal, used to cancel an in-flight long-poll. */
  abortSignal?: AbortSignal;
};

/** Default long-poll timeout for getUpdates requests. */
export const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
/** Default timeout for regular API requests (sendMessage, getUploadUrl). */
export const DEFAULT_API_TIMEOUT_MS = 15_000;
/** Default timeout for lightweight API requests (getConfig, sendTyping). */
export const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

/**
 * Encodes a semantic version as uint32 `0x00MMNNPP`.
 * e.g. "1.0.11" -> 0x0001000B = 65547.
 */
export function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** X-WECHAT-UIN header: random uint32 -> decimal string -> base64. */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** Builds the `base_info` payload included in every API request. */
export function buildBaseInfo(opts: WeixinApiOptions): BaseInfo {
  return {
    channel_version: opts.channelVersion,
    bot_agent: opts.botAgent,
  };
}

/** Headers shared by both GET and POST requests. */
function buildCommonHeaders(opts: WeixinApiOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "iLink-App-Id": opts.appId ?? "bot",
    "iLink-App-ClientVersion": String(opts.clientVersion ?? buildClientVersion("1.0.0")),
  };
  if (opts.routeTag) {
    headers.SKRouteTag = opts.routeTag;
  }
  return headers;
}

function buildHeaders(opts: WeixinApiOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(opts),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  return headers;
}

/**
 * Classify a fetch-level error into a category for logging / diagnostics.
 * This does NOT cover HTTP-level errors (4xx/5xx) — those are thrown separately.
 */
export function classifyFetchError(err: unknown): {
  type: "dns" | "tcp" | "tls" | "timeout" | "unknown";
  description: string;
  code?: string;
} {
  if (err instanceof Error && err.name === "AbortError") {
    return { type: "timeout", description: "request timeout" };
  }

  const cause = (err as NodeJS.ErrnoException)?.cause;
  const causeCode = (cause as any)?.code ?? "";
  const causeStr = String(cause ?? err ?? "") + " " + String(causeCode);
  const matchedCode = causeCode || (typeof cause === "string" ? cause : "");
  const code = matchedCode;

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(causeStr)) {
    return { type: "dns", description: "DNS resolution failed, check DNS configuration", ...(code ? { code } : {}) };
  }
  if (/ECONNREFUSED/i.test(causeStr)) {
    return { type: "tcp", description: "TCP connection refused", ...(code ? { code } : {}) };
  }
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(causeStr)) {
    return { type: "tcp", description: "TCP connection timeout or unreachable", ...(code ? { code } : {}) };
  }
  if (/UND_ERR_SOCKET|SSL|TLS|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(causeStr)) {
    return { type: "tls", description: "TLS handshake error", ...(code ? { code } : {}) };
  }

  return { type: "unknown", description: "network request failed" };
}

/**
 * Combine an internal timeout controller with an optional external abort signal.
 * This lets the monitor cancel an in-flight long-poll immediately when the
 * channel stops, instead of waiting for the server-side long-poll timeout.
 */
function combineAbortSignals(params: { internal?: AbortController; external?: AbortSignal }): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const { internal, external } = params;
  if (!external) {
    return { signal: internal?.signal, cleanup: () => {} };
  }
  if (external.aborted) {
    internal?.abort();
    return { signal: internal?.signal, cleanup: () => {} };
  }
  const onExternalAbort = () => internal?.abort();
  external.addEventListener("abort", onExternalAbort, { once: true });
  return {
    signal: internal?.signal,
    cleanup: () => external.removeEventListener("abort", onExternalAbort),
  };
}

/**
 * GET fetch wrapper: send a GET request to a Weixin API endpoint.
 * When `timeoutMs` is set, the request is aborted after that many milliseconds.
 * Returns the raw response text on success; throws on HTTP error or timeout abort.
 */
export async function apiGetFetch(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
  label: string;
  appId?: string;
  clientVersion?: number;
  routeTag?: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildCommonHeaders(params);

  const timeoutMs = params.timeoutMs;
  const controller = timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const t = controller != null && timeoutMs != null ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: hdrs,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  }
}

/**
 * Common fetch wrapper: POST JSON to a Weixin API endpoint.
 * Returns the raw response text on success; throws on HTTP error or timeout.
 */
export async function apiPostFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs?: number;
  label: string;
  abortSignal?: AbortSignal;
  appId?: string;
  clientVersion?: number;
  channelVersion?: string;
  botAgent?: string;
  routeTag?: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders(params);

  const controller = params.timeoutMs !== undefined ? new AbortController() : undefined;
  const t = controller != null && params.timeoutMs !== undefined ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined;
  const { signal, cleanup } = combineAbortSignals({
    internal: controller,
    external: params.abortSignal,
  });
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      ...(signal ? { signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  } finally {
    cleanup();
  }
}

const LOSSLESS_ID_FIELDS = new Set(["message_id", "msg_id", "svr_id"]);

/**
 * Quote uint64 message identifiers before JSON.parse sees them. This scanner
 * only rewrites actual object properties, never matching text inside JSON strings.
 */
export function parseWeixinApiJson<T>(rawText: string): T {
  let output = "";
  let index = 0;
  while (index < rawText.length) {
    if (rawText[index] !== '"') {
      output += rawText[index++];
      continue;
    }

    const stringStart = index;
    index++;
    let escaped = false;
    while (index < rawText.length) {
      const char = rawText[index++];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        break;
      }
    }
    const stringToken = rawText.slice(stringStart, index);
    output += stringToken;

    let cursor = index;
    while (/\s/.test(rawText[cursor] ?? "")) cursor++;
    if (rawText[cursor] !== ":") continue;

    let key: unknown;
    try {
      key = JSON.parse(stringToken);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !LOSSLESS_ID_FIELDS.has(key)) continue;

    output += rawText.slice(index, cursor + 1);
    cursor++;
    while (/\s/.test(rawText[cursor] ?? "")) {
      cursor++;
    }
    const numberStart = cursor;
    if (rawText[cursor] === "-") cursor++;
    while (/\d/.test(rawText[cursor] ?? "")) cursor++;
    if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === "-")) {
      output += `"${rawText.slice(numberStart, cursor)}"`;
      index = cursor;
    } else {
      index = numberStart;
    }
  }
  return JSON.parse(output) as T;
}

/**
 * Long-poll getUpdates. Server should hold the request until new messages or timeout.
 *
 * On client-side timeout, returns an empty response with ret=0 so the caller
 * can simply retry. This is normal for long-poll.
 */
export async function getUpdates(
  params: GetUpdatesReq & WeixinApiOptions,
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? "",
        base_info: buildBaseInfo(params),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: "getUpdates",
      abortSignal: params.abortSignal,
      appId: params.appId,
      clientVersion: params.clientVersion,
      channelVersion: params.channelVersion,
      botAgent: params.botAgent,
      routeTag: params.routeTag,
    });
    return parseWeixinApiJson<GetUpdatesResp>(rawText);
  } catch (err) {
    // Long-poll timeout or external abort are both normal control-flow exits.
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw err;
  }
}

/** Send a single message downstream and return the server-assigned message ID. */
export async function sendMessage(
  params: SendMessageReq & WeixinApiOptions,
): Promise<SendMessageResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg: params.msg,
      base_info: buildBaseInfo(params),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
    appId: params.appId,
    clientVersion: params.clientVersion,
    channelVersion: params.channelVersion,
    botAgent: params.botAgent,
    routeTag: params.routeTag,
  });
  return parseWeixinApiJson<SendMessageResp>(rawText);
}

/** Get account configuration (currently only the typing ticket). */
export async function getConfig(
  params: { ilink_user_id?: string; context_token?: string } & WeixinApiOptions,
): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilink_user_id,
      context_token: params.context_token,
      base_info: buildBaseInfo(params),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
    appId: params.appId,
    clientVersion: params.clientVersion,
    channelVersion: params.channelVersion,
    botAgent: params.botAgent,
    routeTag: params.routeTag,
  });
  return parseWeixinApiJson<GetConfigResp>(rawText);
}

/** Set or cancel the typing indicator for a user. */
export async function sendTyping(
  params: SendTypingReq & WeixinApiOptions,
): Promise<SendTypingResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({
      ilink_user_id: params.ilink_user_id,
      typing_ticket: params.typing_ticket,
      status: params.status,
      base_info: buildBaseInfo(params),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
    appId: params.appId,
    clientVersion: params.clientVersion,
    channelVersion: params.channelVersion,
    botAgent: params.botAgent,
    routeTag: params.routeTag,
  });
  return parseWeixinApiJson<SendTypingResp>(rawText);
}

/** Notify the backend that the channel client started. */
export async function notifyStart(params: WeixinApiOptions): Promise<NotifyStartResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/msg/notifystart",
    body: JSON.stringify({ base_info: buildBaseInfo(params) }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStart",
    appId: params.appId,
    clientVersion: params.clientVersion,
    channelVersion: params.channelVersion,
    botAgent: params.botAgent,
    routeTag: params.routeTag,
  });
  return parseWeixinApiJson<NotifyStartResp>(rawText);
}

/** Notify the backend that the channel client stopped. */
export async function notifyStop(params: WeixinApiOptions): Promise<NotifyStopResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/msg/notifystop",
    body: JSON.stringify({ base_info: buildBaseInfo(params) }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStop",
    appId: params.appId,
    clientVersion: params.clientVersion,
    channelVersion: params.channelVersion,
    botAgent: params.botAgent,
    routeTag: params.routeTag,
  });
  return parseWeixinApiJson<NotifyStopResp>(rawText);
}
