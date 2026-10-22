/**
 * Inbound Weixin message parsing.
 *
 * Adapted from the official Tencent plugin `@tencent-weixin/openclaw-weixin`
 * (MIT licensed, Copyright (C) 2026 Tencent), file `src/messaging/inbound.ts`.
 *
 * The upstream builds a full OpenClaw message context (session store, quote
 * resolution, media download). Mirrai only needs the conversational payload:
 * who is talking, what they said, and the context token required to reply.
 */
import { MessageItemType, type WeixinMessage } from "./types";

export interface ParsedInbound {
  /** The sender. In the ClawBot model this is the account owner's own id. */
  fromUserId: string;
  /** Conversation token that must be echoed back when replying. */
  contextToken?: string;
  /** Stable server message id, used for inbound de-duplication. */
  messageId?: string;
  /** Text body of the message, if any. */
  text?: string;
  /** True when the body came from a voice message transcript. */
  isVoiceTranscript: boolean;
  /** Server-side creation timestamp in milliseconds. */
  createTimeMs?: number;
  /** Whether the message came from a group conversation. */
  isGroup: boolean;
}

/**
 * Extracts the textual body of a message.
 *
 * Text items are used directly. Voice messages contribute their server-side
 * transcript (`voice_item.text`) when the backend supplied one — Mirrai does
 * not download or transcode audio in this iteration.
 */
export function extractTextBody(msg: WeixinMessage): { text?: string; isVoice: boolean } {
  const items = msg.item_list ?? [];

  for (const item of items) {
    if (item.type === MessageItemType.TEXT) {
      const text = item.text_item?.text;
      if (text != null && String(text).trim() !== "") {
        return { text: String(text), isVoice: false };
      }
    }
  }

  for (const item of items) {
    if (item.type === MessageItemType.VOICE) {
      const transcript = item.voice_item?.text;
      if (transcript != null && String(transcript).trim() !== "") {
        return { text: String(transcript), isVoice: true };
      }
    }
  }

  return { text: undefined, isVoice: false };
}

/** Returns the stable server message id used for de-duplication. */
export function getWeixinMessageId(msg: WeixinMessage): string | undefined {
  return msg.message_id || msg.item_list?.[0]?.msg_id || undefined;
}

/**
 * Converts a raw inbound message into the structure Mirrai consumes.
 *
 * Returns null when the message carries no conversational payload (for
 * example a media-only message, which this iteration does not handle).
 */
export function parseInboundMessage(msg: WeixinMessage): ParsedInbound | null {
  const fromUserId = msg.from_user_id ?? "";
  if (!fromUserId) return null;

  const { text, isVoice } = extractTextBody(msg);
  if (!text) return null;

  return {
    fromUserId,
    contextToken: msg.context_token,
    messageId: getWeixinMessageId(msg),
    text,
    isVoiceTranscript: isVoice,
    createTimeMs: msg.create_time_ms,
    isGroup: Boolean(msg.group_id),
  };
}
