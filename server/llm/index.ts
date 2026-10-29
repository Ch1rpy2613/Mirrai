import { ENV } from "../_core/env";
import type { LLMMessage, LLMOptions, LLMProvider, LLMStreamChunk, InvokeParams } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { XunfeiProvider } from "./providers/xunfei";
import { DifyProvider } from "./providers/dify";
import { resolveProviderForUser, userHasOwnProvider } from "./user-provider";

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
  "Runcrate",
  (cfg) =>
    new OpenAIProvider(
      "Runcrate",
      cfg.apiKey ?? "",
      cfg.baseUrl ?? "https://api.runcrate.ai/v1",
      cfg.model ?? "deepseek-ai/DeepSeek-V4.1-Flash",
      cfg.systemMessage,
    ),
  {
    apiKey: ENV.runcrateApiKey,
    baseUrl: ENV.runcrateBaseUrl,
    model: ENV.runcrateModel,
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

/** Volcengine's Ark endpoint — Doubao's official home. */
const DEFAULT_DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

registry.registerFactory(
  "Doubao",
  (cfg) =>
    new OpenAIProvider(
      "Doubao",
      cfg.apiKey ?? "",
      // The environment's base URL is empty when it was not set, and an
      // empty string is not "missing" — so the provider called
      // "/chat/completions", which is not a URL, and every request to it
      // failed with "Failed to parse URL".
      cfg.baseUrl || ENV.doubaoBaseUrl || DEFAULT_DOUBAO_BASE_URL,
      cfg.model || ENV.doubaoModel,
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
      // 302AI is a gateway to many models and has no sensible default,
      // but an empty model is refused by the API with a 400. The
      // provider now says it is not configured rather than failing on
      // every call.
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

/**
 * The HTTP status of a failed provider call, if the error carries one.
 *
 * The providers put the status in the message, so it is read from there
 * — but it is read as a *number*, not as a pattern.
 */
function statusOf(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /\b(?:error|status)\s+(\d{3})\b/i.exec(err.message);
  if (!match) return null;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

/**
 * Whether the failure is worth trying again.
 *
 * The classification used to be a regular expression over the whole
 * message, including the provider's raw response body — so a body that
 * happened to contain three digits starting with a five was retried
 * three times, and a body containing "invalid_api_key" was classified as
 * a version error and never retried at all.
 *
 * The status decides. A request that was rejected (4xx) is not going to
 * succeed the second time; a request that the provider failed to serve
 * (5xx) or that never reached it might.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = statusOf(err);
  if (status !== null) {
    // 429 is the provider asking us to slow down: worth waiting for.
    if (status === 429) return true;
    if (status >= 400 && status < 500) return false;
    if (status >= 500) return true;
  }
  const msg = err.message.toLowerCase();
  return /econnreset|etimedout|socket hang up|network|fetch failed|rate.?limit|too many requests/.test(msg);
}

function isVersionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = statusOf(err);
  // A request the provider rejected is not a version problem, whatever
  // its body happens to say.
  if (status !== null && status >= 400 && status < 500) return false;
  const msg = err.message.toLowerCase();
  return /unsupported.*model|model.*not found|unknown model|deprecated model/.test(msg);
}

/**
 * How long a provider may take to answer.
 *
 * The only bound used to be undici's five-minute default for the
 * response headers, and the service retries three times — so a provider
 * that accepted the request and then went quiet could hold one of the
 * app's requests open for a quarter of an hour, while the model kept
 * running and the bill kept growing.
 */
export const PROVIDER_TIMEOUT_MS = 120_000;

/**
 * The signal for one attempt: the caller's own, and a deadline.
 *
 * The caller's signal is the one that cancels a stream when the user
 * walks away; the deadline is the one that stops the app waiting for a
 * provider that has stopped answering.
 */
function attemptSignal(options?: LLMOptions): {
  signal: AbortSignal;
  clear: () => void;
} {
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new Error("The provider did not answer in time."));
  }, PROVIDER_TIMEOUT_MS);
  // The deadline must not keep the process alive on its own.
  timer.unref?.();

  const signals: AbortSignal[] = [deadline.signal];
  if (options?.signal) signals.push(options.signal);
  const signal = signals.length === 1 ? deadline.signal : AbortSignal.any(signals);

  return {
    signal,
    clear: () => clearTimeout(timer),
  };
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
  /**
   * Turns a recording into words, through a specific provider.
   *
   * The provider has to be able to: the speech-to-text is a separate
   * service, and only the OpenAI-compatible ones expose it. A provider
   * that cannot says so — the caller tells the user their voice note
   * could not be understood, rather than making something up.
   */
  async transcribeWithProvider(
    provider: LLMProvider,
    audio: Buffer,
    filename: string,
  ): Promise<string> {
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }
    if (typeof provider.transcribe !== "function") {
      throw new Error(
        `The provider "${provider.name}" cannot hear a recording: it has no speech-to-text service.`,
      );
    }
    return provider.transcribe(audio, filename);
  }

  async invokeWithProvider(provider: LLMProvider, params: InvokeParams): Promise<string> {
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }

    let lastError: unknown;
    const maxAttempts = provider.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attempt_ = attemptSignal(params.options);
      try {
        return await provider.invoke(params.messages, {
          ...params.options,
          signal: attempt_.signal,
        });
      } catch (err) {
        lastError = err;
        if (isVersionError(err)) {
          console.warn(`[LLM] Provider "${provider.name}" returned a version/compatibility error:`, (err as Error).message);
          break;
        }
        if (isTransientError(err) && attempt < maxAttempts - 1) {
          const delay = 200 * Math.pow(2, attempt);
          console.warn(`[LLM] Transient error from "${provider.name}", retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
          attempt_.clear();
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      } finally {
        attempt_.clear();
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
      const attempt_ = attemptSignal(params.options);
      try {
        for await (const chunk of provider.stream(params.messages, {
          ...params.options,
          signal: attempt_.signal,
        })) {
          emitted = true;
          // The deadline is for the *first* answer, not for the whole
          // generation: a long reply takes a long time, and the user is
          // watching it arrive.
          attempt_.clear();
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
      } finally {
        attempt_.clear();
      }
    }
  }

  getRegistry() {
    return this.providerRegistry;
  }
}

export const llmService = new LLMService();

/**
 * Runs a request for a user, on their own provider when they have one.
 *
 * The environment-configured provider is used **only** when the user has
 * not configured one of their own.
 *
 * It used to be the other way round: the user's provider was tried
 * first, and when it failed — or answered with nothing — the whole
 * request was sent again to the operator's account. So a user who had
 * configured a key of their own had their private messages, their
 * letters and their memories handed to somebody else's account,
 * whenever their provider had a bad minute.
 *
 * The user chose a provider of their own for a reason. When nothing
 * answers, the caller falls back to something local — a letter the app
 * writes itself — rather than to somebody else's key.
 *
 * The request goes through the service, so the timeout and the retry
 * policy apply here too.
 *
 * Returns null when nothing answered.
 */
export async function invokeForUser(params: {
  userId: number;
  providerName?: string;
  messages: LLMMessage[];
  options?: LLMOptions;
}): Promise<string | null> {
  const outcome = await invokeForUserWithReason(params);
  return outcome.text;
}

/**
 * The same call, and the reason when it did not answer.
 *
 * The failure and the absence were the same thing — `null` — so a
 * caller that said "no provider configured" said it for a provider that
 * was there and had failed. The user is told to configure a model
 * service they have already configured.
 */
export async function invokeForUserWithReason(params: {
  userId: number;
  providerName?: string;
  messages: LLMMessage[];
  options?: LLMOptions;
}): Promise<{ text: string | null; reason?: string }> {
  try {
    const provider = await resolveProviderForUser({
      userId: params.userId,
      providerName: params.providerName,
    });
    if (provider) {
      const text = await llmService.invokeWithProvider(provider, {
        messages: params.messages,
        options: params.options,
      });
      if (text?.trim()) return { text };
    }
  } catch (e) {
    console.warn("[LLM] The user's provider failed:", (e as Error).message);
    // The reason is kept: it is what the user needs to see.
    return { text: null, reason: (e as Error).message };
  }

  // Only when the user has nothing of their own.
  if (await userHasOwnProvider(params.userId)) {
    return { text: null, reason: "The user's own provider did not answer." };
  }

  try {
    const text = await llmService.invoke({
      messages: params.messages,
      options: params.options,
    });
    return text?.trim() ? { text } : { text: null, reason: "The provider returned nothing." };
  } catch (e) {
    console.warn("[LLM] No provider could answer:", (e as Error).message);
    return { text: null, reason: (e as Error).message };
  }
}

export { registry };
export type { LLMMessage, LLMOptions, InvokeParams, LLMProvider, LLMStreamChunk };
