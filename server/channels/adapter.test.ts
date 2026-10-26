/**
 * Tests for the channel adapter layer.
 *
 * The WeChat and Feishu channels must expose the same interface and drive the
 * same conversation logic; the WeChat behaviour must not change, so the
 * WeChat assertions mirror what the WeChat path did before the adapters were
 * introduced.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const getWechatBindingsByUserId = vi.fn();
const setWechatBindingPersona = vi.fn();
const getChannelState = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const setChannelBindingPersona = vi.fn();
const upsertChannelState = vi.fn();
const getPersonasByUserId = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getUserTimezone = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();

const getBotStatus = vi.fn();
const startWeChatBot = vi.fn();
const stopWeChatBot = vi.fn();
const restoreWeChatBot = vi.fn();
const sendWeixinText = vi.fn();

const decryptSecret = vi.fn();
const encryptSecret = vi.fn();

const handleChannelChat = vi.fn();
const invoke = vi.fn();

// The mock paths must resolve to the same modules the adapters import
// ("../db", "../wechat/bot", "../_core/crypto" and "./bridge" from
// server/channels/).
vi.mock("../db", () => ({
  getWechatBindingsByUserId: (...a: unknown[]) => getWechatBindingsByUserId(...a),
  setWechatBindingPersona: (...a: unknown[]) => setWechatBindingPersona(...a),
  getChannelState: (...a: unknown[]) => getChannelState(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  setChannelBindingPersona: (...a: unknown[]) => setChannelBindingPersona(...a),
  upsertChannelState: (...a: unknown[]) => upsertChannelState(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
}));

vi.mock("../wechat/bot", () => ({
  getBotStatus: (...a: unknown[]) => getBotStatus(...a),
  startWeChatBot: (...a: unknown[]) => startWeChatBot(...a),
  stopWeChatBot: (...a: unknown[]) => stopWeChatBot(...a),
  restoreWeChatBot: (...a: unknown[]) => restoreWeChatBot(...a),
  sendWeixinText: (...a: unknown[]) => sendWeixinText(...a),
}));

vi.mock("../_core/crypto", () => ({
  decryptSecret: (...a: unknown[]) => decryptSecret(...a),
  encryptSecret: (...a: unknown[]) => encryptSecret(...a),
}));

// The bridge pulls in the whole conversation service; the adapters only use
// it to answer an inbound message, which these tests do not exercise.
vi.mock("./bridge", () => ({
  handleChannelChat: (...a: unknown[]) => handleChannelChat(...a),
}));

vi.mock("../llm", () => ({
  llmService: { invoke: (...a: unknown[]) => invoke(...a) },
}));

/**
 * The provider resolution.
 *
 * The ownership matters: the environment-configured provider is the
 * operator's account, and it may only be used when the user has no
 * provider of their own.
 */
const resolveProviderForUser = vi.fn();
vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForUserWithOwnership: async (params: unknown) => {
    const provider = await resolveProviderForUser(params as any);
    return { provider, owned: Boolean(provider) };
  },
}));

import type { ChannelAdapter } from "./types";
import { wechatAdapter } from "./wechat";
import { feishuAdapter } from "./feishu";
import { clearAllActivePersonas, getActivePersonaId, handleCommand } from "./commands";
import { handleCommand as handleWechatCommand } from "../wechat/commands";

const WECHAT_KEY = "wx-conversation-1";
const FEISHU_KEY = "oc_chat_1";
const LETTER = "亲爱的，这是一封告别信。";

const personas = [
  {
    id: 1,
    name: "小A",
    analysisStatus: "ready",
    intimacyLevel: "灵魂伴侣",
    graduationStatus: null,
    chatCount: 100,
    farewellLetter: null,
    llmProvider: null,
  },
  {
    id: 2,
    name: "小B",
    analysisStatus: "ready",
    intimacyLevel: "初识",
    graduationStatus: null,
    chatCount: 3,
    farewellLetter: null,
    llmProvider: null,
  },
] as any[];

const ADAPTER_METHODS = ["start", "stop", "status", "send", "setDefaultPersona"] as const;

