import { ENV } from "../_core/env";
import type { LLMMessage, LLMOptions, InvokeParams } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { XunfeiProvider } from "./providers/xunfei";
import { DifyProvider } from "./providers/dify";

const registry = new ProviderRegistry();

registry.register(new OpenAIProvider("OpenAI", ENV.openaiApiKey, ENV.openaiBaseUrl, ENV.openaiModel, ENV.openaiSystemMessage || undefined));
registry.register(new OpenAIProvider("Kimi", ENV.kimiApiKey, ENV.kimiBaseUrl, ENV.kimiModel));
registry.register(new OpenAIProvider("Qwen", ENV.tongyiApiKey, ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1", ENV.tongyiModel));
registry.register(new OpenAIProvider("DeepSeek", ENV.deepseekApiKey, ENV.deepseekBaseUrl, ENV.deepseekModel));
registry.register(new OpenAIProvider("Doubao", ENV.doubaoApiKey, ENV.doubaoBaseUrl, ENV.doubaoModel));
registry.register(new OpenAIProvider("302AI", ENV._302aiApiKey, "https://api.302.ai/v1", ""));
registry.register(new ClaudeProvider(ENV.claudeApiKey, ENV.claudeModel, ENV.claudeBaseUrl));
registry.register(new OllamaProvider(ENV.ollamaUrl, ENV.ollamaModel));
registry.register(new XunfeiProvider(ENV.xunfeiAppId, ENV.xunfeiApiKey, ENV.xunfeiApiSecret, ENV.xunfeiModelVersion));
registry.register(new DifyProvider(ENV.difyApiKey, ENV.difyUrl));

registry.setDefault(ENV.defaultLlmProvider);

class LLMService {
  async invoke(params: InvokeParams): Promise<string> {
    const providerName = params.options?.provider;
    const provider = registry.get(providerName);
    if (!provider) {
      throw new Error(`No LLM provider available${providerName ? ` (requested: ${providerName})` : ""}. Configure at least one provider in .env`);
    }
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }
    return provider.invoke(params.messages, params.options);
  }

  getRegistry() {
    return registry;
  }
}

export const llmService = new LLMService();
export { registry };
export type { LLMMessage, LLMOptions, InvokeParams };
