/**
 * Collector contracts and the registry of chat-history sources.
 *
 * The Python collectors under `skill-engine/tools/` were written before the
 * TypeScript server existed and nothing referenced them. This module is the
 * seam that makes them usable: every source is described as a
 * `SourceConnector` (which tool to run, how to check credentials, how to turn
 * the tool's output into the shared `CollectResult` contract) so the server
 * can treat Feishu, DingTalk, Slack, e-mail and WeChat exports the same way.
 *
 * Layering:
 *   types.ts   — contracts + the connector registry (this file)
 *   runner.ts  — process execution + output normalisation
 *   jobs.ts    — the in-process job queue that drives the connectors
 */
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { encryptSecret } from "../_core/crypto";
import { normaliseCollectorOutput, parseNormalisedPayload, runCollector } from "./runner";
import { copy } from "@shared/copy";
import { zonedOffsetMinutes } from "@shared/timezone";

export type CollectorSourceId = "feishu" | "dingtalk" | "slack" | "email" | "wechat_export";

export interface CollectedMessage {
  role: "user" | "assistant";
  content: string;
  /** ISO 8601 if known. */
  timestamp?: string;
  source?: string;
}

export interface CollectResult {
  messages: CollectedMessage[];
  meta: {
    total: number;
    source: CollectorSourceId;
    truncated?: boolean;
    /**
     * What the collector said, when it found nothing.
     *
     * The collectors write the reason into their transcript — "the bot
     * is not in the chat", "Playwright is not installed", "not logged
     * in" — and the server read the JSON payload first and never opened
     * the transcript. So the run was reported as a *success* with zero
     * messages, and the reason was thrown away.
     */
    note?: string;
  };
}

export interface CollectorAuthState {
  ok: boolean;
  /** Human-readable reason when not ok. */
  message?: string;
  /** Whether the operator must complete an interactive step. */
  requiresInteraction?: boolean;
}

/**
 * A connector's credentials in plaintext, keyed by the collector's config key
 * (`app_id`, `app_secret`, `bot_token`, …).
 *
 * Plaintext never leaves the process: the connector encrypts the blob before
 * it is persisted and the store decrypts it when it is read back.
 */
export type CollectorCredentials = Record<string, string>;

export interface CollectInput {
  /** Target person on the platform. */
  target?: string;
  /** Limit on how many messages to collect. */
  limit?: number;
  /**
   * Free-form extra settings (credentials are injected separately).
   *
   * Connectors may also read internal keys from here — most notably
   * `outputDir`, which `collect()` injects before building the CLI arguments
   * so that `args()` stays the single source of truth for the argv.
   */
  options?: Record<string, string>;
  /** Credentials / config for the source. */
  config?: Record<string, unknown>;
  /**
   * Whose collection this is.
   *
   * The credentials restored from the database are the user's own, and
   * they are held under the user's id: they used to be held under the
   * source alone, so one user's credentials were used for another
   * user's collection.
   */
  userId?: number | null;
  /**
   * The reader's own time zone.
   *
   * The collectors bring back the user's own history, and a timestamp
   * that names a wall clock but no zone is the reader's clock. It used
   * to be read in the *server's* zone, so on a server in another
   * country every message landed at the wrong hour, and often on the
   * wrong day.
   */
  timezone?: string;
  /**
   * The language the reader reads.
   *
   * The collectors report what went wrong in words, and those words
   * are read by a person.
   */
  locale?: "zh" | "en";
  /** Progress sink (0..100) injected by the job runner. */
  onProgress?: (pct: number) => void;
  /** Cancellation signal injected by the job runner. */
  signal?: AbortSignal;
}

export interface SourceConnector {
  id: CollectorSourceId;
  /** The name of the source, in the language it is listed in. */
  label: string;
  /**
   * The name of the source, in the language asked for.
   *
   * The source is picked by name, so the name has to be readable by the
   * person picking it. A source that cannot say its own name in the
   * language of the interface is a source nobody finds.
   */
  labelForLocale?(locale: "zh" | "en"): string;
  /** True when the source needs Playwright + a Chromium download. */
  requiresBrowser?: boolean;
  /**
   * Whether the source needs the user's own browser profile.
   *
   * The DingTalk source reads the message history by driving a browser,
   * and the browser's login *is* the credential — so the profile has to
   * be the user's own and it has to be named. There was nowhere to
   * name it: the procedure that starts a collection did not accept
   * one, so the source could be authorised and could never collect.
   */
  needsChromeProfile?: boolean;
  /** Python tool this connector drives, relative to skill-engine/tools/. */
  tool: string;
  /** CLI arguments, excluding the tool name. */
  args(input: CollectInput): string[];
  checkAuth(input: CollectInput): Promise<CollectorAuthState>;
  collect(input: CollectInput): Promise<CollectResult>;
  /**
   * The credential keys this source uses. Empty for sources that need none.
   */
  credentialKeys?: string[];
  /**
   * Returns the credentials of this source, encrypted for storage.
   *
   * The returned blob is what `server/collectors/db-store.ts` writes into the
   * `config` column of `collection_sources`; `null` when the source has no
   * credentials at all.
   */
  exportCredentials?(input: CollectInput): Promise<string | null>;
  /**
   * Configures the connector from a credential blob that has already been
   * decrypted, so a stored source can be collected from again.
   */
  importCredentials?(credentials: CollectorCredentials, userId?: number | null): void;
}

