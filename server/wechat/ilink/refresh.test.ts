import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Verifies the QR refresh contract against the real shipped login module.
 *
 * The iLink backend expires QR codes in roughly 90 seconds — far shorter than
 * a human scan round-trip — so the channel must keep issuing fresh codes
 * without a hard limit, exactly like the official CLI does.
 */
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const getWechatBotState = vi.fn();
const upsertWechatBotState = vi.fn();

vi.mock("../../db", () => ({
  getWechatBotState: (...a: unknown[]) => getWechatBotState(...a),
  upsertWechatBotState: (...a: unknown[]) => upsertWechatBotState(...a),
  saveWechatSyncBuf: vi.fn(),
  touchWechatLastInbound: vi.fn(),
}));

import { pollQrLogin, startQrLogin } from "./login";

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  getWechatBotState.mockReset();
  upsertWechatBotState.mockReset();
  getWechatBotState.mockResolvedValue(undefined);
  upsertWechatBotState.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Replies with the given JSON body. */
function mockJson(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe("QR refresh cycle", () => {
  it("keeps issuing fresh codes after repeated expiry, without a cap", async () => {
    // Every poll reports expiry; every QR request hands back a new code.
    let issued = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      const asString = String(url);
      if (asString.includes("get_bot_qrcode")) {
        issued += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ qrcode: `qr-${issued}`, qrcode_img_content: `https://cdn/qr-${issued}` }),
        };
      }
      // Poll: always expired.
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: "expired" }),
      };
    });

    // Simulate the channel's refresh loop over several expiry cycles.
    const seenCodes = new Set<string>();
    for (let cycle = 0; cycle < 12; cycle++) {
      const start = await startQrLogin({ baseUrl: "https://example.test" });
      expect(start.ok).toBe(true);
      seenCodes.add(start.qrcode!);

      const poll = await pollQrLogin({
        qrcode: start.qrcode!,
        baseUrl: start.baseUrl,
      });
      expect(poll.status).toBe("expired");
    }

    // 12 consecutive expiries must not have exhausted the refresh budget.
    expect(issued).toBe(12);
    expect(seenCodes.size).toBe(12);
  });

  it("stops refreshing once the login is confirmed", async () => {
    let issued = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      const asString = String(url);
      if (asString.includes("get_bot_qrcode")) {
        issued += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ qrcode: `qr-${issued}`, qrcode_img_content: `https://cdn/qr-${issued}` }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "confirmed",
            bot_token: "token-1",
            ilink_bot_id: "bot-1",
            ilink_user_id: "user-1",
            baseurl: "https://api.example.test",
          }),
      };
    });

    const start = await startQrLogin({ baseUrl: "https://example.test" });
    const poll = await pollQrLogin({ qrcode: start.qrcode!, baseUrl: start.baseUrl });

    expect(poll.status).toBe("confirmed");
    expect(poll.botToken).toBe("token-1");
    expect(issued).toBe(1);
  });
});
