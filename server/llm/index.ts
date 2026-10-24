import { ENV } from "../_core/env";
import type { LLMMessage, LLMOptions, LLMProvider, LLMStreamChunk, InvokeParams } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { XunfeiProvider } from "./providers/xunfei";
import { DifyProvider } from "./providers/dify";

const registry = new ProviderRegistry();

/**
 * Every provider is registered as a *factory* together with the
 * environment-derived configuration. That lets the same provider be rebuilt
 * with a user's own API key, base URL or model on top of these defaults.
 */
registry.registerFactory(
  "OpenAI",
  (cfg) =>
    new OpenAIProvider(
      "OpenAI",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.openai.com/v1",
      cfg.model ?? "gpt-4o",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.openaiApiKey,
    baseUrl: ENV.openaiBaseUrl,
    model: ENV.openaiModel,
    systemMessage: ENV.openaiSystemMessage || undefined,
  },
);

registry.registerFactory(
  "Atlas",
  (cfg) =>
    new OpenAIProvider(
      "Atlas",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.atlascloud.ai/v1",
      cfg.model ?? "google/gemini-3-flash-preview",
      cfg.systemMessage,
      1,
    ),
  {
    apiKey: ENV.atlasApiKey,
    baseUrl: ENV.atlasBaseUrl,
    model: ENV.atlasModel,
  },
);

registry.registerFactory(
  "CheaperInference",
  (cfg) =>
    new OpenAIProvider(
      "CheaperInference",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.cheaperinference.com/v1",
      cfg.model ?? "gpt-5.4-mini",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.cheaperInferenceApiKey,
    baseUrl: ENV.cheaperInferenceBaseUrl,
    model: ENV.cheaperInferenceModel,
  },
);

registry.registerFactory(
  "Kimi",
  (cfg) =>
    new OpenAIProvider(
      "Kimi",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.moonshot.cn/v1",
      cfg.model ?? "moonshot-v1-8k",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.kimiApiKey,
    baseUrl: ENV.kimiBaseUrl,
    model: ENV.kimiModel,
  },
);

registry.registerFactory(
  "Qwen",
  (cfg) =>
    new OpenAIProvider(
      "Qwen",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? (ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1"),
      cfg.model ?? "qwen-turbo",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.tongyiApiKey,
    baseUrl: ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: ENV.tongyiModel,
  },
);

registry.registerFactory(
  "DeepSeek",
  (cfg) =>
    new OpenAIProvider(
      "DeepSeek",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.deepseek.com/v1",
      cfg.model ?? "deepseek-chat",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.deepseekApiKey,
    baseUrl: ENV.deepseekBaseUrl,
    model: ENV.deepseekModel,
  },
);

registry.registerFactory(
  "Doubao",
  (cfg) =>
    new OpenAIProvider(
      "Doubao",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? ENV.doubaoBaseUrl,
      cfg.model ?? ENV.doubaoModel,
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.doubaoApiKey,
    baseUrl: ENV.doubaoBaseUrl,
    model: ENV.doubaoModel,
  },
);

registry.registerFactory(
  "302AI",
  (cfg) =>
    new OpenAIProvider(
      "302AI",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.302.ai/v1",
      cfg.model ?? "",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV._302aiApiKey,
    baseUrl: "https://api.302.ai/v1",
  },
);

registry.registerFactory(
  "Claude",
  (cfg) =>
    new ClaudeProvider(
      cfg.apiKey ?? "",
      cfg.model ?? "claude-sonnet-4-6",
      cfg.baseUrl ?? "https://api.anthropic.com",
    ),
  {
    apiKey: ENV.claudeApiKey,
    baseUrl: ENV.claudeBaseUrl,
    model: ENV.claudeModel,
  },
);

registry.registerFactory(
  "Ollama",
  (cfg) => new OllamaProvider(cfg.baseUrl ?? "http://localhost:11434", cfg.model ?? "llama3"),
  {
    baseUrl: ENV.ollamaUrl,
    model: ENV.ollamaModel,
  },
);

registry.registerFactory(
  "xunfei",
  (cfg) =>
    new XunfeiProvider(
      cfg.appId ?? "",
      cfg.apiKey ?? "",
      cfg.apiSecret ?? "",
      cfg.model ?? "v3.5",
    ),
  {
    appId: ENV.xunfeiAppId,
    apiKey: ENV.xunfeiApiKey,
    apiSecret: ENV.xunfeiApiSecret,
    model: ENV.xunfeiModelVersion,
  },
);

registry.registerFactory(
  "dify",
  (cfg) => new DifyProvider(cfg.apiKey ?? "", cfg.baseUrl ?? ""),
  {
    apiKey: ENV.difyApiKey,
    baseUrl: ENV.difyUrl,
  },
);

registry.setDefault(ENV.defaultLlmProvider);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|etimedout|socket hang up|5\d{2}|rate.?limit|too many requests/.test(msg);
}

function isVersionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /version|deprecated|unsupported.*model|model.*not found|invalid.*api/.test(msg);
}

export class LLMService {
  constructor(private providerRegistry = registry) {}

  async invoke(params: InvokeParams): Promise<string> {
    const provider = this.providerRegistry.get(params.options?.provider);
    if (!provider) {
      throw new Error(
        `No LLM provider available${params.options?.provider ? ` (requested: ${params.options.provider})` : ""}. Configure at least one provider in .env`,
      );
    }
    return this.invokeWithProvider(provider, params);
  }

  /**
   * Runs a request against a specific provider instance.
   *
   * Per-user providers are built outside the registry, so they are invoked
   * through here to keep the retry policy in one place.
   */
  async invokeWithProvider(provider: LLMProvider, params: InvokeParams): Promise<string> {
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }

    let lastError: unknown;
    const maxAttempts = provider.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await provider.invoke(params.messages, params.options);
      } catch (err) {
        lastError = err;
        if (isVersionError(err)) {
          console.warn(`[LLM] Provider "${provider.name}" returned a version/compatibility error:`, (err as Error).message);
          break;
        }
        if (isTransientError(err) && attempt < maxAttempts - 1) {
          const delay = 200 * Math.pow(2, attempt);
          console.warn(`[LLM] Transient error from "${provider.name}", retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
    throw lastError;
  }

  /**
   * Streams a response from a specific provider.
   *
   * A retry is only attempted while nothing has been emitted yet — once the
   * caller has seen part of the answer, replaying it would duplicate text.
   */
  async *streamWithProvider(
    provider: LLMProvider,
    params: InvokeParams,
  ): AsyncGenerator<LLMStreamChunk> {
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }
    if (!provider.stream) {
      const text = await this.invokeWithProvider(provider, params);
      if (text) yield { text };
      return;
    }

    const maxAttempts = provider.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let emitted = false;
      try {
        for await (const chunk of provider.stream(params.messages, params.options)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (emitted) throw err;
        if (attempt < maxAttempts - 1 && isTransientError(err)) {
          const delay = 200 * Math.pow(2, attempt);
          console.warn(`[LLM] Transient streaming error from "${provider.name}", retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  getRegistry() {
    return this.providerRegistry;
  }
}

export const llmService = new LLMService();
export { registry };
export type { LLMMessage, LLMOptions, InvokeParams, LLMProvider, LLMStreamChunk };