/**
 * Where the Python collectors keep their credentials.
 *
 * Every collector defines `CONFIG_PATH = Path.home() / ".colleague-skill" /
 * <source>_config.json`; Mirrai reads the same files so the operator only has
 * to run the `--setup` flow of the tool once.
 */

/**
 * The file each collector reads its credentials from.
 *
 * The Python tools keep them in `~/.colleague-skill/<source>_config.json`
 * — a file on the machine, belonging to whoever set it up.
 */
const CONNECTOR_CONFIG_FILES: Record<CollectorSourceId, string> = {
  feishu: "feishu_config.json",
  dingtalk: "dingtalk_config.json",
  slack: "slack_config.json",
  email: "email_config.json",
  wechat_export: "wechat_export_config.json",
};

/**
 * Credentials that were restored from the database (already decrypted).
 *
 * The collectors keep their credentials in `~/.colleague-skill/*_config.json`;
 * once a source has been stored, the database copy is authoritative, so it
 * takes precedence over the local file but not over an explicitly supplied
 * credential.
 *
 * They are keyed by the user as well as the source, and there is no
 * shared slot any more.
 *
 * They used to be keyed by the source alone, and the map was never
 * emptied: so a user who ran a collection without a stored source of
 * their own was handed *another user's* credentials — and that other
 * user's chat history was imported into their persona.
 *
 * The keying was fixed and the shared slot was left behind — and the
 * shared slot was where every credential ended up, because the procedure
 * that saves them did not pass the user id. So the leak was still there,
 * in a different shape.
 */
const restoredCredentials = new Map<string, CollectorCredentials>();

/** The key a source's restored credentials are held under. */
function restoredKey(source: CollectorSourceId, userId?: number | null): string {
  // There is no shared slot. A credential without a user does not belong
  // to anybody, so it is not kept.
  if (userId === undefined || userId === null) return "";
  return `${userId}:${source}`;
}

/** Replaces the credentials a connector uses (plaintext in, plaintext kept). */
export function setRestoredCredentials(
  source: CollectorSourceId,
  credentials: CollectorCredentials,
  userId?: number | null,
): void {
  const key = restoredKey(source, userId);
  // Without a user there is no owner, so there is nowhere to keep it.
  if (!key) return;
  restoredCredentials.set(key, { ...credentials });
}

/** Forgets the credentials restored for a source. */
export function clearRestoredCredentials(
  source: CollectorSourceId,
  userId?: number | null,
): void {
  const key = restoredKey(source, userId);
  if (!key) return;
  restoredCredentials.delete(key);
}

/**
 * Collects the credential values a connector should use.
 *
 * Priority: explicitly supplied config → the credentials restored for
 * *this* user.
 *
 * There is deliberately no third source.
 *
 * The machine's own configuration file — `~/.colleague-skill/<source>
 * _config.json` — used to be the last one. It holds the credentials of
 * whoever ran the collector's `--setup` on this machine: the operator.
 * So a user who had never authorised a source still got a run, and the
 * run authenticated as the operator — and the operator's chat history
 * was imported into the user's own persona.
 *
 * That is the same cross-user leak the shared in-memory slot was, with
 * the operator as the "other user".
 */
function collectCredentials(
  source: CollectorSourceId,
  input: CollectInput,
  keys: string[],
  configFile?: string,
  userId?: number | null,
): CollectorCredentials {
  const inline = input.config;
  /**
   * The credentials restored for *this* user.
   *
   * There is no shared slot to fall back to. There was one, and it was
   * where every user's credentials ended up — so a user who had no
   * stored source of their own was handed another user's token, and
   * that other user's chat history was imported into their persona.
   */
  const restored = userId === undefined || userId === null
    ? undefined
    : restoredCredentials.get(restoredKey(source, userId));

  const values: CollectorCredentials = {};
  for (const key of keys) {
    const value =
      configString(inline, key) ??
      configString(restored, key);
    if (value) values[key] = value;
  }
  return values;
}

