import { describe, expect, it, vi } from "vitest";
import { LLMService } from "./index";
import { ProviderRegistry } from "./provider-registry";
import type { LLMProvider } from "./types";

describe("LLMService retry policy", () => {
  it("honors a provider's single-attempt policy", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    const provider: LLMProvider = {
      name: "Atlas",
      maxAttempts: 1,
      capabilities: {
        streaming: false,
        vision: false,
        tools: false,
        jsonMode: false,
      },
      isConfigured: () => true,
      invoke,
    };
    const registry = new ProviderRegistry();
    registry.register(provider);
    registry.setDefault("atlas");

    const service = new LLMService(registry);

    await expect(service.invoke({ messages: [] })).rejects.toThrow("HTTP 503");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