beforeEach(() => {
  for (const fn of [
    getWechatBindingsByUserId, setWechatBindingPersona, getChannelState,
    getChannelBindingsByUserId, setChannelBindingPersona, upsertChannelState,
    getPersonasByUserId, getRecentEmotionTrend, getMessageCountInRange,
    setGraduationStatus, getBotStatus, startWeChatBot, stopWeChatBot,
    restoreWeChatBot, sendWeixinText, decryptSecret, encryptSecret,
    handleChannelChat, invoke,
  ]) {
    fn.mockReset();
  }

  clearAllActivePersonas();

  invoke.mockResolvedValue(LETTER);
  // The real `sendWeixinText` reports success as a boolean.
  sendWeixinText.mockResolvedValue(true);
  getPersonasByUserId.mockResolvedValue(personas);
  getRecentEmotionTrend.mockResolvedValue([]);
  getUserTimezone.mockResolvedValue("Asia/Shanghai");
  getMessageCountInRange.mockResolvedValue(0);
  getWechatBindingsByUserId.mockResolvedValue([]);
  getChannelBindingsByUserId.mockResolvedValue([]);
  getChannelState.mockResolvedValue(undefined);
  getBotStatus.mockReturnValue({
    status: "stopped",
    qrCodeUrl: null,
    loggedInUser: null,
    lastError: null,
    needsVerifyCode: false,
  });
});

describe("channel adapter interface", () => {
  it("exposes the same interface on both channels", () => {
    const adapters: ChannelAdapter[] = [wechatAdapter, feishuAdapter];

    for (const adapter of adapters) {
      expect(typeof adapter.id).toBe("string");
      expect(adapter.label.length).toBeGreaterThan(0);
      expect(typeof adapter.requiresCredentials).toBe("boolean");
      for (const method of ADAPTER_METHODS) {
        expect(typeof adapter[method]).toBe("function");
      }
    }
  });

  it("gives each channel its own id and credential requirement", () => {
    expect(wechatAdapter.id).toBe("wechat");
    expect(feishuAdapter.id).toBe("feishu");
    expect(wechatAdapter.requiresCredentials).toBe(false);
    expect(feishuAdapter.requiresCredentials).toBe(true);
  });
});

describe("wechat adapter", () => {
  it("reports the bot status as connected once it is logged in", async () => {
    getBotStatus.mockReturnValue({
      status: "logged_in",
      qrCodeUrl: "https://example.test/qr.png",
      loggedInUser: "wx-1",
      lastError: null,
      needsVerifyCode: false,
    });

    const status = await wechatAdapter.status(1);

    expect(status.channel).toBe("wechat");
    expect(status.connected).toBe(true);
    expect(status.status).toBe("logged_in");
    expect(status.detail?.qrCodeUrl).toBe("https://example.test/qr.png");
  });

  it("reports a stopped bot as not connected", async () => {
    getBotStatus.mockReturnValue({
      status: "stopped",
      qrCodeUrl: null,
      loggedInUser: null,
      lastError: null,
      needsVerifyCode: false,
    });

    const status = await wechatAdapter.status(1);

    expect(status.connected).toBe(false);
    expect(status.status).toBe("stopped");
  });

  it("binds the persona to the conversation it found for the user", async () => {
    getWechatBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        wechatUserId: WECHAT_KEY,
        personaId: 1,
        wechatName: null,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await wechatAdapter.setDefaultPersona(1, 2);

    // The same arguments the WeChat path used before the adapter existed.
    expect(setWechatBindingPersona).toHaveBeenCalledWith({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      personaId: 2,
    });
  });

  it("refuses to bind a persona when no conversation is bound", async () => {
    getWechatBindingsByUserId.mockResolvedValue([]);

    await expect(wechatAdapter.setDefaultPersona(1, 2)).rejects.toThrow(
      "还没有绑定任何微信会话。",
    );
    expect(setWechatBindingPersona).not.toHaveBeenCalled();
  });

  it("starts and stops the bot", async () => {
    await wechatAdapter.start(1);
    expect(startWeChatBot).toHaveBeenCalledWith(1);

    await wechatAdapter.stop(1);
    expect(stopWeChatBot).toHaveBeenCalledWith(1);
  });

  it("sends a message through the bot", async () => {
    await wechatAdapter.send(1, WECHAT_KEY, "你好");

    expect(sendWeixinText).toHaveBeenCalledWith(1, WECHAT_KEY, "你好");
  });

  it("reports a failed send instead of pretending it worked", async () => {
    // `sendWeixinText` returns false when the bot is not logged in. The
    // adapter has to surface that, or the caller records a message as
    // delivered when nothing was sent.
    sendWeixinText.mockResolvedValue(false);

    await expect(
      wechatAdapter.send(1, WECHAT_KEY, "你好"),
    ).rejects.toThrow(/微信消息发送失败/);
  });
});