/**
 * Encrypts a credential map for storage.
 *
 * The blob is what ends up in `collection_sources.config`; it is decrypted
 * again by `server/collectors/db-store.ts` when the source is read back.
 */
async function encryptCredentials(values: CollectorCredentials): Promise<string | null> {
  if (Object.keys(values).length === 0) return null;
  return await encryptSecret(JSON.stringify(values));
}

/** Reads a string flag out of the caller supplied config. */
function configString(config: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!config) return undefined;
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Reads the transcript a collector wrote into its `--output-dir`.
 *
 * The Feishu/DingTalk/Slack collectors do not print the transcript to stdout:
 * they write `messages.txt` (plus `docs.txt` and `collection_summary.json`)
 * into the directory given by `--output-dir` and log progress to stderr.
 */
function readCollectorTranscript(outputDir: string): string | undefined {
  const messagesPath = path.join(outputDir, "messages.txt");
  if (!existsSync(messagesPath)) return undefined;
  try {
    /**
     * The file is read in pieces, and only the first ones.
     *
     * It used to be read whole — and the cap on the collector's
     * output did not cover it. So a collector that wrote a huge
     * transcript took the server's heap with it, by a path the cap
     * was supposed to have closed.
     */
    const handle = openSync(messagesPath, "r");
    try {
      const buffer = Buffer.alloc(MAX_COLLECTOR_TRANSCRIPT_BYTES);
      const read = readSync(handle, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, read).toString("utf-8");
    } finally {
      closeSync(handle);
    }
  } catch {
    return undefined;
  }
}

/**
 * The largest transcript the server reads back.
 *
 * The same limit as the collector's output.
 */
const MAX_COLLECTOR_TRANSCRIPT_BYTES = 1024 * 1024;

/**
 * The collector's own words, as one short note.
 *
 * The transcript is a Markdown report — a heading, a list of reasons,
 * some configuration instructions. What the user needs is the reason,
 * not the whole document, and it is shown in a plain-text line.
 */
function tidyCollectorNote(transcript: string): string | undefined {
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  const note = lines.slice(0, 8).join("\n");
  return note.length > 600 ? `${note.slice(0, 600)}…` : note;
}

/**
 * A run that found nothing, with the reason the collector gave.
 */
function withEmptyNote(result: CollectResult, stderr: string): CollectResult {
  if (result.messages.length > 0) return result;
  const note = noteFromStderr(stderr);
  if (!note) return result;
  return { ...result, meta: { ...result.meta, note } };
}

/**
 * The reason a collector gave, for a run that found nothing.
 *
 * The collector writes it to its standard error — "the bot is not in
 * the chat", "Playwright is not installed", "no mail from x" — and the
 * two connectors that read their output straight from the standard
 * output threw it away. So the run was reported as a *success* with
 * zero messages and no explanation, and the persona was distilled from
 * nothing with nothing said about why.
 *
 * The text is the collector's own, so it is passed through as it was
 * written — it is a reason for a person, not a stack trace.
 */
function noteFromStderr(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Traceback"));
  if (lines.length === 0) return undefined;
  const note = lines.slice(-6).join("\n");
  return note.length > 600 ? `${note.slice(0, 600)}…` : note;
}

/**
 * Runs a collector that writes its transcript into `--output-dir`.
 *
 * The directory is created per run and removed afterwards so a failed run
 * cannot leave chat history lying around on disk.
 *
 * The collector's normalised JSON exit (stdout) is the primary payload; the
 * transcript file is only read when the collector did not print JSON, and the
 * legacy format parsers are the last resort.
 */
/**
 * The credentials of a connector, written to a file of their own.
 *
 * The Python collectors read their credentials from
 * `~/.colleague-skill/<source>_config.json` — a file on the machine,
 * belonging to whoever set it up. So a collection always
 * authenticated as the operator: a user who had authorised their own
 * Slack workspace was still reading the operator's messages, and one
 * user's collection brought the operator's chat history into another
 * user's persona.
 *
 * The file is written per run, in the run's own temporary directory,
 * and it is deleted with it. The credentials are encrypted at rest in
 * the database; this file is the plain form, and it exists only while
 * the collector runs.
 */
export function connectorCredentials(
  connector: SourceConnector,
  input: CollectInput,
): CollectorCredentials {
  const keys = connector.credentialKeys ?? [];
  if (keys.length === 0) return {};
  return collectCredentials(
    connector.id,
    input,
    keys,
    CONNECTOR_CONFIG_FILES[connector.id],
    input.userId,
  );
}

