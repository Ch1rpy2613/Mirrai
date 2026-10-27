import { describe, expect, it, vi, beforeEach } from "vitest";

const getWechatBindingByUserId = vi.fn();
const getPersonaById = vi.fn();
const handleCommand = vi.fn();
const handlePersonaChat = vi.fn();
const sendWeixinText = vi.fn();
const getUserLocale = vi.fn();
const getChannelDefaultPersona = vi.fn();
const getUserById = vi.fn();

vi.mock("../db", () => ({
  getWechatBindingByUserId: (...a: unknown[]) => getWechatBindingByUserId(...a),
  getChannelDefaultPersona: (...a: unknown[]) => getChannelDefaultPersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
}));

vi.mock("./commands", () => ({
  getActivePersonaId: (wechatUserId: string, defaultPersonaId: number) => defaultPersonaId,
  handleCommand: (...a: unknown[]) => handleCommand(...a),
}));

vi.mock("./persona-bridge", () => ({
  handlePersonaChat: (...a: unknown[]) => handlePersonaChat(...a),
}));

vi.mock("./bot", () => ({
  sendWeixinText: (...a: unknown[]) => sendWeixinText(...a),
}));

import { handleWeixinMessage } from "./message-handler";

const parsed = {
  fromUserId: "wx-user-1",
  contextToken: "ctx-1",
  messageId: "m-1",
  text: "在吗",
  isVoiceTranscript: false,
  createTimeMs: 1,
  isGroup: false,
};

beforeEach(() => {
  getWechatBindingByUserId.mockReset();
  getPersonaById.mockReset();
  handleCommand.mockReset();
  handlePersonaChat.mockReset();
  sendWeixinText.mockReset();
  getUserLocale.mockReset();
  getChannelDefaultPersona.mockReset();
  getUserById.mockReset();
  // The channel's own choice, unless a test says otherwise.
  getChannelDefaultPersona.mockResolvedValue(undefined);

  getUserLocale.mockResolvedValue("zh");
  // The account is still there.
  getUserById.mockResolvedValue({ id: 1, username: "user-1" });
  getWechatBindingByUserId.mockResolvedValue({ id: 1, personaId: 7, wechatUserId: "wx-user-1" });
  getPersonaById.mockResolvedValue({ id: 7, graduationStatus: null });
  handleCommand.mockResolvedValue({ handled: false });
  handlePersonaChat.mockResolvedValue("我在呢");
  sendWeixinText.mockResolvedValue(true);
});

describe("handleWeixinMessage", () => {
  it("says nothing to an account that has been deleted", async () => {
    /**
     * The channels are stopped when an account is deleted — but a
     * message that was already on its way still arrives, and the bot
     * answered it for an account that no longer existed: it told the
     * person to go and set a persona in the web app, and wrote a row
     * whose user id no longer had a user.
     */
    getUserById.mockResolvedValue(null);

    await handleWeixinMessage(1, parsed);

    expect(sendWeixinText).not.toHaveBeenCalled();
    expect(handlePersonaChat).not.toHaveBeenCalled();
  });

  it("routes a normal message to the persona and replies", async () => {
    await handleWeixinMessage(1, parsed);
    expect(handlePersonaChat).toHaveBeenCalledWith(expect.objectContaining({ personaId: 7, messageText: "在吗" }));
    expect(sendWeixinText).toHaveBeenCalledWith(1, "wx-user-1", "我在呢", "ctx-1");
  });

  it("ignores group conversations", async () => {
    await handleWeixinMessage(1, { ...parsed, isGroup: true });
    expect(handlePersonaChat).not.toHaveBeenCalled();
  });

  it("ignores empty messages", async () => {
    await handleWeixinMessage(1, { ...parsed, text: "   " });
    expect(handlePersonaChat).not.toHaveBeenCalled();
  });

  it("asks the user to set a default persona when nothing is bound", async () => {
    getWechatBindingByUserId.mockResolvedValue(undefined);
    await handleWeixinMessage(1, parsed);
    expect(handlePersonaChat).not.toHaveBeenCalled();
    expect(sendWeixinText).toHaveBeenCalledWith(1, "wx-user-1", expect.stringContaining("还没有设置默认分身"), "ctx-1");
  });

  it("returns the command reply without calling the LLM", async () => {
    handleCommand.mockResolvedValue({ handled: true, reply: "已切换到 小B。" });
    await handleWeixinMessage(1, { ...parsed, text: "/使用 小B" });
    expect(handlePersonaChat).not.toHaveBeenCalled();
    expect(sendWeixinText).toHaveBeenCalledWith(1, "wx-user-1", "已切换到 小B。", "ctx-1");
  });

  it("does not add a second note about the graduation ritual", async () => {
    // The bridge owns the note. It used to be added here as well, so the
    // user received two instructions to type "/毕业" at the end of one
    // message — and it was hard-coded Chinese, so an English user was
    // told to type a Chinese command.
    getPersonaById.mockResolvedValue({ id: 7, graduationStatus: "suggested" });
    await handleWeixinMessage(1, parsed);
    const sent = sendWeixinText.mock.calls[0];
    expect(sent[2]).toContain("我在呢");
    expect(sent[2]).not.toContain("/毕业");
  });

  it("does not append the hint when graduation was not suggested", async () => {
    await handleWeixinMessage(1, parsed);
    expect(sendWeixinText.mock.calls[0][2]).toBe("我在呢");
  });

  it("sends nothing when the persona produces no reply", async () => {
    handlePersonaChat.mockResolvedValue(null);
    await handleWeixinMessage(1, parsed);
    expect(sendWeixinText).not.toHaveBeenCalled();
  });
});
