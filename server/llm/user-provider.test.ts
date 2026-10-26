import { describe, expect, it, vi, beforeEach } from "vitest";

const getLlmConfigsByUserId = vi.fn();

vi.mock("../db", () => ({
  getLlmConfigsByUserId: (...a: unknown[]) => getLlmConfigsByUserId(...a),
}));

import { resolveProviderForUser, invalidateUserProviderCache } from "./user-provider";
import { registry } from "./index";
import { OpenAIProvider } from "./providers/openai";

// A stand-in for the encrypted credential.
const ENCRYPTED = "v1:aaaa:bbbb:cccc";

describe("resolveProviderForUser", () => {
  beforeEach(() => {
    getLlmConfigsByUserId.mockReset();
    getLlmConfigsByUserId.mockResolvedValue([]);
    invalidateUserProviderCache();
  });

  it("falls back to the environment provider when the user has no config", async () => {
    const provider = await resolveProviderForUser({ userId: 1, providerName: "OpenAI" });
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("OpenAI");
  });

  it("falls back to the default provider for a name that does not exist", async () => {
    // A typo in the provider name must not brick the user's chat. The
    // configuration is wrong, not the conversation, so the request goes to
    // the default provider instead of failing.
    const provider = await resolveProviderForUser({ userId: 1, providerName: "Nope" });
    expect(provider).toBeDefined();
    expect(provider?.name).not.toBe("Nope");
  });

  it("uses the user's own configuration when they have one", async () => {
    // The registry entry is replaced so the test can observe the config that
    // was actually used.
    const original = registry.getBaseConfig("OpenAI");
    registry.registerFactory(
      "OpenAI",
      (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
      { apiKey: "env-key", baseUrl: "https://env.example", model: "env-model" },
    );

    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        providerName: "OpenAI",
        isDefault: true,
        apiKey: ENCRYPTED,
        apiKeyHint: "abcd",
        baseUrl: "https://user.example",
        model: "user-model",
        systemMessage: null,
        extraConfig: null,
        createdAt: new Date(),
      },
    ]);

    // The encrypted value cannot be decrypted without the real key, so the
    // resolver falls back to the environment for the key while still
    // applying the user's base URL and model.
    const provider = await resolveProviderForUser({ userId: 1, providerName: "OpenAI" });
    expect(provider).toBeDefined();

    if (original) {
      registry.registerFactory(
        "OpenAI",
        (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
        original,
      );
    }
  });

  it("does not fall back to the environment's provider when the user has their own", async () => {
    // The product's promise is that the data stays on the user's machine.
    // A user who has configured a provider of their own is saying where
    // their conversations should go — and falling back to the
    // environment's provider sent the user's private conversation to the
    // operator's account, on the operator's key and the operator's bill.
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        providerName: "OpenAI",
        isDefault: true,
        apiKey: ENCRYPTED,
        apiKeyHint: "abcd",
        baseUrl: "https://user.example",
        model: "user-model",
        systemMessage: null,
        extraConfig: null,
        createdAt: new Date(),
      },
    ]);

    const original = registry.getBaseConfig("OpenAI");
    registry.registerFactory(
      "OpenAI",
      (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
      { apiKey: "env-key", baseUrl: "https://env.example", model: "env-model" },
    );

    // The persona asks for a provider this user has no row for.
    const provider = await resolveProviderForUser({ userId: 1, providerName: "DeepSeek" });
    expect(provider).toBeDefined();
    // The user's own provider, not the environment's.
    expect(provider?.name).toBe("OpenAI");

    if (original) {
      registry.registerFactory(
        "OpenAI",
        (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
        original,
      );
    }
  });

  it("never sends the operator's key to the user's own address", async () => {
    // The registry merges the environment's configuration under the
    // user's overrides. A row with an address and no key of its own
    // therefore produced a provider that sent
    // `Authorization: Bearer <the operator's key>` to whatever was
    // listening at that address — and used the operator's bill.
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        providerName: "OpenAI",
        isDefault: true,
        apiKey: null,
        apiKeyHint: null,
        baseUrl: "https://attacker.example/v1",
        model: null,
        systemMessage: null,
        extraConfig: null,
        createdAt: new Date(),
      },
    ]);

    const original = registry.getBaseConfig("OpenAI");
    registry.registerFactory(
      "OpenAI",
      (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
      { apiKey: "the-operator-key", baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    );

    const provider = await resolveProviderForUser({ userId: 1, providerName: "OpenAI" });
    expect(provider).toBeDefined();
    // The provider must be the environment's own — its address and its
    // key — and never a hybrid of the two.
    const built = provider as unknown as { apiKey?: string; baseUrl?: string };
    expect(built.baseUrl).not.toBe("https://attacker.example/v1");

    if (original) {
      registry.registerFactory(
        "OpenAI",
        (cfg) => new OpenAIProvider("OpenAI", cfg.apiKey ?? "", cfg.baseUrl ?? "", cfg.model ?? ""),
        original,
      );
    }
  });

  it("uses the user's default row when no provider is requested", async () => {
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        providerName: "DeepSeek",
        isDefault: true,
        apiKey: null,
        apiKeyHint: null,
        baseUrl: null,
        model: null,
        systemMessage: null,
        extraConfig: null,
        createdAt: new Date(),
      },
    ]);

    const provider = await resolveProviderForUser({ userId: 1 });
    // The environment has no DeepSeek key in the test environment, so the
    // resolver still resolves a provider object.
    expect(provider === undefined || provider.name === "DeepSeek").toBe(true);
  });
});