describe("feishu adapter", () => {
  it("reports connected only while a long connection is running", async () => {
    // The stored state claims the channel is connected, but no long
    // connection is actually running in this process.
    getChannelState.mockResolvedValue({
      userId: 1,
      channel: "feishu",
      status: "connected",
      credentialsEnc: "v1:whatever",
      lastError: null,
    });

    const status = await feishuAdapter.status(1);

    expect(status.channel).toBe("feishu");
    expect(status.connected).toBe(false);
    expect(status.status).toBe("connected");
  });

  it("reports a stopped channel when nothing is stored", async () => {
    getChannelState.mockResolvedValue(undefined);

    const status = await feishuAdapter.status(1);

    expect(status.connected).toBe(false);
    expect(status.status).toBe("stopped");
  });

  it("binds the persona to the conversation it found for the user", async () => {
    getChannelBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        channel: "feishu",
        targetId: FEISHU_KEY,
        personaId: 1,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await feishuAdapter.setDefaultPersona(1, 2);

    expect(setChannelBindingPersona).toHaveBeenCalledWith({
      userId: 1,
      channel: "feishu",
      targetId: FEISHU_KEY,
      personaId: 2,
    });
  });

  it("refuses to bind a persona when no conversation is bound", async () => {
    getChannelBindingsByUserId.mockResolvedValue([]);

    await expect(feishuAdapter.setDefaultPersona(1, 2)).rejects.toThrow(
      "还没有绑定任何飞书会话。",
    );
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });

  it("explains how to install the SDK instead of crashing when it is missing", async () => {
    getChannelState.mockResolvedValue({
      userId: 1,
      channel: "feishu",
      status: "configured",
      credentialsEnc: "v1:whatever",
      lastError: null,
    });
    decryptSecret.mockResolvedValue(JSON.stringify({ appId: "cli_x", appSecret: "secret" }));

    // The SDK is an optional dependency, and an install that never touches
    // Feishu does not have it. The failure has to be *simulated* — it used
    // to be simulated by the package simply not being in node_modules,
    // which meant the test passed for the wrong reason the moment
    // somebody ran a full install.
    vi.resetModules();
    vi.doMock("@larksuiteoapi/node-sdk", () => {
      throw new Error("Cannot find module '@larksuiteoapi/node-sdk'");
    });

    try {
      await expect(feishuAdapter.start(1)).rejects.toThrow(/pnpm install/);
    } finally {
      vi.doUnmock("@larksuiteoapi/node-sdk");
      vi.resetModules();
    }

    // The channel never claims to be connected after the failure.
    expect(upsertChannelState).not.toHaveBeenCalled();
  });
});