function writeCredentialFile(
  connector: SourceConnector,
  input: CollectInput,
  dir: string,
): string | null {
  const credentials = connectorCredentials(connector, input);
  if (Object.keys(credentials).length === 0) return null;
  const file = path.join(dir, `${connector.id}_config.json`);
  writeFileSync(file, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  return file;
}

/**
 * The temp directories the collectors left behind.
 *
 * A collector removes its own directory when it finishes — but a
 * collector that was killed (the machine slept, the process was
 * stopped, the app was quit) leaves it: the transcript it fetched, the
 * credential file it wrote, the browser profile it made.
 *
 * So every collector tidies up the ones that are old enough to be
 * certainly nobody's. The young ones belong to a collector that is
 * running right now, and they are left alone.
 */
export function cleanStaleCollectorDirs(
  currentDir: string,
  maxAgeMs = 60 * 60 * 1000,
  root: string = os.tmpdir(),
): number {
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.startsWith("mirrai-collector-")) continue;
    const full = path.join(root, name);
    if (full === currentDir) continue;
    let age: number;
    try {
      age = Date.now() - statSync(full).mtimeMs;
    } catch {
      // It is gone already, or it cannot be read.
      continue;
    }
    if (age < maxAgeMs) continue;
    try {
      rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      // Another process has it, or the disk says no. It will be tried
      // again the next time.
    }
  }
  return removed;
}

async function collectViaOutputDir(
  connector: SourceConnector,
  input: CollectInput,
): Promise<CollectResult> {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collector-"));
  // The ones that were left behind by collectors that did not finish.
  cleanStaleCollectorDirs(outputDir);
  try {
    const effective: CollectInput = {
      ...input,
      options: { ...(input.options ?? {}), outputDir },
    };
    const args = connector.args(effective);
    /**
     * The credentials go into a file of their own.
     *
     * The tools read them from the machine's configuration file, so
     * without this every collection ran as the operator.
     */
    const credentialFile = writeCredentialFile(connector, effective, outputDir);
    /**
     * A source that needs credentials and has none is not run.
     *
     * The collector used to be started anyway — and it read the
     * machine's own configuration file, so it ran as the operator. Now
     * there is nothing for it to read, so the run says what is missing
     * instead of importing somebody else's history.
     */
    if (!credentialFile && (connector.credentialKeys ?? []).length > 0) {
      throw new Error(copy(effective.locale ?? "zh", "errors.collectorNeedsAuthorization"));
    }
    if (credentialFile) args.push("--config", credentialFile);
    const { stdout, stderr, stdoutTruncated } = await runCollector(connector.tool, args, {
      onProgress: input.onProgress,
      signal: input.signal,
      locale: input.locale,
    });
    const normalised = parseNormalisedPayload(stdout, connector.id, {
      target: input.target,
      limit: input.limit,
      timeZone: input.timezone,
    });
    if (normalised) {
      /**
       * Nothing was found — and the collector says why.
       *
       * The JSON payload is read first, so the transcript was never
       * opened: the run was reported as a *success* with zero messages,
       * and the reason the collector had written down — "the bot is not
       * in the chat", "Playwright is not installed", "not logged in" —
       * was thrown away. So the persona was then distilled from nothing,
       * and the real reason was nowhere.
       */
      if (normalised.messages.length === 0) {
        const transcript = readCollectorTranscript(outputDir);
        const note = transcript ? tidyCollectorNote(transcript) : undefined;
        if (note) {
          return { ...normalised, meta: { ...normalised.meta, note } };
        }
      }
      /**
       * The output was cut short.
       *
       * The flag was dropped here — so when a collector's output went
       * past the cap, the JSON was cut in the middle of an object, the
       * payload could not be parsed, and the code fell back to the
       * Markdown report — which keeps only a few hundred of the
       * messages. The result was a *part* of the history, imported and
       * reported as a complete collection.
       */
      return stdoutTruncated
        ? { ...normalised, meta: { ...normalised.meta, truncated: true } }
        : normalised;
    }

    const transcript = readCollectorTranscript(outputDir);
    const raw = transcript ?? stdout;
    if (!raw.trim()) {
      /**
       * The stderr is for the log.
       *
       * It is a Python traceback, and a traceback says where the tool
       * lives on the operator's machine. It was shown in the browser
       * word for word.
       */
      console.error(
        `[Collector] ${connector.tool} produced no transcript:`,
        stderr.trim().slice(-500),
      );
      throw new Error(
        copy(effective.locale ?? "zh", "errors.collectorNoTranscript", {
          source: connector.id,
        }),
      );
    }
    return normaliseCollectorOutput(raw, connector.id, {
      target: input.target,
      limit: input.limit,
      timeZone: input.timezone,
      locale: input.locale,
    });
  } finally {
    /**
     * The directory is removed — but a failure to remove it does not
     * take the run's own outcome with it.
     *
     * The removal used to be able to throw, and it threw *from inside
     * the finally*, which replaced whatever the run had already thrown.
     * So the user saw "EBUSY: operation failed, rmdir" instead of
     * "已取消" — and the directory, which holds the plaintext
     * credential file this run wrote, was left on disk.
     *
     * On Windows that is the likely path: the child is only *asked* to
     * stop, and it can still be holding the files open for a moment
     * after.
     */
    try {
      rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error(
        `[Collector] could not remove the run directory ${outputDir}:`,
        (error as Error).message,
      );
    }
  }
}

