import { afterEach, describe, expect, it, vi } from "vitest";
import { registry } from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("API Route provider", () => {
  it("requires the user's key when building an override", () => {
    expect(registry.build("apiroute", {})?.isConfigured()).toBe(false);
  });

  it("sends chat requests through the registered compatible provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Hello" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = registry.build("apiroute", { apiKey: "test-key" });
    expect(provider?.isConfigured()).toBe(true);
    expect(await provider?.invoke([{ role: "user", content: "Hi" }])).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://global.api-route.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body).model).toBe("gpt-6.1-sol");
  });

  it("honors per-user endpoint and model overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await registry.build("apiroute", {
      apiKey: "user-key", baseUrl: "https://example.test/v1", model: "user-model",
    })?.invoke([{ role: "user", content: "Hi" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(JSON.parse(init.body).model).toBe("user-model");
  });
});
