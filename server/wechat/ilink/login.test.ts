import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pollQrLogin, startQrLogin } from "./login";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // Re-stub on every test: unstubAllGlobals in afterEach removes the stub.
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds a fetch mock that replies with the given JSON body. */
function mockJson(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

describe("startQrLogin", () => {
  it("returns the QR image content on success", async () => {
    mockJson({ qrcode: "qr-1", qrcode_img_content: "https://cdn/qr.png" });
    const result = await startQrLogin({ baseUrl: "https://example.test" });
    expect(result.ok).toBe(true);
    expect(result.qrcode).toBe("qr-1");
    expect(result.qrcodeImgContent).toBe("https://cdn/qr.png");
  });

  it("requests the configured bot type", async () => {
    mockJson({ qrcode: "qr-1", qrcode_img_content: "x" });
    await startQrLogin({ baseUrl: "https://example.test", botType: "7" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("bot_type=7");
  });

  it("reports failure without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await startQrLogin({ baseUrl: "https://example.test" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("network down");
  });
});

describe("pollQrLogin", () => {
  it("maps the confirmed status to credentials", async () => {
    mockJson({
      status: "confirmed",
      bot_token: "token-1",
      ilink_bot_id: "bot-1",
      baseurl: "https://api.example.test",
      ilink_user_id: "user-1",
    });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.status).toBe("confirmed");
    expect(result.botToken).toBe("token-1");
    expect(result.accountId).toBe("bot-1");
    expect(result.baseUrl).toBe("https://api.example.test");
    expect(result.userId).toBe("user-1");
    expect(result.alreadyConnected).toBe(false);
  });

  it("fails a confirmation that carries no bot id", async () => {
    mockJson({ status: "confirmed", bot_token: "token-1" });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.status).toBe("confirmed");
    expect(result.botToken).toBeUndefined();
    expect(result.message).toContain("ilink_bot_id");
  });

  it("asks for the verification code", async () => {
    mockJson({ status: "need_verifycode" });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.status).toBe("need_verifycode");
    expect(result.message).toContain("数字");
  });

  it("sends the verification code back on the next poll", async () => {
    mockJson({ status: "scaned" });
    await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test", verifyCode: "4242" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("verify_code=4242");
  });

  it("reports an expired code", async () => {
    mockJson({ status: "expired" });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.status).toBe("expired");
    expect(result.message).toContain("过期");
  });

  it("treats an already-bound bot as connected", async () => {
    mockJson({ status: "binded_redirect" });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.alreadyConnected).toBe(true);
  });

  it("surfaces the redirect host", async () => {
    mockJson({ status: "scaned_but_redirect", redirect_host: "idc.example.test" });
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.redirectHost).toBe("idc.example.test");
  });

  it("treats a network error as still waiting", async () => {
    fetchMock.mockRejectedValue(new Error("gateway timeout"));
    const result = await pollQrLogin({ qrcode: "qr-1", baseUrl: "https://example.test" });
    expect(result.status).toBe("wait");
  });
});
