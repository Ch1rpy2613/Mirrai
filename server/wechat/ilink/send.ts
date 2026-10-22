/**
 * Outbound Weixin message helpers.
 *
 * Adapted from the official Tencent plugin `@tencent-weixin/openclaw-weixin`
 * (MIT licensed, Copyright (C) 2026 Tencent), file `src/messaging/send.ts`.
 *
 * The upstream builds on the OpenClaw reply runtime; Mirrai sends plain text
 * directly, so only the message construction and the API call are kept.
 */
import { randomUUID } from "node:crypto";

import { sendMessage, type WeixinApiOptions } from "./client";
import { MessageItemType, MessageState, MessageType, type SendMessageResp } from "./types";

export type WeixinSendResult = { messageId: string; serverMessageId?: string; ret?: number };

function generateClientId(): string {
  return `mirrai-${randomUUID()}`;
}

/** Builds a SendMessage request containing a single text message. */
export function buildTextMessageReq(params: {
  to: string;
  text: string;
  contextToken?: string;
  runId?: string;
  clientId: string;
}): {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    item_list: Array<{ type: number; text_item: { text: string } }>;
    context_token?: string;
    run_id?: string;
  };
} {
  const { to, text, contextToken, runId, clientId } = params;
  const item_list = text
    ? [{ type: MessageItemType.TEXT, text_item: { text } }]
    : [];

  return {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list,
      context_token: contextToken ?? undefined,
      run_id: runId ?? undefined,
    },
  };
}

/**
 * Sends a plain text message downstream.
 *
 * The `context_token` from the inbound message must be passed back: the
 * protocol document states that replies should carry the inbound
 * conversation token.
 */
export async function sendTextMessage(params: {
  to: string;
  text: string;
  contextToken?: string;
  runId?: string;
  opts: WeixinApiOptions;
}): Promise<WeixinSendResult> {
  const clientId = generateClientId();
  const req = buildTextMessageReq({
    to: params.to,
    text: params.text,
    contextToken: params.contextToken,
    runId: params.runId,
    clientId,
  });

  const resp: SendMessageResp = await sendMessage({
    ...params.opts,
    msg: req.msg,
  });

  if (resp && typeof resp.ret === "number" && resp.ret !== 0) {
    throw new Error(`sendMessage failed: ret=${resp.ret} errmsg=${resp.errmsg ?? ""}`);
  }

  return {
    messageId: clientId,
    ...(resp?.message_id ? { serverMessageId: resp.message_id } : {}),
    ...(typeof resp?.ret === "number" ? { ret: resp.ret } : {}),
  };
}
