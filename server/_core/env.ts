import { existsSync, readFileSync } from "fs";
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

/**
 * The database URL, checked.
 *
 * The connection is lazy: `drizzle(url)` does not open it, so a URL
 * that is wrong in any way is not noticed until the first query — and
 * the first query is usually a read that returns nothing. The app then
 * behaves as though the user had no personas and no messages, which is
 * indistinguishable from the data being gone.
 *
 * So the shape is checked when the environment is read, and a URL that
 * cannot be right is named plainly.
 */
function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw.trim()) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "DATABASE_URL is not a URL. It should look like: " +
        "postgresql://user:password@host:5432/database",
    );
  }
  const postgres = ["postgres:", "postgresql:"];
  if (!postgres.includes(parsed.protocol)) {
    throw new Error(
      `DATABASE_URL must be a PostgreSQL URL, not "${parsed.protocol}". It should look like: ` +
        "postgresql://user:password@host:5432/database",
    );
  }
  if (!parsed.hostname) {
    throw new Error(
      "DATABASE_URL has no host. It should look like: " +
        "postgresql://user:password@host:5432/database",
    );
  }
  return raw;
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
 * Parses a list of addresses.
 *
 * Used for the proxy list: an entry may be a single address or a range
 * in the `a.b.c.d/len` form.
 */
function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
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
/**
 * The places the skill engine is looked for.
 *
 * The first one that exists is the one that is used.
 */
export function skillEngineDirs(configured = process.env.SKILL_ENGINE_DIR ?? "./skill-engine"): string[] {
  if (path.isAbsolute(configured)) return [configured];
  return [
    // The working directory, for a server started from the repository root.
    path.resolve(process.cwd(), configured),
    // dist/index.js -> package root is two levels up; server/_core/env.ts -> three.
    path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", configured),
    /**
     * Beside the bundle.
     *
     * The Docker image and the desktop bundle both put the skill engine
     * beside the bundle's own folder: `<app>/skill-engine`. The path
     * above is two levels up from the bundle — which is *above* the
     * app — so it was found only because the server happened to be
     * started from that folder.
     *
     * A systemd unit, or a `docker run -w`, would have found no skill
     * engine at all: the collectors would have been spawned in a
     * directory that did not exist, and the distillation would have
     * failed with "Prompt not found".
     */
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", configured),
  ];
}

function resolveSkillEngineDir(): string {
  for (const dir of skillEngineDirs()) {
    if (existsSync(dir)) return dir;
  }
  return path.resolve(process.cwd(), process.env.SKILL_ENGINE_DIR ?? "./skill-engine");
}

/**
 * The version the app reports itself as.
 *
 * It used to be written out by hand — "1.0.0" — while `package.json`
 * said "1.3.0" and the installer said "1.3.0". So the WeChat channel
 * told Tencent "Mirrai/1.0.0" on every release, and the two desktop
 * builds disagreed about which release they were.
 *
 * The package file is the one place the version is written down, so
 * it is read from there. The environment still wins, so an operator
 * can say otherwise.
 */
function resolveAppVersion(): string {
  const configured = process.env.APP_VERSION?.trim();
  if (configured) return configured;

  // dist/index.js -> the package root is one level up; the source is
  // two.
  const candidates = [
    path.resolve(fileURLToPath(import.meta.url), "..", "..", "package.json"),
    path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // The next candidate.
    }
  }
  return "0.0.0";
}

export const ENV = {
  cookieSecret: resolveJwtSecret(),
  databaseUrl: resolveDatabaseUrl(),
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
  appVersion: resolveAppVersion(),

  pythonPath: process.env.PYTHON_PATH ?? "python3",
  skillEngineDir: resolveSkillEngineDir(),

  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",

  /**
   * The proxies whose `X-Forwarded-For` header may be believed.
   *
   * Empty by default: a header that anybody can set is not evidence of
   * anything, and believing it makes the rate limits — the only defence
   * against credential stuffing — a matter of sending one more header.
   *
   * An operator who puts the app behind nginx sets this to the proxy's
   * address (`127.0.0.1`, or the Docker network's), and the header is
   * read again.
   */
  trustedProxies: parseAddressList(process.env.TRUSTED_PROXIES),

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

  /**
   * Whether the read-aloud button may be used.
   *
   * The voice is Microsoft's *online* Edge read-aloud service: the text
   * of the reply is streamed to Microsoft and the audio comes back.
   *
   * That is the one thing the app does that leaves the machine — and
   * the app's own promise is that the data does not. So it can be
   * switched off, and the interface says so when it is.
   *
   * An operator who wants the promise kept exactly sets this to false.
   */
  ttsEnabled: (process.env.TTS_ENABLED ?? "true").toLowerCase() !== "false",
};
