import type { LLMProvider } from "./types";

/**
 * Configuration a provider instance is built from.
 *
 * The registry keeps an environment-derived configuration for every provider
 * (the `baseConfig`) and can build a second instance per user on top of it,
 * which is how a user's own API key and model take effect.
 */
export type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  systemMessage?: string;
  /** Provider that needs more than one secret (e.g. Xunfei's app id / key / secret). */
  appId?: string;
  apiSecret?: string;
  extra?: Record<string, unknown>;
};

export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

interface RegistryEntry {
  factory: ProviderFactory;
  baseConfig: ProviderConfig;
}

export class ProviderRegistry {
  private entries = new Map<string, RegistryEntry>();
  private instances = new Map<string, LLMProvider>();
  private defaultName: string = "";

  /**
   * Registers a ready-made provider instance.
   *
   * Kept for providers that are constructed directly (and for tests).
   */
  register(provider: LLMProvider) {
    const key = provider.name.toLowerCase();
    this.entries.set(key, { factory: () => provider, baseConfig: {} });
    this.instances.set(key, provider);
  }

  /**
   * Registers a provider factory together with the environment-derived
   * configuration used to build its default instance.
   */
  registerFactory(
    name: string,
    factory: ProviderFactory,
    baseConfig: ProviderConfig = {},
  ) {
    const key = name.toLowerCase();
    this.entries.set(key, { factory, baseConfig });
    // Drop any cached instance so the new base configuration is picked up.
    this.instances.delete(key);
  }

  setDefault(name: string) {
    this.defaultName = name.toLowerCase();
  }

  /** The registered name of the default provider, if one is set. */
  getDefaultName(): string {
    return this.defaultName;
  }

  private buildInstance(key: string, entry: RegistryEntry): LLMProvider {
    const cached = this.instances.get(key);
    if (cached) return cached;
    const instance = entry.factory(entry.baseConfig);
    this.instances.set(key, instance);
    return instance;
  }

  /**
   * Resolves the registry entry for a provider name.
   *
   * An explicitly named provider that is not registered resolves to nothing —
   * silently falling back to a different provider would send the request
   * somewhere the caller did not ask for. When no name is given, the default
   * is used, and failing that the first configured provider.
   */
  getEntry(name?: string): { key: string; entry: RegistryEntry } | undefined {
    if (name) {
      const key = name.toLowerCase();
      const entry = this.entries.get(key);
      return entry ? { key, entry } : undefined;
    }

    if (this.defaultName) {
      const entry = this.entries.get(this.defaultName);
      if (entry) return { key: this.defaultName, entry };
    }

    for (const [key, entry] of Array.from(this.entries.entries())) {
      const instance = this.buildInstance(key, entry);
      if (instance.isConfigured()) return { key, entry };
    }
    return undefined;
  }

  /** The default (environment-configured) instance for a provider. */
  get(name?: string): LLMProvider | undefined {
    const resolved = this.getEntry(name);
    if (!resolved) return undefined;
    return this.buildInstance(resolved.key, resolved.entry);
  }

  /**
   * Builds a provider instance with a caller's configuration layered on top
   * of the environment defaults.
   *
   * Used for per-user API keys and models; the caller decides which fields to
   * override.
   */
  build(name: string, override: ProviderConfig): LLMProvider | undefined {
    const entry = this.entries.get(name.toLowerCase());
    if (!entry) return undefined;
    /**
     * The base configuration, minus the key.
     *
     * The key is the operator's, and it belongs to the operator's
     * address. A caller that builds a provider with its own overrides —
     * a per-user provider, pointed at that user's own address — must
     * never end up sending the operator's key there. So the key is not
     * inherited: it comes from the override, or it is not there at all.
     *
     * The environment's whole provider is still available through
     * `get()`, which is the right way to ask for "the operator's
     * configuration, as it is".
     */
    const merged: ProviderConfig = { ...entry.baseConfig };
    delete (merged as Record<string, unknown>).apiKey;
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined || value === null || value === "") continue;
      (merged as Record<string, unknown>)[key] = value;
    }
    return entry.factory(merged);
  }

  /** The environment-derived configuration for a provider. */
  getBaseConfig(name: string): ProviderConfig | undefined {
    return this.entries.get(name.toLowerCase())?.baseConfig;
  }

  list(): Array<{ name: string; configured: boolean }> {
    return Array.from(this.entries.entries()).map(([key, entry]) => {
      const instance = this.buildInstance(key, entry);
      return {
        name: instance.name,
        configured: instance.isConfigured(),
      };
    });
  }}
