/**
 * Per-user LLM provider resolution.
 *
 * The `llm_configs` table stores a user's own API key, base URL and model, but
 * the registry is built from environment variables only. This module bridges
 * the two: when a user has configured a provider, calls for that user are made
 * with the user's credentials; otherwise the environment-configured instance
 * is used.
 *
 * API keys are stored encrypted at rest (see `encryptSecret`), and legacy
 * plaintext rows are still read correctly.
 */
import { decryptIfEncrypted } from "../_core/crypto";
import * as db from "../db";
import { registry } from "./index";
import type { LLMProvider } from "./types";

interface CachedProvider {
  provider: LLMProvider;
  cachedAt: number;
}

const providerCache = new Map<string, CachedProvider>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 200;

function cacheKey(userId: number, providerName: string, config: {
  id: number;
  apiKeyHint: string | null;
  baseUrl: string | null;
  model: string | null;
}): string {
  return [
    userId,
    providerName.toLowerCase(),
    config.id,
    config.apiKeyHint ?? "",
    config.baseUrl ?? "",
    config.model ?? "",
  ].join(":");
}

function readCache(key: string): LLMProvider | undefined {
  const entry = providerCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    providerCache.delete(key);
    return undefined;
  }
  return entry.provider;
}

function writeCache(key: string, provider: LLMProvider) {
  if (providerCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = Array.from(providerCache.entries()).sort(
      (a, b) => a[1].cachedAt - b[1].cachedAt,
    )[0];
    if (oldest) providerCache.delete(oldest[0]);
  }
  providerCache.set(key, { provider, cachedAt: Date.now() });
}

/** Drops any cached provider for a user (called when their config changes). */
export function invalidateUserProviderCache(userId?: number) {
  if (userId === undefined) {
    providerCache.clear();
    return;
  }
  for (const key of Array.from(providerCache.keys())) {
    if (key.startsWith(`${userId}:`)) providerCache.delete(key);
  }
}

/**
 * Resolves the provider to use for a given user and optional requested name.
 *
 * Returns undefined when no provider is available at all.
 */
export async function resolveProviderForUser(params: {
  userId: number;
  providerName?: string;
}): Promise<LLMProvider | undefined> {
  const { userId, providerName } = params;
  const configs = await db.getLlmConfigsByUserId(userId);

  /**
   * The user has configured a provider of their own.
   *
   * Then their conversations go through their own key. Falling back to
   * the environment-configured provider would send the user's private
   * conversation to the operator's account, on the operator's key and
   * the operator's bill — and the user chose a provider of their own
   * for a reason. That fallback is what this used to do, whenever the
   * provider the persona asked for was one the user had no row for.
   */
  if (configs.length > 0) {
    const wanted = providerName
      ? configs.find((c) => c.providerName.toLowerCase() === providerName.toLowerCase())
      : undefined;
    if (providerName && !wanted) {
      console.warn(
        `[LLM] The persona asks for the provider "${providerName}", which this user has not configured — using their own default instead.`,
      );
    }
    const chosen = wanted ?? configs.find((c) => c.isDefault) ?? configs[0];
    return buildUserProvider(userId, chosen);
  }

  // The user has configured nothing, so the environment-configured
  // instance is used — that is what running your own instance means.
  //
  // A name that is not registered cannot be built. Falling back to the
  // default keeps the user able to chat instead of failing every request
  // with "No LLM provider available" — the mistake is in the configuration,
  // not in the conversation.
  const requested = providerName && registry.getEntry(providerName)
    ? providerName
    : undefined;
  if (providerName && !requested) {
    console.warn(
      `[LLM] Unknown provider "${providerName}" — falling back to the default provider.`,
    );
  }
  return registry.get(requested);
}

/**
 * Builds the provider for one of the user's own configuration rows.
 */
async function buildUserProvider(
  userId: number,
  config: Awaited<ReturnType<typeof db.getLlmConfigsByUserId>>[number],
): Promise<LLMProvider | undefined> {
  const apiKey = await decryptIfEncrypted(config.apiKey);

  const hasOverride = !!(apiKey || config.baseUrl || config.model);
  if (!hasOverride) {
    // The row exists but carries nothing usable; use the environment config.
    return registry.get(config.providerName);
  }

  const key = cacheKey(userId, config.providerName, config);
  const cached = readCache(key);
  if (cached) return cached;

  const provider = registry.build(config.providerName, {
    apiKey: apiKey ?? undefined,
    baseUrl: config.baseUrl ?? undefined,
    model: config.model ?? undefined,
  });
  if (!provider) return registry.get(config.providerName);

  writeCache(key, provider);
  return provider;
}

/**
 * The provider a user would use by default, used by the setup status probe.
 */
export async function hasUserLlmConfig(userId: number): Promise<boolean> {
  const configs = await db.getLlmConfigsByUserId(userId);
  return configs.some((c) => !!(c.apiKey || c.baseUrl || c.model));
}
