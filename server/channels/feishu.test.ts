import { describe, expect, it, vi, beforeEach } from "vitest";

const getChannelBinding = vi.fn();
const getPersonaById = vi.fn();
const handleChannelChat = vi.fn();
const handleCommand = vi.fn();
const getActivePersonaId = vi.fn();

const getChannelDefaultPersona = vi.fn();
const getUserLocale = vi.fn();

vi.mock("../db", () => ({
  getChannelBinding: (...a: unknown[]) => getChannelBinding(...a),
  getChannelDefaultPersona: (...a: unknown[]) => getChannelDefaultPersona(...a),
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./bridge", () => ({
  handleChannelChat: (...a: unknown[]) => handleChannelChat(...a),
}));

vi.mock("./commands", () => ({
  handleCommand: (...a: unknown[]) => handleCommand(...a),
  getActivePersonaId: (...a: unknown[]) => getActivePersonaId(...a),
}));

import { extractMessageText, handleFeishuEvent } from "./feishu";

describe("extractMessageText", () => {
  it("reads the text out of the JSON content field", () => {
    const text = extractMessageText({
      message_type: "text",
      content: JSON.stringify({ text: "在吗" }),
    });
    expect(text).toBe("在吗");
  });

  it("returns null for a non-text message", () => {
    expect(extractMessageText({ message_type: "image", content: "{}" })).toBeNull();
  });

  it("returns null when the content is missing", () => {
    expect(extractMessageText({ message_type: "text" })).toBeNull();
  });

  it("returns null when the content is not valid JSON", () => {
    expect(extractMessageText({ message_type: "text", content: "not json" })).toBeNull();
  });

  it("returns null when the JSON has no text field", () => {
    expect(extractMessageText({ message_type: "text", content: "{}" })).toBeNull();
  });
});

describe("handleFeishuEvent", () => {
  beforeEach(() => {
    getChannelBinding.mockReset();
    getPersonaById.mockReset();
    handleChannelChat.mockReset();
    handleCommand.mockReset();
    getActivePersonaId.mockReset();
    getChannelDefaultPersona.mockReset();
    getUserLocale.mockReset();
    getUserLocale.mockResolvedValue("zh");
    // The channel's own choice, unless a test says otherwise.
    getChannelDefaultPersona.mockResolvedValue(undefined);

    getChannelBinding.mockResolvedValue({ personaId: 7 });
    getPersonaById.mockResolvedValue({ id: 7, graduationStatus: null });
    getActivePersonaId.mockReturnValue(7);
    handleCommand.mockResolvedValue({ handled: false });
    handleChannelChat.mockResolvedValue("在的。");
  });

  it("sends the persona's reply back to the chat", async () => {
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).toHaveBeenCalled();
    expect(sent).toContain("在的。");
  });

  it("does not answer the bot's own message", async () => {
    // Feishu delivers the app's own messages back into the same event
    // stream. So the bot answered itself — and the answer came back,
    // and was answered too. An endless loop of model calls, at the
    // user's expense.
    const sendText = vi.fn();

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在的。" }) },
        sender: { sender_id: { open_id: "ou_bot" }, sender_type: "app" },
      },
      botOpenId: "ou_bot",
      sendText,
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("does not answer a message the bot itself sent", async () => {
    // The sender type was not always there — so the bot's own open id
    // is the second line of defence.
    const sendText = vi.fn();

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在的。" }) },
        sender: { sender_id: { open_id: "ou_bot" } },
      },
      botOpenId: "ou_bot",
      sendText,
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("still answers a person", async () => {
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
        sender: { sender_id: { open_id: "ou_person" }, sender_type: "user" },
      },
      botOpenId: "ou_bot",
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).toHaveBeenCalled();
    expect(sent).toContain("在的。");
  });

  it("ignores a group conversation", async () => {
    const sendText = vi.fn();
    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "group",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText,
    });
    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("ignores an event with no chat id", async () => {
    const sendText = vi.fn();
    await handleFeishuEvent({
      userId: 1,
      event: { message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) } },
      sendText,
    });
    expect(handleChannelChat).not.toHaveBeenCalled();
  });

  it("tells the user to pick a persona when nothing is bound", async () => {
    getChannelBinding.mockResolvedValue(undefined);
    getChannelDefaultPersona.mockResolvedValue(undefined);
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sent.join("\n")).toContain("默认分身");
  });

  it("lets a slash command short-circuit the conversation", async () => {
    handleCommand.mockResolvedValue({ handled: true, reply: "已切换到 小A。" });
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "/使用 小A" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sent).toContain("已切换到 小A。");
  });

  it("does not add a second note about the graduation ritual", async () => {
    // The bridge owns the note. It used to be added here as well, so the
    // user received two instructions to type "/毕业" at the end of one
    // message.
    getPersonaById.mockResolvedValue({ id: 7, graduationStatus: "suggested" });
    const sent: string[] = [];

    await handleFeishuEvent({
      userId: 1,
      event: {
        chat_id: "oc_abc",
        chat_type: "p2p",
        message: { message_type: "text", content: JSON.stringify({ text: "在吗" }) },
      },
      sendText: async (_target, text) => {
        sent.push(text);
      },
    });

    expect(sent[0]).toBe("在的。");
    expect(sent[0]).not.toContain("/毕业");
  });
});
