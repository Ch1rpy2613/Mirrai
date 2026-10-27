import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The WeChat monitor.
 *
 * It runs in the background for as long as the channel is connected,
 * and its promise is only waited for when the bot is stopped. So a
 * failure before the loop even starts sat there as an unhandled
 * rejection for as long as the app ran — and Node ends the process on
 * an unhandled rejection.
 */

const getWechatBotState = vi.fn();
const upsertWechatBotState = vi.fn();
const saveWechatSyncBuf = vi.fn();
const touchWechatLastInbound = vi.fn();

vi.mock("../db", () => ({
  getWechatBotState: (...a: unknown[]) => getWechatBotState(...a),
  upsertWechatBotState: (...a: unknown[]) => upsertWechatBotState(...a),
  saveWechatSyncBuf: (...a: unknown[]) => saveWechatSyncBuf(...a),
  touchWechatLastInbound: (...a: unknown[]) => touchWechatLastInbound(...a),
}));

import { startWeChatBot, stopWeChatBot } from "./bot";

describe("the WeChat monitor", () => {
  beforeEach(() => {
    getWechatBotState.mockReset();
    upsertWechatBotState.mockReset();
    saveWechatSyncBuf.mockReset();
    touchWechatLastInbound.mockReset();
    upsertWechatBotState.mockResolvedValue(1);
    // The database cannot be read — so the monitor fails before it
    // starts its loop.
    getWechatBotState.mockRejectedValue(new Error("the database is down"));
  });

  it("does not leave an unhandled rejection behind when it fails", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      startWeChatBot(42);
      // The failure is reported a turn later.
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await stopWeChatBot(42).catch(() => undefined);
    }

    expect(rejections).toEqual([]);
  });
});