/**
 * The flag that asks a collector for the normalised JSON exit.
 *
 * The Python collectors print exactly one JSON object when it is present, so
 * the server never has to parse a vendor-specific report format.
 */
const JSON_FORMAT_ARGS = ["--format", "json"];

/** Feishu (飞书) via the open-platform app API.
 *
 * Uses `feishu_auto_collector.py`; `feishu_browser.py` (Playwright, reuses a
 * local Chrome profile) and `feishu_mcp_client.py` (wraps the `feishu-mcp`
 * npm server) are alternative transports for the same source and are not
 * driven by default because they need a logged-in browser / an npx install.
 */
const FEISHU_CREDENTIAL_KEYS = [
  "app_id",
  "app_secret",
  "user_access_token",
  "p2p_chat_id",
  "open_id",
];

const feishuConnector: SourceConnector = {
  id: "feishu",
  label: copy("zh", "labels.collector.feishu"),
  labelForLocale: (locale: "zh" | "en") => copy(locale, "labels.collector.feishu"),
  requiresBrowser: false,
  tool: "feishu_auto_collector.py",
  credentialKeys: FEISHU_CREDENTIAL_KEYS,
  args(input: CollectInput): string[] {
    const argv: string[] = [...JSON_FORMAT_ARGS];
    if (input.target) argv.push("--name", input.target);
    if (input.options?.outputDir) argv.push("--output-dir", input.options.outputDir);
    if (input.limit) argv.push("--msg-limit", String(input.limit));
    /**
     * The reader's own time zone.
     *
     * The collectors turn an epoch into a wall clock, and the wall
     * clock they wrote was the *machine's*. So on a server in another
     * country every message landed at the wrong hour — and the server
     * then read it back in the reader's zone, which shifted it again.
     */
    if (input.timezone) {
      argv.push("--timezone", input.timezone);
      /**
       * The reader's own offset, in minutes.
       *
       * The zone *name* needs the IANA database, and `zoneinfo` has no
       * database of its own: on Windows there is none, and on Alpine
       * there is none unless it is installed. So the zone was silently
       * ignored and the messages were rendered in the *machine's* clock
       * — eight hours out for a Shanghai reader on a UTC server, and
       * often on the wrong day.
       *
       * The offset needs no database at all, so it is passed as well
       * and used when the zone cannot be loaded.
       */
      argv.push("--timezone-offset", String(zonedOffsetMinutes(new Date(), input.timezone)));
    }
    const credentials = collectCredentials(
      "feishu",
      input,
      FEISHU_CREDENTIAL_KEYS,
      "feishu_config.json",
      input.userId,
    );
    if (credentials.open_id) argv.push("--open-id", credentials.open_id);
    /**
     * The token is not on the command line.
     *
     * It used to be — and every other process on the machine could see
     * it in the process list. It goes in the credential file now, which
     * the collector reads.
     */
    return argv;
  },
  async checkAuth(input: CollectInput): Promise<CollectorAuthState> {
    const credentials = collectCredentials(
      "feishu",
      input,
      FEISHU_CREDENTIAL_KEYS,
      "feishu_config.json",
      input.userId,
    );
    if (credentials.app_id && credentials.app_secret) {
      return { ok: true };
    }
    return {
      ok: false,
      message: copy(input.locale ?? "zh", "collectors.feishuNeedsCredentials"),
      requiresInteraction: true,
    };
  },
  async exportCredentials(input: CollectInput): Promise<string | null> {
    return await encryptCredentials(
      collectCredentials("feishu", input, FEISHU_CREDENTIAL_KEYS, "feishu_config.json", input.userId),
    );
  },
  importCredentials(credentials: CollectorCredentials, userId?: number | null): void {
    setRestoredCredentials("feishu", credentials, userId);
  },
  async collect(input: CollectInput): Promise<CollectResult> {
    /**
     * The name is required — or the open id, which the user can have
     * saved in their credentials.
     *
     * The tool needs one of them: without it, it exits with code 2 and
     * prints nothing useful — so the user saw "the collector
     * feishu_auto_collector.py did not finish (exit code 2)": an
     * internal file name and an exit code, with no hint that a name
     * was what was missing.
     */
    const feishuCredentials = collectCredentials(
      "feishu",
      input,
      FEISHU_CREDENTIAL_KEYS,
      "feishu_config.json",
      input.userId,
    );
    if (!input.target && !feishuCredentials.open_id) {
      throw new Error(
        copy(input.locale ?? "zh", "errors.collectorNeedsTarget", {
          source: sourceLabel(feishuConnector, input.locale ?? "zh"),
        }),
      );
    }
    return collectViaOutputDir(feishuConnector, input);
  },
};

