import type { LLMProvider } from "./types";

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultName: string = "";

  register(provider: LLMProvider) {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  setDefault(name: string) {
    this.defaultName = name.toLowerCase();
  }

  get(name?: string): LLMProvider | undefined {
    if (name) return this.providers.get(name.toLowerCase());
    if (this.defaultName) return this.providers.get(this.defaultName);
    for (const p of Array.from(this.providers.values())) {
      if (p.isConfigured()) return p;
    }
    return undefined;
  }

  list(): Array<{ name: string; configured: boolean }> {
    return Array.from(this.providers.values()).map(p => ({
      name: p.name,
      configured: p.isConfigured(),
    }));
  }
}
