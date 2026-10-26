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
 * Whether the user has a provider of their own.
 *
 * This is the question that decides whether the environment-configured
 * provider may be used at all: a user who configured a key of their own
 * chose it on purpose, and their conversation must not end up on the
 * operator's account — or on the operator's bill.
 */
export async function userHasOwnProvider(userId: number): Promise<boolean> {
  const configs = await db.getLlmConfigsByUserId(userId);
  return configs.length > 0;
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
  const { provider } = await resolveProviderForUserWithOwnership(params);
  return provider;
}

/**
 * Resolves the provider for a user, and says whose it is.
 *
 * The distinction is the whole point. The environment-configured
 * provider is the *operator's* account and the operator's bill, so it
 * may only be used when the user has no provider of their own. When the
 * provider is the user's, the operator's must not be tried afterwards:
 * that is how a user's private conversation ended up on somebody else's
 * account whenever their provider had a bad minute.
 */
export async function resolveProviderForUserWithOwnership(params: {
  userId: number;
  providerName?: string;
}): Promise<{ provider: LLMProvider | undefined; owned: boolean }> {
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
    return { provider: await buildUserProvider(userId, chosen), owned: true };
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
  return { provider: registry.get(requested), owned: false };
}

/**
 * Builds the provider for one of the user's own configuration rows.
 */
async function buildUserProvider(
  userId: number,
  config: Awaited<ReturnType<typeof db.getLlmConfigsByUserId>>[number],
): Promise<LLMProvider | undefined> {
  const apiKey = await decryptIfEncrypted(config.apiKey);

  if (!apiKey) {
    /**
     * The row has no key of its own.
     *
     * The environment's key must not be sent to the user's own address.
     * The registry merges the environment's configuration under the
     * user's overrides, so a row with an address and no key produced a
     * provider that sent `Authorization: Bearer <the operator's key>`
     * to whatever was listening at that address — and used the
     * operator's bill at the same time. Storing a row with an address
     * was enough to do it.
     *
     * So a row without a key of its own gets the environment's provider
     * whole: its key and its address. The user's own address is not
     * used, because there is no key that may safely go with it.
     */
    if (config.baseUrl) {
      console.warn(
        `[LLM] The "${config.providerName}" row has an address but no key of its own — the address is ignored, and the environment's provider is used.`,
      );
    }
    return registry.get(config.providerName);
  }

  const key = cacheKey(userId, config.providerName, config);
  const cached = readCache(key);
  if (cached) return cached;

  /**
   * The user's own key, their own address if they gave one, and the
   * environment's model if they did not.
   *
   * The key is the user's, so it goes to the user's address — and the
   * environment's key is never mixed in: the override replaces it
   * rather than sitting beside it.
   */
  const provider = registry.build(config.providerName, {
    apiKey,
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
