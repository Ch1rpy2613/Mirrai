import { describe, expect, it } from "vitest";
import { buildClientVersion, parseWeixinApiJson } from "./client";
import { extractTextBody, getWeixinMessageId, parseInboundMessage } from "./parse";
import { MessageItemType, MessageType } from "./types";

describe("parseWeixinApiJson", () => {
  it("preserves uint64 message ids exactly", () => {
    // 2^53 is where JSON.parse starts losing integer precision.
    const raw = '{"message_id": 18446744073709551615, "ret": 0}';
    const parsed = parseWeixinApiJson<{ message_id: string; ret: number }>(raw);
    expect(parsed.message_id).toBe("18446744073709551615");
    expect(parsed.ret).toBe(0);
  });

  it("preserves msg_id and svr_id", () => {
    const raw = '{"msgs":[{"msg_id": 9007199254740993, "svr_id": 9007199254740995}]}';
    const parsed = parseWeixinApiJson<{ msgs: Array<{ msg_id: string; svr_id: string }> }>(raw);
    expect(parsed.msgs[0].msg_id).toBe("9007199254740993");
    expect(parsed.msgs[0].svr_id).toBe("9007199254740995");
  });

  it("leaves ordinary numeric fields as numbers", () => {
    const parsed = parseWeixinApiJson<{ ret: number; count: number }>('{"ret":0,"count":42}');
    expect(parsed.ret).toBe(0);
    expect(parsed.count).toBe(42);
  });

  it("does not rewrite digits that appear inside string values", () => {
    const raw = '{"note":"id 18446744073709551615","ret":0}';
    const parsed = parseWeixinApiJson<{ note: string; ret: number }>(raw);
    expect(parsed.note).toBe("id 18446744073709551615");
  });

  it("handles nested message structures", () => {
    const raw = '{"msgs":[{"message_id": 18446744073709551615, "item_list":[{"msg_id": 1}]}]}';
    const parsed = parseWeixinApiJson<{ msgs: Array<{ message_id: string }> }>(raw);
    expect(parsed.msgs[0].message_id).toBe("18446744073709551615");
  });
});

describe("buildClientVersion", () => {
  it("encodes a version as 0x00MMNNPP", () => {
    expect(buildClientVersion("1.0.11")).toBe(0x0001000b);
    expect(buildClientVersion("2.4.10")).toBe(0x0002040a);
  });

  it("tolerates missing components", () => {
    expect(buildClientVersion("1.0")).toBe(0x00010000);
    expect(buildClientVersion("")).toBe(0);
  });
});

describe("extractTextBody", () => {
  it("extracts a text item", () => {
    const body = extractTextBody({
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "你好" } }],
    });
    expect(body).toEqual({ text: "你好", isVoice: false });
  });

  it("falls back to the voice transcript", () => {
    const body = extractTextBody({
      item_list: [{ type: MessageItemType.VOICE, voice_item: { text: "语音转写" } }],
    });
    expect(body).toEqual({ text: "语音转写", isVoice: true });
  });

  it("prefers text over a voice transcript when both are present", () => {
    const body = extractTextBody({
      item_list: [
        { type: MessageItemType.VOICE, voice_item: { text: "语音" } },
        { type: MessageItemType.TEXT, text_item: { text: "文字" } },
      ],
    });
    expect(body).toEqual({ text: "文字", isVoice: false });
  });

  it("returns nothing for a media-only message", () => {
    const body = extractTextBody({
      item_list: [{ type: MessageItemType.IMAGE, image_item: { mid_size: 1 } }],
    });
    expect(body.text).toBeUndefined();
  });

  it("ignores blank text", () => {
    const body = extractTextBody({
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "   " } }],
    });
    expect(body.text).toBeUndefined();
  });
});

describe("getWeixinMessageId", () => {
  it("prefers the top-level message id", () => {
    expect(getWeixinMessageId({ message_id: "111", item_list: [{ msg_id: "222" }] })).toBe("111");
  });

  it("falls back to the first item's msg id", () => {
    expect(getWeixinMessageId({ item_list: [{ msg_id: "222" }] })).toBe("222");
  });

  it("returns undefined when there is no id", () => {
    expect(getWeixinMessageId({})).toBeUndefined();
  });
});

describe("parseInboundMessage", () => {
  it("extracts the sender, text and context token", () => {
    const parsed = parseInboundMessage({
      from_user_id: "user-1",
      context_token: "ctx-1",
      message_id: "m-1",
      message_type: MessageType.USER,
      create_time_ms: 1700000000000,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "在吗" } }],
    });
    expect(parsed).toEqual({
      fromUserId: "user-1",
      contextToken: "ctx-1",
      messageId: "m-1",
      text: "在吗",
      isVoiceTranscript: false,
      createTimeMs: 1700000000000,
      isGroup: false,
    });
  });

  it("flags group conversations", () => {
    const parsed = parseInboundMessage({
      from_user_id: "user-1",
      group_id: "group-1",
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hi" } }],
    });
    expect(parsed?.isGroup).toBe(true);
  });

  it("returns null without a sender", () => {
    expect(parseInboundMessage({ item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hi" } }] })).toBeNull();
  });

  it("returns null for a message with no conversational payload", () => {
    expect(parseInboundMessage({ from_user_id: "user-1" })).toBeNull();
  });
});