describe("shared commands", () => {
  it("switches the active persona on a WeChat conversation", async () => {
    const result = await handleWechatCommand({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("小B");
    expect(getActivePersonaId(WECHAT_KEY, 1)).toBe(2);
  });

  it("switches the active persona on a Feishu conversation", async () => {
    const result = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("小B");
    expect(getActivePersonaId(FEISHU_KEY, 1)).toBe(2);
  });

  it("keys the session override by the conversation id", async () => {
    await handleCommand({
      userId: 1,
      conversationKey: WECHAT_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });

    expect(getActivePersonaId(WECHAT_KEY, 1)).toBe(2);
    // The other channel's conversation is untouched.
    expect(getActivePersonaId(FEISHU_KEY, 1)).toBe(1);
  });

  it("lists the same personas on both channels", async () => {
    await handleCommand({
      userId: 1,
      conversationKey: WECHAT_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });

    const wechatReply = await handleWechatCommand({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      text: "/分身列表",
      defaultPersonaId: 1,
    });
    const feishuReply = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/分身列表",
      defaultPersonaId: 1,
    });

    expect(wechatReply.reply).toContain("- 小A");
    expect(wechatReply.reply).toContain("- 小B");
    expect(feishuReply.reply).toContain("- 小A");
    expect(feishuReply.reply).toContain("- 小B");
    // The current marker follows the conversation's own override.
    expect(wechatReply.reply).toContain("- 小B ← 当前");
    expect(feishuReply.reply).toContain("- 小A ← 当前");
  });

  it("reports the current persona per conversation", async () => {
    await handleCommand({
      userId: 1,
      conversationKey: WECHAT_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });

    const wechatReply = await handleWechatCommand({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      text: "/当前分身",
      defaultPersonaId: 1,
    });
    const feishuReply = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/当前分身",
      defaultPersonaId: 1,
    });

    expect(wechatReply.reply).toContain("小B");
    expect(feishuReply.reply).toContain("小A");
  });

  it("graduates through either channel and delivers the same letter", async () => {
    getRecentEmotionTrend.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ emotionalState: "happy" })),
    );
    getMessageCountInRange.mockResolvedValue(20);

    const wechatSent: string[] = [];
    const wechatResult = await handleWechatCommand({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      text: "/毕业",
      defaultPersonaId: 1,
      sendLetter: async (letter) => {
        wechatSent.push(letter);
        await wechatAdapter.send(1, WECHAT_KEY, letter);
        return true;
      },
    });

    const feishuSent: string[] = [];
    const feishuResult = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/毕业",
      defaultPersonaId: 1,
      sendLetter: async (letter) => {
        feishuSent.push(letter);
        return true;
      },
    });

    expect(wechatResult.handled).toBe(true);
    expect(feishuResult.handled).toBe(true);
    expect(wechatResult.reply).toBe(feishuResult.reply);
    expect(wechatSent).toEqual([LETTER]);
    expect(feishuSent).toEqual([LETTER]);
    expect(sendWeixinText).toHaveBeenCalledWith(1, WECHAT_KEY, LETTER);
    expect(setGraduationStatus).toHaveBeenCalledWith(
      1,
      1,
      "graduated",
      LETTER,
      expect.any(Boolean),
      undefined,
    );
  });

  it("keeps the WeChat wording of an undelivered farewell letter", async () => {
    // The WeChat channel has to behave exactly as it did before the channels
    // were unified — the message it shows the user is part of that.
    getRecentEmotionTrend.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ emotionalState: "happy" })),
    );
    getMessageCountInRange.mockResolvedValue(20);

    const wechatResult = await handleWechatCommand({
      userId: 1,
      wechatUserId: WECHAT_KEY,
      text: "/毕业",
      defaultPersonaId: 1,
      // The letter could not be delivered, so the user is told to read it on
      // the web.
      sendLetter: async () => false,
    });

    expect(wechatResult.reply).toContain(
      "（这封信已经保存了，如果微信没有显示，请在网页端查看。）",
    );

    // The other channel names itself instead of saying "微信".
    const feishuResult = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/毕业",
      defaultPersonaId: 1,
      sendLetter: async () => false,
    });
    expect(feishuResult.reply).toContain(
      "（这封信已经保存了，如果当前渠道没有显示，请在网页端查看。）",
    );
  });

  it("clears the session overrides when the WeChat channel stops", async () => {
    await handleCommand({
      userId: 1,
      conversationKey: WECHAT_KEY,
      text: "/使用 小B",
      defaultPersonaId: 1,
    });
    expect(getActivePersonaId(WECHAT_KEY, 1)).toBe(2);

    await wechatAdapter.stop(1);

    expect(getActivePersonaId(WECHAT_KEY, 1)).toBe(1);
  });

  it("refuses to graduate when the graduation mode is off", async () => {
    getPersonasByUserId.mockResolvedValue([
      { ...personas[0], graduationMode: "off" },
    ]);

    const result = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/毕业",
      defaultPersonaId: 1,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("毕业模式已关闭");
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("skips the thresholds when the graduation mode is manual", async () => {
    // 小B is nowhere near the thresholds — but in the manual mode the user
    // has already decided, so the thresholds do not apply.
    getPersonasByUserId.mockResolvedValue([
      { ...personas[1], graduationMode: "manual" },
    ]);

    const result = await handleCommand({
      userId: 1,
      conversationKey: FEISHU_KEY,
      text: "/毕业",
      defaultPersonaId: 2,
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain(LETTER);
    expect(setGraduationStatus).toHaveBeenCalledWith(
      2,
      1,
      "graduated",
      LETTER,
      expect.any(Boolean),
      undefined,
    );
  });
});
