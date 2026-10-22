/**
 * Weixin iLink QR-code login.
 *
 * Ported from the official Tencent plugin `@tencent-weixin/openclaw-weixin`
 * (MIT licensed, Copyright (C) 2026 Tencent), file `src/auth/login-qr.ts`.
 *
 * The upstream implementation is a CLI flow: it prints to stdout and reads the
 * verification code from stdin. Mirrai drives the same protocol from a web UI,
 * so this port keeps the protocol identical but turns the flow into a pure
 * state machine:
 *   - `startQrLogin` fetches a QR code and returns it to the caller.
 *   - `pollQrLogin` performs a single status poll and returns the new state.
 *   - The caller decides what to do next (re-poll, refresh, ask for a code).
 *
 * The verification code required by the `need_verifycode` status is passed in
 * by the caller and carried on the next poll.
 */
import { apiGetFetch, apiPostFetch, type WeixinApiOptions } from "./client";

/** Default `bot_type` for ilink get_bot_qrcode / get_qrcode_status. */
export const DEFAULT_ILINK_BOT_TYPE = "3";

/** Fixed API base URL for all QR code requests. */
export const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";

/** Client-side timeout for the long-poll get_qrcode_status request. */
export const QR_LONG_POLL_TIMEOUT_MS = 35_000;

export type QrLoginStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "need_verifycode"
  | "verify_code_blocked"
  | "scaned_but_redirect"
  | "binded_redirect";

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface StatusResponse {
  status: QrLoginStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  /** The user ID of the person who scanned the QR code. */
  ilink_user_id?: string;
  /** New host to redirect polling to when status is scaned_but_redirect. */
  redirect_host?: string;
}

export type StartQrLoginResult = {
  ok: boolean;
  qrcode?: string;
  /** Content to render as a QR code (an image URL or payload). */
  qrcodeImgContent?: string;
  /** Polling base URL; may change on an IDC redirect. */
  baseUrl: string;
  message: string;
};

export type PollQrLoginResult = {
  status: QrLoginStatus;
  /** Populated when status is "confirmed". */
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  /** Populated when status is "scaned_but_redirect". */
  redirectHost?: string;
  /** True when the bot was already bound to this instance. */
  alreadyConnected: boolean;
  message: string;
};

/** Fetch a QR code for the login flow. */
export async function fetchQRCode(
  apiBaseUrl: string,
  botType: string,
  localTokenList: string[] = [],
): Promise<QRCodeResponse> {
  const rawText = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: localTokenList.slice(0, 10) }),
    label: "fetchQRCode",
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

/**
 * Poll the QR code status once.
 *
 * A network error or gateway timeout is treated as "wait" so the caller simply
 * polls again — matching the upstream behaviour.
 */
export async function pollQRStatus(params: {
  apiBaseUrl: string;
  qrcode: string;
  verifyCode?: string;
  appId?: string;
  clientVersion?: number;
  routeTag?: string;
}): Promise<StatusResponse> {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`;
  if (params.verifyCode) {
    endpoint += `&verify_code=${encodeURIComponent(params.verifyCode)}`;
  }
  try {
    const rawText = await apiGetFetch({
      baseUrl: params.apiBaseUrl,
      endpoint,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
      appId: params.appId,
      clientVersion: params.clientVersion,
      routeTag: params.routeTag,
    });
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    // Gateway timeout or other network error: treat as waiting and retry.
    return { status: "wait" };
  }
}

/**
 * Starts a login attempt by requesting a QR code.
 */
export async function startQrLogin(params: {
  baseUrl?: string;
  botType?: string;
  localTokenList?: string[];
  apiOptions?: WeixinApiOptions;
}): Promise<StartQrLoginResult> {
  const baseUrl = params.baseUrl ?? FIXED_BASE_URL;
  const botType = params.botType || DEFAULT_ILINK_BOT_TYPE;

  try {
    const qrResponse = await fetchQRCode(baseUrl, botType, params.localTokenList ?? []);
    return {
      ok: true,
      qrcode: qrResponse.qrcode,
      qrcodeImgContent: qrResponse.qrcode_img_content,
      baseUrl,
      message: "用手机微信扫描以下二维码，以继续连接：",
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      message: `Failed to start login: ${String(err)}`,
    };
  }
}

/**
 * Polls the QR status once and maps it to a caller-facing result.
 */
export async function pollQrLogin(params: {
  qrcode: string;
  baseUrl: string;
  verifyCode?: string;
  apiOptions?: WeixinApiOptions;
}): Promise<PollQrLoginResult> {
  const statusResponse = await pollQRStatus({
    apiBaseUrl: params.baseUrl,
    qrcode: params.qrcode,
    verifyCode: params.verifyCode,
    appId: params.apiOptions?.appId,
    clientVersion: params.apiOptions?.clientVersion,
    routeTag: params.apiOptions?.routeTag,
  });

  const status = statusResponse.status ?? "wait";

  switch (status) {
    case "wait":
      return { status, alreadyConnected: false, message: "等待扫码..." };
    case "scaned":
      return { status, alreadyConnected: false, message: "已扫码，请在手机上确认" };
    case "need_verifycode":
      return {
        status,
        alreadyConnected: false,
        message: "请输入手机微信显示的数字，以继续连接",
      };
    case "expired":
      return { status, alreadyConnected: false, message: "二维码已过期，请重新生成" };
    case "verify_code_blocked":
      return {
        status,
        alreadyConnected: false,
        message: "多次输入错误，请稍后再试",
      };
    case "scaned_but_redirect":
      return {
        status,
        alreadyConnected: false,
        redirectHost: statusResponse.redirect_host,
        message: statusResponse.redirect_host
          ? "正在切换连接节点..."
          : "正在切换连接节点...",
      };
    case "binded_redirect":
      return {
        status,
        alreadyConnected: true,
        message: "已连接过此实例，无需重复连接",
      };
    case "confirmed": {
      if (!statusResponse.ilink_bot_id) {
        return {
          status,
          alreadyConnected: false,
          message: "登录失败：服务器未返回 ilink_bot_id。",
        };
      }
      return {
        status,
        alreadyConnected: false,
        botToken: statusResponse.bot_token,
        accountId: statusResponse.ilink_bot_id,
        baseUrl: statusResponse.baseurl,
        userId: statusResponse.ilink_user_id,
        message: "已连接微信。",
      };
    }
    default:
      return { status: "wait", alreadyConnected: false, message: "等待扫码..." };
  }
}