/**
 * DingTalk (钉钉) via the open API.
 *
 * The DingTalk API cannot read historical messages, so the collector falls
 * back to Playwright scraping a local Chrome profile — hence
 * `requiresBrowser: true`.
 */
const DINGTALK_CREDENTIAL_KEYS = ["app_key", "app_secret"];

const dingtalkConnector: SourceConnector = {
  id: "dingtalk",
  label: copy("zh", "labels.collector.dingtalk"),
  /**
   * The browser profile has to be named.
   *
   * There was nowhere to name it — so the source could be authorised
   * and could never collect.
   */
  needsChromeProfile: true,
  labelForLocale: (locale: "zh" | "en") => copy(locale, "labels.collector.dingtalk"),
  requiresBrowser: true,
  tool: "dingtalk_auto_collector.py",
  credentialKeys: DINGTALK_CREDENTIAL_KEYS,
  args(input: CollectInput): string[] {
    const argv: string[] = [...JSON_FORMAT_ARGS];
    if (input.target) argv.push("--name", input.target);
    if (input.options?.outputDir) argv.push("--output-dir", input.options.outputDir);
    if (input.limit) argv.push("--msg-limit", String(input.limit));
    /**
     * The reader's own time zone.
     *
     * The collectors turn an epoch into a wall clock, and the wall
     * clock they wrote was the *machine's*. So on a server in another
     * country every message landed at the wrong hour — and the server
     * then read it back in the reader's zone, which shifted it again.
     */
    if (input.timezone) {
      argv.push("--timezone", input.timezone);
      /**
       * The reader's own offset, in minutes.
       *
       * The zone *name* needs the IANA database, and `zoneinfo` has no
       * database of its own: on Windows there is none, and on Alpine
       * there is none unless it is installed. So the zone was silently
       * ignored and the messages were rendered in the *machine's* clock
       * — eight hours out for a Shanghai reader on a UTC server, and
       * often on the wrong day.
       *
       * The offset needs no database at all, so it is passed as well
       * and used when the zone cannot be loaded.
       */
      argv.push("--timezone-offset", String(zonedOffsetMinutes(new Date(), input.timezone)));
    }
    if (input.options?.chrome_profile) argv.push("--chrome-profile", input.options.chrome_profile);
    if (input.options?.show_browser === "true") argv.push("--show-browser");
    return argv;
  },
  async checkAuth(input: CollectInput): Promise<CollectorAuthState> {
    const credentials = collectCredentials(
      "dingtalk",
      input,
      DINGTALK_CREDENTIAL_KEYS,
      "dingtalk_config.json",
      input.userId,
    );
    if (!credentials.app_key || !credentials.app_secret) {
      return {
        ok: false,
        message: copy(input.locale ?? "zh", "collectors.dingtalkNeedsCredentials"),
        requiresInteraction: true,
      };
    }
    return {
      ok: true,
      message: copy(input.locale ?? "zh", "collectors.dingtalkNeedsPlaywright"),
    };
  },
  async exportCredentials(input: CollectInput): Promise<string | null> {
    return await encryptCredentials(
      collectCredentials("dingtalk", input, DINGTALK_CREDENTIAL_KEYS, "dingtalk_config.json", input.userId),
    );
  },
  importCredentials(credentials: CollectorCredentials, userId?: number | null): void {
    setRestoredCredentials("dingtalk", credentials, userId);
  },
  async collect(input: CollectInput): Promise<CollectResult> {
    /**
     * The browser profile has to be named.
     *
     * DingTalk's message history is read by driving a browser, and the
     * browser's login *is* the credential. The collector used to fall
     * back to the machine's own Chrome profile — the operator's, with
     * the operator's DingTalk logged in — so a user who asked for a
     * collection got the operator's chat history, imported into their
     * own persona.
     */
    if (!input.options?.chrome_profile) {
      throw new Error(copy(input.locale ?? "zh", "errors.collectorNeedsChromeProfile"));
    }
    // The name is required — see the Feishu connector above.
    if (!input.target) {
      throw new Error(
        copy(input.locale ?? "zh", "errors.collectorNeedsTarget", {
          source: sourceLabel(dingtalkConnector, input.locale ?? "zh"),
        }),
      );
    }
    return collectViaOutputDir(dingtalkConnector, input);
  },
};

