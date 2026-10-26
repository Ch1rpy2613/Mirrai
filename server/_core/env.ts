import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/**
 * Resolves the skill-engine directory.
 *
 * The configured path is relative to the server's working directory, which is
 * correct for source runs but breaks when the server is started from another
 * directory (packaged desktop builds, systemd units). Falling back to the
 * package root keeps the Python bridge working in both cases.
 */
function resolveSkillEngineDir(): string {
  const configured = process.env.SKILL_ENGINE_DIR ?? "./skill-engine";
  if (path.isAbsolute(configured)) return configured;

  const fromCwd = path.resolve(process.cwd(), configured);
  if (existsSync(fromCwd)) return fromCwd;

  // dist/index.js -> package root is two levels up; server/_core/env.ts -> three.
  const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  const fromPackage = path.resolve(packageRoot, configured);
  if (existsSync(fromPackage)) return fromPackage;

  return fromCwd;
}

export const ENV = {
  cookieSecret: resolveJwtSecret(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER ?? "openai",

  // 情绪判定引擎：llm（默认，由模型阅读对话判断）/ heuristic（纯关键词规则，零额外调用）
  emotionEngine: (process.env.EMOTION_ENGINE ?? "llm") as "llm" | "heuristic",

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

  opperApiKey: process.env.OPPER_API_KEY ?? "",
  opperBaseUrl: process.env.OPPER_BASE_URL ?? "https://api.opper.ai/v3/compat",
  opperModel: process.env.OPPER_MODEL ?? "claude-sonnet-4-6",

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
  // 微信官方 ClawBot 通道（腾讯 iLink 协议）
  wechatBotType: process.env.WECHAT_BOT_TYPE ?? "3",
  wechatIlinkBaseUrl: process.env.WECHAT_ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com",
  wechatIlinkCdnUrl: process.env.WECHAT_ILINK_CDN_URL ?? "https://novac2c.cdn.weixin.qq.com/c2c",
  wechatIlinkAppId: process.env.WECHAT_ILINK_APP_ID ?? "bot",
  wechatRouteTag: process.env.WECHAT_ROUTE_TAG ?? "",

  /** Application version, reported to the iLink backend as channel_version. */
  appVersion: process.env.APP_VERSION ?? "1.0.0",

  pythonPath: process.env.PYTHON_PATH ?? "python3",
  skillEngineDir: resolveSkillEngineDir(),

  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",

  /**
   * Extra origins allowed to make mutating requests. The app's own origin is
   * always allowed; this list exists for deployments that intentionally embed
   * Mirrai from another host.
   */
  allowedOrigins: parseOriginList(process.env.ALLOWED_ORIGINS),

  /**
   * Cookie SameSite policy. "lax" by default so a cross-site form post cannot
   * carry the session. "none" is only honoured when explicitly requested — it
   * requires HTTPS and is only safe together with the Origin check.
   */
  cookieSameSite: (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase() as
    | "lax"
    | "none"
    | "strict",

  /**
   * Whether to create a local admin account when the database has no users.
   * "auto" keeps the single-user desktop experience zero-config; "manual"
   * requires the operator to register through the UI.
   */
  bootstrapAdmin: (process.env.MIRRAI_BOOTSTRAP_ADMIN ?? "auto").toLowerCase() as
    | "auto"
    | "manual",

  /**
   * Where the first-run admin credentials are written. Defaults to a file next
   * to the uploads directory.
   */
  dataRoot: process.env.MIRRAI_DATA_ROOT ?? "",

  /** Optional override for the crisis-support resource list. */
  safetyResourcesFile: process.env.SAFETY_RESOURCES_FILE ?? "",

  /** Quiet hours for proactive reminders, as "HH:MM-HH:MM". */
  reminderQuietHours: process.env.REMINDER_QUIET_HOURS ?? "23:00-08:00",
};
