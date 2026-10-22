import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { getBotStatus } from "./bot";

beforeEach(() => {
  getWechatBotState.mockReset();
  upsertWechatBotState.mockReset();
  saveWechatSyncBuf.mockReset();
  touchWechatLastInbound.mockReset();
  getWechatBotState.mockResolvedValue(undefined);
  upsertWechatBotState.mockResolvedValue(1);
});

describe("getBotStatus", () => {
  it("reports a stopped account before any login", () => {
    const status = getBotStatus(1);
    expect(status.status).toBe("stopped");
    expect(status.qrCodeUrl).toBeNull();
    expect(status.needsVerifyCode).toBe(false);
  });

  it("keeps each user's channel state separate", () => {
    // Users 1 and 2 are independent accounts; reading one must not show the
    // other's state.
    const a = getBotStatus(1);
    const b = getBotStatus(2);
    expect(a).not.toBe(b);
    expect(a.status).toBe("stopped");
    expect(b.status).toBe("stopped");
  });

  it("does not leak a QR code between users", () => {
    const a = getBotStatus(101);
    const b = getBotStatus(202);
    expect(a.qrCodeUrl).toBeNull();
    expect(b.qrCodeUrl).toBeNull();
  });
});