/** Slack via a bot token (`xoxb-…`). */
const SLACK_CREDENTIAL_KEYS = ["bot_token"];

const slackConnector: SourceConnector = {
  id: "slack",
  label: copy("zh", "collectors.slack"),
  labelForLocale: (locale: "zh" | "en") => copy(locale, "collectors.slack"),
  requiresBrowser: false,
  tool: "slack_auto_collector.py",
  credentialKeys: SLACK_CREDENTIAL_KEYS,
  args(input: CollectInput): string[] {
    const argv: string[] = [...JSON_FORMAT_ARGS];
    if (input.target) argv.push("--name", input.target);
    if (input.options?.outputDir) argv.push("--output-dir", input.options.outputDir);
    if (input.limit) argv.push("--msg-limit", String(input.limit));
    /**
     * The reader's own time zone.
     *
     * The collectors turn an epoch into a wall clock, and the wall
     * clock they wrote was the *machine's*. So on a server in another
     * country every message landed at the wrong hour — and the server
     * then read it back in the reader's zone, which shifted it again.
     */
    if (input.timezone) {
      argv.push("--timezone", input.timezone);
      /**
       * The reader's own offset, in minutes.
       *
       * The zone *name* needs the IANA database, and `zoneinfo` has no
       * database of its own: on Windows there is none, and on Alpine
       * there is none unless it is installed. So the zone was silently
       * ignored and the messages were rendered in the *machine's* clock
       * — eight hours out for a Shanghai reader on a UTC server, and
       * often on the wrong day.
       *
       * The offset needs no database at all, so it is passed as well
       * and used when the zone cannot be loaded.
       */
      argv.push("--timezone-offset", String(zonedOffsetMinutes(new Date(), input.timezone)));
    }
    if (input.options?.channel_limit) argv.push("--channel-limit", input.options.channel_limit);
    return argv;
  },
  async checkAuth(input: CollectInput): Promise<CollectorAuthState> {
    const credentials = collectCredentials(
      "slack",
      input,
      SLACK_CREDENTIAL_KEYS,
      "slack_config.json",
      input.userId,
    );
    if (!credentials.bot_token) {
      return {
        ok: false,
        message: copy(input.locale ?? "zh", "collectors.slackNeedsToken"),
        requiresInteraction: true,
      };
    }
    return { ok: true };
  },
  async exportCredentials(input: CollectInput): Promise<string | null> {
    return await encryptCredentials(
      collectCredentials("slack", input, SLACK_CREDENTIAL_KEYS, "slack_config.json", input.userId),
    );
  },
  importCredentials(credentials: CollectorCredentials, userId?: number | null): void {
    setRestoredCredentials("slack", credentials, userId);
  },
  async collect(input: CollectInput): Promise<CollectResult> {
    // The name is required — see the Feishu connector above.
    if (!input.target) {
      throw new Error(
        copy(input.locale ?? "zh", "errors.collectorNeedsTarget", {
          source: sourceLabel(slackConnector, input.locale ?? "zh"),
        }),
      );
    }
    return collectViaOutputDir(slackConnector, input);
  },
};

/**
 * E-mail history.
 *
 * `email_parser.py` prints its Markdown report to stdout when no `--output`
 * is given, so the report itself is the payload that gets normalised.
 */
