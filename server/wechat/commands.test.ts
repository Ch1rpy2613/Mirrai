import { describe, expect, it, vi, beforeEach } from "vitest";

const getPersonasByUserId = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getUserTimezone = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();
const invoke = vi.fn();

// The mock paths must resolve to the same modules commands.ts imports
// ("../db" and "../llm" from server/wechat/ → server/db and server/llm).
vi.mock("../db", () => ({
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
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
vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => undefined,
  resolveProviderForUserWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
}));

import {
  clearAllActivePersonas,
  getActivePersonaId,
  handleCommand,
  matchPersonaByName,
  parseCommandLine,
} from "./commands";

const personas = [
  { id: 1, name: "小A", analysisStatus: "ready", intimacyLevel: "灵魂伴侣", graduationStatus: null, chatCount: 100, farewellLetter: null, llmProvider: null },
  { id: 2, name: "小B", analysisStatus: "ready", intimacyLevel: "初识", graduationStatus: null, chatCount: 3, farewellLetter: null, llmProvider: null },
  { id: 3, name: "老王", analysisStatus: "analyzing", intimacyLevel: "初识", graduationStatus: null, chatCount: 0, farewellLetter: null, llmProvider: null },
] as any[];

beforeEach(() => {
  getPersonasByUserId.mockReset();
  getRecentEmotionTrend.mockReset();
  getMessageCountInRange.mockReset();
  setGraduationStatus.mockReset();
  invoke.mockReset();
  clearAllActivePersonas();
  getPersonasByUserId.mockResolvedValue(personas);
  getRecentEmotionTrend.mockResolvedValue([]);
  getUserTimezone.mockResolvedValue("Asia/Shanghai");
  getMessageCountInRange.mockResolvedValue(0);
});

describe("parseCommandLine", () => {
  it("splits the command and its arguments", () => {
    expect(parseCommandLine("/使用 小A")).toEqual({ command: "/使用", args: "小A" });
  });

  it("handles a command without arguments", () => {
    expect(parseCommandLine("/分身列表")).toEqual({ command: "/分身列表", args: "" });
  });

  it("returns null for non-command text", () => {
    expect(parseCommandLine("你好")).toBeNull();
  });
});

describe("matchPersonaByName", () => {
  it("matches an exact name", () => {
    const result = matchPersonaByName(personas as any, "小A");
    expect(result.persona?.id).toBe(1);
  });

  it("matches a unique substring", () => {
    const result = matchPersonaByName(personas as any, "王");
    expect(result.persona?.id).toBe(3);
  });

  it("reports ambiguity instead of guessing", () => {
    const result = matchPersonaByName(personas as any, "小");
    expect(result.persona).toBeUndefined();
    expect(result.candidates).toEqual(["小A", "小B"]);
  });

  it("returns no match for an unknown name", () => {
    const result = matchPersonaByName(personas as any, "不存在");
    expect(result.persona).toBeUndefined();
    expect(result.candidates).toBeUndefined();
  });
});

describe("handleCommand", () => {
  it("ignores text that is not a command", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "在吗", defaultPersonaId: 1,
    });
    expect(result.handled).toBe(false);
  });

  it("ignores an unknown command", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/未知", defaultPersonaId: 1,
    });
    expect(result.handled).toBe(false);
  });

  it("switches the active persona", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/使用 小B", defaultPersonaId: 1,
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("小B");
    expect(getActivePersonaId("u1", 1)).toBe(2);
  });

  it("keeps the switch scoped to the conversation", async () => {
    await handleCommand({ userId: 1, wechatUserId: "u1", text: "/使用 小B", defaultPersonaId: 1 });
    expect(getActivePersonaId("u1", 1)).toBe(2);
    expect(getActivePersonaId("u2", 1)).toBe(1);
  });

  it("falls back to the default persona when nothing is switched", () => {
    expect(getActivePersonaId("u1", 1)).toBe(1);
  });

  it("lists the available personas", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/分身列表", defaultPersonaId: 1,
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("小A");
    expect(result.reply).toContain("当前");
  });

  it("reports the current persona", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/当前分身", defaultPersonaId: 2,
    });
    expect(result.reply).toContain("小B");
  });

  it("reports when no persona matches", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/使用 小C", defaultPersonaId: 1,
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("没有找到分身");
  });

  it("explains usage when /使用 has no argument", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/使用", defaultPersonaId: 1,
    });
    expect(result.reply).toContain("用法");
  });

  it("shows the help text", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/帮助", defaultPersonaId: 1,
    });
    expect(result.reply).toContain("/使用");
  });
});

describe("graduation command", () => {
  it("refuses when the user is not eligible yet", async () => {
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/毕业", defaultPersonaId: 2,
    });
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("还不是告别的时候");
    expect(setGraduationStatus).not.toHaveBeenCalled();
  });

  it("graduates and delivers the letter over WeChat when eligible", async () => {
    // 小A is already at 灵魂伴侣 with enough chats.
    getRecentEmotionTrend.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ emotionalState: "happy" })),
    );
    getMessageCountInRange.mockResolvedValue(20);
    invoke.mockResolvedValue("亲爱的，这是一封告别信。");

    const sent: string[] = [];
    const result = await handleCommand({
      userId: 1,
      wechatUserId: "u1",
      text: "/毕业",
      defaultPersonaId: 1,
      sendLetter: async (letter) => {
        sent.push(letter);
        return true;
      },
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("告别信");
    expect(sent).toEqual(["亲爱的，这是一封告别信。"]);
    expect(setGraduationStatus).toHaveBeenCalledWith(1, 1, "graduated", "亲爱的，这是一封告别信。");
  });

  it("degrades to a web hint when delivery fails", async () => {
    getRecentEmotionTrend.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ emotionalState: "happy" })),
    );
    getMessageCountInRange.mockResolvedValue(20);
    invoke.mockResolvedValue("告别信正文");

    const result = await handleCommand({
      userId: 1,
      wechatUserId: "u1",
      text: "/毕业",
      defaultPersonaId: 1,
      sendLetter: async () => false,
    });

    expect(result.reply).toContain("告别信正文");
    expect(result.reply).toContain("网页端");
    // The letter is still persisted even though delivery failed.
    expect(setGraduationStatus).toHaveBeenCalled();
  });

  it("returns the existing letter when already graduated", async () => {
    getPersonasByUserId.mockResolvedValue([
      { ...personas[0], graduationStatus: "graduated", farewellLetter: "旧的告别信" },
    ]);
    const result = await handleCommand({
      userId: 1, wechatUserId: "u1", text: "/毕业", defaultPersonaId: 1,
    });
    expect(result.reply).toContain("已经毕业");
    expect(result.reply).toContain("旧的告别信");
  });
});
