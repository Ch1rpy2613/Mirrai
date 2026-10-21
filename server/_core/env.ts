function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.trim().length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is required in production. Generate one with: " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  console.warn(
    "[env] JWT_SECRET is not set — falling back to an insecure development-only secret. This must never be used in production."
  );
  return "dev-secret-change-me";
}

export const ENV = {
  cookieSecret: resolveJwtSecret(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER ?? "openai",

  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",
  openaiSystemMessage: process.env.OPENAI_SYSTEM_MESSAGE ?? "",

  atlasApiKey: process.env.ATLASCLOUD_API_KEY ?? "",
  atlasBaseUrl: process.env.ATLAS_BASE_URL ?? "https://api.atlascloud.ai/v1",
  atlasModel: process.env.ATLAS_MODEL ?? "google/gemini-3-flash-preview",

  cheaperInferenceApiKey: process.env.CHEAPER_INFERENCE_API_KEY ?? "",
  cheaperInferenceBaseUrl: process.env.CHEAPER_INFERENCE_BASE_URL ?? "https://api.cheaperinference.com/v1",
  cheaperInferenceModel: process.env.CHEAPER_INFERENCE_MODEL ?? "gpt-5.4-mini",

  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",

  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  kimiBaseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  kimiModel: process.env.KIMI_MODEL ?? "moonshot-v1-8k",

  claudeApiKey: process.env.CLAUDE_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6",
  claudeBaseUrl: process.env.CLAUDE_BASE_URL ?? "https://api.anthropic.com",

  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3",

  difyApiKey: process.env.DIFY_API_KEY ?? "",
  difyUrl: process.env.DIFY_URL ?? "",

  xunfeiAppId: process.env.XUNFEI_APP_ID ?? "",
  xunfeiApiKey: process.env.XUNFEI_API_KEY ?? "",
  xunfeiApiSecret: process.env.XUNFEI_API_SECRET ?? "",
  xunfeiModelVersion: process.env.XUNFEI_MODEL_VERSION ?? "v3.5",

  tongyiUrl: process.env.TONGYI_URL ?? "",
  tongyiModel: process.env.TONGYI_MODEL ?? "qwen-turbo",
  tongyiApiKey: process.env.TONGYI_API_KEY ?? "",

  doubaoApiKey: process.env.DOUBAO_API_KEY ?? "",
  doubaoBaseUrl: process.env.DOUBAO_BASE_URL ?? "",
  doubaoModel: process.env.DOUBAO_MODEL ?? "",

  _302aiApiKey: process.env._302AI_API_KEY ?? "",

  wechatEnabled: process.env.WECHAT_ENABLED === "true",
  wechatPuppet: process.env.WECHAT_PUPPET ?? "wechaty-puppet-wechat4u",

  pythonPath: process.env.PYTHON_PATH ?? "python3",
  skillEngineDir: process.env.SKILL_ENGINE_DIR ?? "./skill-engine",

  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
};