const emailConnector: SourceConnector = {
  id: "email",
  label: copy("zh", "labels.collector.email"),
  labelForLocale: (locale: "zh" | "en") => copy(locale, "labels.collector.email"),
  requiresBrowser: false,
  tool: "email_parser.py",
  credentialKeys: [],
  args(input: CollectInput): string[] {
    const argv: string[] = [...JSON_FORMAT_ARGS];
    if (input.options?.file) argv.push("--file", input.options.file);
    if (input.target) argv.push("--target", input.target);
    return argv;
  },
  async checkAuth(input: CollectInput): Promise<CollectorAuthState> {
    return {
      ok: true,
      message: copy(input.locale ?? "zh", "collectors.emailNeedsNoCredentials"),
    };
  },
  async exportCredentials(): Promise<string | null> {
    // Parsing a mail export needs no credentials.
    return null;
  },
  importCredentials(): void {
    // Nothing to restore.
  },
  async collect(input: CollectInput): Promise<CollectResult> {
    /**
     * The message says what to do.
     *
     * It used to be an English sentence about a missing option — so a
     * Chinese reader was told, in English, that a collector required
     * `options.file`.
     */
    if (!input.options?.file) {
      throw new Error(copy(input.locale ?? "zh", "errors.collectorNeedsFile"));
    }
    if (!input.target) {
      throw new Error(
        copy(input.locale ?? "zh", "errors.collectorNeedsTarget", { source: sourceLabel(emailConnector, input.locale ?? "zh") }),
      );
    }
    const { stdout, stderr, stdoutTruncated } = await runCollector(emailConnector.tool, emailConnector.args(input), {
      onProgress: input.onProgress,
      signal: input.signal,
      locale: input.locale,
    });
    const result = normaliseCollectorOutput(stdout, emailConnector.id, {
      target: input.target,
      limit: input.limit,
      truncated: stdoutTruncated,
      timeZone: input.timezone,
      locale: input.locale,
    });
    return withEmptyNote(result, stderr);
  },
};

/**
 * WeChat chat-history export.
 *
 * Mirrai ships no dedicated WeChat collector, so this source reuses
 * `feishu_parser.py`: it is a generic export parser that understands a JSON
 * array of `{ sender, content, timestamp }` records (the shape WeChat JSON
 * exports use) and TXT lines of `时间 发送人：内容`. WeChat's native
 * `发送人(时间)` TXT layout is *not* understood by that tool — the operator
 * has to convert the export to JSON first.
 */
const wechatExportConnector: SourceConnector = {
  id: "wechat_export",
  label: copy("zh", "labels.collector.wechatExport"),
  labelForLocale: (locale: "zh" | "en") => copy(locale, "labels.collector.wechatExport"),
  requiresBrowser: false,
  tool: "feishu_parser.py",
  credentialKeys: [],
  args(input: CollectInput): string[] {
    /**
     * The normalised JSON, not the Markdown report.
     *
     * The report is the only output the parser used to have — and the
     * report writes the first hundred daily messages and drops the
     * rest. So a WeChat export of five thousand short messages reached
     * the server as a hundred, and nothing said the rest were gone.
     */
    const argv: string[] = ["--format", "json"];
    if (input.options?.file) argv.push("--file", input.options.file);
    if (input.target) argv.push("--target", input.target);
    return argv;
  },
  async checkAuth(input: CollectInput): Promise<CollectorAuthState> {
    return {
      ok: true,
      message: copy(input.locale ?? "zh", "collectors.wechatNeedsNoCredentials"),
    };
  },
  async collect(input: CollectInput): Promise<CollectResult> {
    if (!input.options?.file) {
      throw new Error(copy(input.locale ?? "zh", "errors.collectorNeedsFile"));
    }
    if (!input.target) {
      throw new Error(
        copy(input.locale ?? "zh", "errors.collectorNeedsTarget", { source: sourceLabel(wechatExportConnector, input.locale ?? "zh") }),
      );
    }
    const { stdout, stderr, stdoutTruncated } = await runCollector(
      wechatExportConnector.tool,
      wechatExportConnector.args(input),
      { onProgress: input.onProgress, signal: input.signal, locale: input.locale },
    );
    const result = normaliseCollectorOutput(stdout, wechatExportConnector.id, {
      target: input.target,
      limit: input.limit,
      truncated: stdoutTruncated,
      timeZone: input.timezone,
      locale: input.locale,
    });
    return withEmptyNote(result, stderr);
  },
};

/**
 * Every chat-history source Mirrai can collect from.
 *
 * The order is the order the UI is expected to present them in.
 */
export const COLLECTOR_SOURCES: SourceConnector[] = [
  feishuConnector,
  dingtalkConnector,
  slackConnector,
  emailConnector,
  wechatExportConnector,
];

/**
 * The name of a collection source, in the language asked for.
 *
 * The label a source carries is the name it is listed under; the person
 * reading the list may be reading in the other language.
 */
export function sourceLabel(source: SourceConnector, locale: "zh" | "en" = "zh"): string {
  return source.labelForLocale ? source.labelForLocale(locale) : source.label;
}
