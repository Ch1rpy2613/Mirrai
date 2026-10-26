/**
 * Subprocess execution and output normalisation for the Python collectors.
 *
 * `server/skill-engine/runner.ts` already establishes the convention of
 * running a tool with `ENV.pythonPath` inside `ENV.skillEngineDir`. This
 * module keeps that convention but adds what a collector needs and a skill
 * tool does not: streaming progress, a generous timeout, cancellation and a
 * defensive parser that turns whatever the collector printed into the shared
 * `CollectResult` contract.
 */
import { spawn, type ChildProcess } from "child_process";
import { ENV } from "../_core/env";
import { subprocessEnvironment } from "../_core/subprocess-env";
import { zonedOffsetMinutes } from "@shared/timezone";
import type { CollectedMessage, CollectorSourceId, CollectResult } from "./types";

/** Default budget for a single collector run (30 minutes). */
export const DEFAULT_COLLECTOR_TIMEOUT_MS = 30 * 60 * 1000;

/** Grace period between SIGTERM and SIGKILL when a child has to be stopped. */
const KILL_GRACE_MS = 5_000;

export interface RunCollectorOptions {
  /** Hard timeout for the child process. */
  timeoutMs?: number;
  /** Called with an integer 0..100 whenever the tool reports progress. */
  onProgress?: (pct: number) => void;
  /** Cancels the child process when aborted. */
  signal?: AbortSignal;
}

/**
 * Parses one line of the `[PROGRESS] <float>` protocol.
 *
 * The value is a fraction between 0 and 1 (the collectors' own convention for
 * "how far along am I") and is returned as a 0..100 integer. A value larger
 * than 1 is treated as an already-scaled percentage, and anything that does
 * not match the protocol returns `null` so the caller can ignore the line.
 */
export function parseProgressLine(line: string): number | null {
  const match = /^\[PROGRESS\]\s*([0-9]+(?:\.[0-9]+)?)\s*$/i.exec(line.trim());
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  if (value <= 1) return Math.round(value * 100);
  return Math.min(100, Math.round(value));
}

/**
 * Stops a child process, escalating to SIGKILL when it ignores SIGTERM.
 *
 * The whole *group* is stopped, not just the child.
 *
 * The DingTalk collector drives a browser through Playwright — and that
 * browser is a grandchild. So a timeout or a cancellation left the
 * Chromium running: it kept a profile open, kept a window on the
 * operator's desktop, and went on fetching.
 */
function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const signalGroup = (signal: NodeJS.Signals) => {
    if (typeof child.pid !== "number") return;
    try {
      // The negative pid is the whole group.
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group is gone, or it was never one. The child itself is
      // still signalled below.
    }
    try {
      child.kill(signal);
    } catch {
      // It is already gone.
    }
  };
  signalGroup("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      signalGroup("SIGKILL");
    }
  }, KILL_GRACE_MS);
  timer.unref();
}

/**
 * The environment a collector is given.
 *
 * It is the same environment every Python script of the app is given —
 * see `server/_core/subprocess-env.ts`.
 */
function collectorEnvironment(): NodeJS.ProcessEnv {
  return subprocessEnvironment();
}

/**
 * How much of a collector's output is kept.
 *
 * The buffers grew for the whole run — up to half an hour — so a
 * chatty or looping collector could exhaust the server's heap, and the
 * heap is the process: the whole server goes down, not just the job.
 */
const MAX_COLLECTOR_OUTPUT_CHARS = 1024 * 1024;

/**
 * The largest partial line the collector's buffer keeps.
 *
 * The output was capped, but the *buffer* — the tail of a line that
 * has not ended yet — was not. A collector that writes one enormous
 * line (a `json.dumps` of a big structure does exactly that) made the
 * buffer grow without limit, and the split that followed copied it
 * again. The heap is the process: the whole server goes down, not
 * just the job.
 */
const MAX_COLLECTOR_LINE_CHARS = 1024 * 1024;

/**
 * Adds a chunk to a partial-line buffer, and keeps the buffer bounded.
 *
 * When the line is longer than the limit the *beginning* is dropped:
 * a progress line is at the end of the buffer, and the beginning of a
 * line that long is of no use to anybody.
 */
function appendLineCapped(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  if (next.length <= MAX_COLLECTOR_LINE_CHARS) return next;
  return next.slice(next.length - MAX_COLLECTOR_LINE_CHARS);
}

/**
 * Keeps the first part of what a collector said.
 *
 * The beginning is what matters: it is where the progress lines and the
 * first error are.
 *
 * Whether anything was cut is reported — a collector that printed more
 * than the cap was cut in the middle, and the job then said the output
 * "could not be parsed", which says nothing about why.
 */
function appendCapped(buffer: string, chunk: string): { text: string; truncated: boolean } {
  if (buffer.length >= MAX_COLLECTOR_OUTPUT_CHARS) {
    return { text: buffer, truncated: true };
  }
  const next = buffer + chunk;
  if (next.length <= MAX_COLLECTOR_OUTPUT_CHARS) return { text: next, truncated: false };
  return { text: next.slice(0, MAX_COLLECTOR_OUTPUT_CHARS), truncated: true };
}

/**
 * Runs `python3 tools/<tool>` inside the skill-engine directory.
 *
 * stdin is closed on purpose: the collectors' `--setup` flow asks for
 * credentials on stdin, and a non-interactive server must fail fast instead
 * of blocking forever on a prompt nobody can answer.
 *
 * The child is always reaped — on success, on failure, on timeout and on
 * cancellation — so no collector process is left behind.
 */
export async function runCollector(
  tool: string,
  args: string[],
  opts: RunCollectorOptions = {},
): Promise<{ stdout: string; stderr: string; stdoutTruncated?: boolean }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;

  if (opts.signal?.aborted) {
    throw new Error(`Collector "${tool}" was cancelled before it started`);
  }

  const child = spawn(ENV.pythonPath, [`tools/${tool}`, ...args], {
    cwd: ENV.skillEngineDir,
    // The child is given a small environment of its own.
    //
    // It used to inherit the server's whole environment: the session
    // signing key, the key the stored credentials are encrypted with,
    // the database URL and every provider key. The collectors are
    // third-party Python scripts that the operator may not have
    // audited, and one careless script could exfiltrate the whole
    // instance's secrets — including the ability to forge a session
    // and to decrypt the stored credentials.
    env: collectorEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    /**
     * Its own process group.
     *
     * So the browser the DingTalk collector drives — a grandchild — is
     * stopped with it. It used to survive the timeout and the
     * cancellation: a Chromium with the operator's profile open, still
     * fetching.
     */
    detached: true,
  });

  return new Promise<{ stdout: string; stderr: string; stdoutTruncated?: boolean }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const reportProgress = (line: string): void => {
      const pct = parseProgressLine(line);
      if (pct !== null) opts.onProgress?.(pct);
    };

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      const capped = appendCapped(stdout, chunk);
      stdout = capped.text;
      stdoutTruncated = stdoutTruncated || capped.truncated;
      stdoutBuffer = appendLineCapped(stdoutBuffer, chunk);
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      lines.forEach(reportProgress);
    });
    // A broken pipe on stdout must not crash the server.
    child.stdout?.on("error", () => undefined);

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      const capped = appendCapped(stderr, chunk);
      stderr = capped.text;
      stderrTruncated = stderrTruncated || capped.truncated;
      stderrBuffer = appendLineCapped(stderrBuffer, chunk);
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      lines.forEach(reportProgress);
    });
    child.stderr?.on("error", () => undefined);

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      killChild(child);
      reject(error);
    };

    const onAbort = (): void => {
      fail(new Error(`Collector "${tool}" was cancelled`));
    };

    opts.signal?.addEventListener("abort", onAbort);

    timeoutTimer = setTimeout(() => {
      fail(new Error(`Collector "${tool}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeoutTimer.unref();

    child.on("error", (error) => {
      fail(new Error(`Failed to start collector "${tool}": ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr, stdoutTruncated });
        return;
      }
      const detail = stderr.trim().slice(-500);
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(
        new Error(
          `Collector "${tool}" failed with ${reason}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
}

export interface NormaliseCollectorOptions {
  /**
   * The reader's own time zone.
   *
   * The collectors bring back the user's own history, and a timestamp
   * that names a wall clock but no zone is the reader's clock. It used
   * to be read in the *server's* zone, so on a server in another
   * country every message landed at the wrong hour, and often on the
   * wrong day.
   */
  timeZone?: string;
  /**
   * Whether the collector's output was cut off.
   *
   * The output is capped, so a collector that printed more than the cap
   * was cut in the middle — and the job then said the output "could not
   * be parsed", which says nothing about why. The e-mail and the
   * WeChat export read their whole payload from stdout, so a large
   * export failed after minutes of collecting.
   */
  truncated?: boolean;
  /** Target person, used to decide whether a message belongs to the persona. */
  target?: string;
  /** Hard cap applied after parsing. */
  limit?: number;
}

/** A `[PROGRESS] 0.42` line, as the collectors print it. */
const PROGRESS_LINE = /^\s*\[PROGRESS\]\s*[-+]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)\s*$/i;

/**
 * Removes the progress lines from a collector's output.
 *
 * The collectors print progress to stderr, but a payload that reaches stdout
 * must stay parsable: stripping the lines keeps the normalised JSON exit
 * intact even when a collector mixes the two.
 */
export function stripProgressLines(text: string): string {
  if (!text) return "";
  if (!text.includes("[PROGRESS]")) return text;
  return text
    .split("\n")
    .filter((line) => !PROGRESS_LINE.test(line))
    .join("\n");
}

/**
 * Role markers used by chat transcripts (`用户：…`, `TA: …`, …).
 *
 * i18n:allow-input — these are the markers a pasted transcript actually
 * uses, so they are matched against the input rather than shown to anyone.
 */
const ROLE_MARKER = /^\s*(用户|我方|我|对方|TA|User|Me|Assistant|AI|机器人|分身)\s*[:：]\s*(.*)$/i;

/** `[2024-01-01 10:00]` / `[2024-01-01 10:00][群名]` lines of the collectors' reports. */
const BRACKET_LINE = /^\[([^\]]*)\]\s*(?:\[([^\]]*)\])?\s*(.*)$/;

/** `**主题：xxx** [date]` header of the e-mail report. */
const EMAIL_SUBJECT = /^\*\*(.+?)\*\*\s*(?:\[([^\]]*)\])?\s*$/;

/** `**主题：xxx**：正文` line of the e-mail report. */
const EMAIL_INLINE = /^\*\*(.+?)\*\*\s*[：:]\s*(.*)$/;

/** Markdown noise that must never be mistaken for message content. */
function isStructuralLine(line: string): boolean {
  return (
    line.startsWith("#") ||
    line.startsWith("---") ||
    line.startsWith("===") ||
    line.startsWith("|") ||
    line.startsWith(">")
  );
}

/**
 * Maps a role marker to the message role it represents.
 *
 * i18n:allow-input — the markers are matched against what was pasted in.
 */
function roleFromMarker(marker: string): "user" | "assistant" | null {
  const key = marker.trim().toLowerCase();
  if (key === "用户" || key === "我方" || key === "我" || key === "对方" || key === "user" || key === "me") {
    return "user";
  }
  if (key === "ta" || key === "assistant" || key === "ai" || key === "机器人" || key === "分身") {
    return "assistant";
  }
  return null;
}

/** Parses JSON without throwing. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Picks the message array out of the shapes the tools emit. */
function extractMessageArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = ["messages", "records", "items", "data"];
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Pulls the message body out of the various shapes the tools emit. */
function extractContent(record: Record<string, unknown>): string {
  const keys = ["content", "text", "message", "body", "content_text"];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const parts = value
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const inner = (part as Record<string, unknown>).text;
            return typeof inner === "string" ? inner : "";
          }
          return "";
        })
        .filter((part) => part.length > 0);
      if (parts.length > 0) return parts.join(" ").trim();
    }
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      const innerKeys = ["text", "content", "title"];
      for (const innerKey of innerKeys) {
        const inner = nested[innerKey];
        if (typeof inner === "string" && inner.trim()) return inner.trim();
      }
    }
  }
  return "";
}

/** Reads the sender name out of the shapes the tools emit. */
function extractSender(record: Record<string, unknown>): string {
  const keys = ["sender", "sender_name", "from", "user_name", "author", "name"];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Decides whether a message is the persona's or the user's.
 *
 * An explicit `role` always wins. Otherwise the sender is compared with the
 * target: the target's own words are the persona's (`assistant`), everybody
 * else is the user. Without a target there is nothing to compare against, so
 * a message that carries a sender is treated as the persona's — that is what
 * the collectors gather.
 */
function resolveRole(
  record: Record<string, unknown>,
  sender: string,
  target?: string,
): "user" | "assistant" {
  const raw = record.role;
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "user" || lower === "human") return "user";
    if (lower === "assistant" || lower === "ai" || lower === "model") return "assistant";
  }
  if (target && sender) {
    return sender.includes(target) ? "assistant" : "user";
  }
  return sender ? "assistant" : "user";
}

/** Converts an epoch number (seconds or milliseconds) to an ISO string. */
function fromEpoch(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Feishu-style timestamps are milliseconds (~1e12), most others are seconds.
  const ms = value > 1e11 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * A timestamp that names a wall clock but no zone.
 *
 * "2026-03-01 14:30" is the user's own clock — it is their chat
 * history. It used to be read in the *server's* zone, so on a server
 * in another country every message landed at the wrong hour, and
 * often on the wrong day.
 */
const ZONELESS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Reads a zone-less timestamp as a wall clock in the given zone.
 *
 * Returns null when the zone is not known, or when the value is not a
 * wall clock after all.
 */
function parseZoneless(value: string, timeZone?: string): Date | null {
  const match = ZONELESS.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? "0"),
    Number(minute ?? "0"),
    Number(second ?? "0"),
  );
  if (Number.isNaN(asUtc)) return null;
  // The offset of the zone at that wall clock. It is worked out twice:
  // once for the wall clock read as UTC, and once for the instant it
  // names — the difference is the offset, and it is right across a
  // daylight-saving change.
  const firstGuess = zonedOffsetMinutes(new Date(asUtc), timeZone);
  const settled = zonedOffsetMinutes(new Date(asUtc - firstGuess * 60_000), timeZone);
  return new Date(asUtc - settled * 60_000);
}

/** Normalises a timestamp of unknown shape to ISO 8601, when it can be parsed. */
function toIsoTimestamp(value: unknown, timeZone?: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return fromEpoch(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return fromEpoch(Number(trimmed));
  // A wall clock with no zone is read in the reader's own zone.
  if (ZONELESS.test(trimmed)) {
    const zoned = parseZoneless(trimmed, timeZone);
    if (zoned) return zoned.toISOString();
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

/** Turns one JSON record into a `CollectedMessage` (or `null` when unusable). */
function toMessage(
  item: unknown,
  source: CollectorSourceId,
  target?: string,
  timeZone?: string,
): CollectedMessage | null {
  if (typeof item === "string") {
    const content = item.trim();
    return content ? { role: "user", content, source } : null;
  }
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const content = extractContent(record);
  if (!content) return null;
  const sender = extractSender(record);
  const message: CollectedMessage = {
    role: resolveRole(record, sender, target),
    content,
    source,
  };
  const timestamp = toIsoTimestamp(
    record.timestamp ?? record.create_time ?? record.time ?? record.ts ?? record.date,
    timeZone,
  );
  if (timestamp) message.timestamp = timestamp;
  return message;
}

/** Parses a JSONL payload (one JSON object per line). */
function parseJsonLines(
  text: string,
  source: CollectorSourceId,
  target?: string,
  timeZone?: string,
): CollectedMessage[] {
  const messages: CollectedMessage[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const value = tryParseJson(trimmed);
    if (value === undefined) continue;
    const message = toMessage(value, source, target, timeZone);
    if (message) messages.push(message);
  }
  return messages;
}

/**
 * Parses a transcript whose lines start with a role marker
 * (`用户：…`, `我: …`, `TA: …`, `User: …`, `Assistant: …`).
 *
 * Lines without a marker are treated as a continuation of the previous
 * message, which is how multi-line chat bubbles are exported.
 */
function parseRoleTranscript(
  text: string,
  source: CollectorSourceId,
): CollectedMessage[] {
  const messages: CollectedMessage[] = [];
  let current: CollectedMessage | undefined;
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = ROLE_MARKER.exec(line);
    if (match) {
      const role = roleFromMarker(match[1]);
      if (role) {
        current = { role, content: match[2].trim(), source };
        messages.push(current);
        continue;
      }
    }
    if (current && !isStructuralLine(line)) {
      current.content = current.content ? `${current.content}\n${line}` : line;
    }
  }
  return messages;
}

/**
 * Parses the Markdown report the collectors write.
 *
 * Two shapes are covered: the e-mail report (`**主题：…** [date]` followed by
 * the body) and the message report the Feishu/DingTalk/Slack collectors write
 * (`[time][chat] content`).
 */
function parseCollectorReport(
  text: string,
  source: CollectorSourceId,
  target?: string,
  timeZone?: string,
): CollectedMessage[] {
  const emailMessages = parseEmailReport(text, source, timeZone);
  if (emailMessages.length > 0) return emailMessages;
  return parseBracketReport(text, source, target, timeZone);
}

/** Parses the e-mail report produced by `email_parser.py`. */
function parseEmailReport(
  text: string,
  source: CollectorSourceId,
  timeZone?: string,
): CollectedMessage[] {
  const messages: CollectedMessage[] = [];
  const lines = text.split("\n");
  let current: CollectorMessageDraft | undefined;

  const flush = (): void => {
    if (!current) return;
    const body = current.body.trim();
    const content = body ? `${current.subject}\n${body}` : current.subject;
    const message: CollectedMessage = { role: "assistant", content, source };
    if (current.timestamp) message.timestamp = current.timestamp;
    messages.push(message);
    current = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const subjectMatch = EMAIL_SUBJECT.exec(line);
    if (subjectMatch) {
      flush();
      current = {
        subject: subjectMatch[1].trim(),
        body: "",
        timestamp: toIsoTimestamp(subjectMatch[2], timeZone),
      };
      continue;
    }
    const inlineMatch = EMAIL_INLINE.exec(line);
    if (inlineMatch) {
      flush();
      current = {
        subject: inlineMatch[1].trim(),
        body: inlineMatch[2].trim(),
        timestamp: undefined,
      };
      continue;
    }
    if (current) {
      // Markdown chrome (separators, headings) belongs to the report, not to
      // the mail body.
      if (isStructuralLine(line)) continue;
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  flush();
  return messages;
}

interface CollectorMessageDraft {
  subject: string;
  body: string;
  timestamp?: string;
}

/**
 * Parses the `[time][chat] content` lines of the collectors' message report.
 *
 * The second bracket is the chat name in the group sections and the speaker
 * in the private-chat section, which is the only place where the two sides
 * of a conversation are mixed.
 */
function parseBracketReport(
  text: string,
  source: CollectorSourceId,
  target?: string,
  timeZone?: string,
): CollectedMessage[] {
  const messages: CollectedMessage[] = [];
  let section = "";
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      section = line;
      continue;
    }
    if (isStructuralLine(line)) continue;
    const match = BRACKET_LINE.exec(line);
    if (!match) continue;
    const time = match[1] ?? "";
    const label = (match[2] ?? "").trim();
    const content = (match[3] ?? "").trim();
    if (!content) continue;
    const message: CollectedMessage = {
      role: bracketRole(section, label, target),
      content,
      source,
    };
    const timestamp = toIsoTimestamp(time, timeZone);
    if (timestamp) message.timestamp = timestamp;
    messages.push(message);
  }
  return messages;
}

/**
 * Decides the role of a `[time][label] content` line.
 *
 * i18n:allow-input — the section and label names are matched against what
 * the collector wrote, not shown to anybody.
 */
function bracketRole(section: string, label: string, target?: string): "user" | "assistant" {
  // Only the private-chat section mixes both sides; every other section
  // contains the target's own messages.
  if (!section.includes("私聊")) return "assistant";
  if (!label) return "assistant";
  if (label === "对方") return "user";
  if (target && label.includes(target)) return "assistant";
  return target ? "user" : "assistant";
}

/** True when the value looks like the normalised collector payload. */
function isNormalisedPayloadShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.messages);
}

/**
 * Parses the normalised payload the collectors print with `--format json`.
 *
 * The shape is fixed by the collectors:
 * `{"messages":[{"role","content","timestamp","source"}],"meta":{"total","source","truncated"}}`.
 *
 * Returns `undefined` when the output is not that payload — the caller then
 * falls back to the legacy format parsers, so a collector that does not
 * implement the JSON exit still degrades gracefully instead of losing
 * everything.
 */
export function parseNormalisedPayload(
  raw: string,
  source: CollectorSourceId,
  opts: NormaliseCollectorOptions = {},
): CollectResult | undefined {
  const text = stripProgressLines(raw ?? "").trim();
  if (!text) return undefined;

  const parsed = tryParseJson(text);
  if (parsed === undefined || !isNormalisedPayloadShape(parsed)) return undefined;

  const record = parsed as { messages: unknown[]; meta?: Record<string, unknown> };
  const messages: CollectedMessage[] = [];
  for (const item of record.messages) {
    const message = toMessage(item, source, opts.target, opts.timeZone);
    if (message) messages.push(message);
  }
  // A payload that carries messages but none of them is usable is not the
  // normalised format — let the legacy parsers have a look at it.
  if (record.messages.length > 0 && messages.length === 0) return undefined;

  const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
  const limited = limit !== undefined ? messages.slice(0, limit) : messages;
  const payloadTruncated = record.meta?.truncated === true;

  return {
    messages: limited,
    meta: {
      /**
       * How many there were.
       *
       * The total was the length of the *kept* list — so a collection
       * that was cut short said it had found exactly as many messages
       * as it kept, and nothing said the rest were left behind.
       */
      total: messages.length,
      source,
      truncated: (limit !== undefined && messages.length >= limit) || payloadTruncated,
    },
  };
}

/** Tries every supported payload shape, most explicit first. */
function parseCollectorMessages(
  text: string,
  source: CollectorSourceId,
  target?: string,
  timeZone?: string,
): CollectedMessage[] {
  const asJson = tryParseJson(text);
  if (asJson !== undefined) {
    const array = extractMessageArray(asJson);
    if (array) {
      const messages: CollectedMessage[] = [];
      for (const item of array) {
        const message = toMessage(item, source, target, timeZone);
        if (message) messages.push(message);
      }
      if (messages.length > 0) return messages;
    }
  }

  // The zone comes with it: the same payload in another format lands
  // on the right day and the right hour.
  const jsonl = parseJsonLines(text, source, target, timeZone);
  if (jsonl.length > 0) return jsonl;

  const transcript = parseRoleTranscript(text, source);
  if (transcript.length > 0) return transcript;

  return parseCollectorReport(text, source, target, timeZone);
}

/**
 * Turns a collector's raw output into the `CollectResult` contract.
 *
 * The collectors normalise their own output: with `--format json` they print
 * exactly one JSON object, and that payload is the primary path. The legacy
 * parsers (JSON array, JSONL, role transcript, Markdown report) stay as a
 * fallback so a collector that does not implement the JSON exit still works.
 * Malformed lines are skipped instead of aborting the run, and a payload that
 * cannot be understood at all raises one clear error naming the source.
 */
export function normaliseCollectorOutput(
  raw: string,
  source: CollectorSourceId,
  opts: NormaliseCollectorOptions = {},
): CollectResult {
  const text = stripProgressLines(raw ?? "").trim();
  if (!text) {
    throw new Error(`Collector "${source}" produced no output`);
  }

  const normalised = parseNormalisedPayload(text, source, opts);
  if (normalised) return normalised;

  const parsed = parseCollectorMessages(text, source, opts.target, opts.timeZone);
  if (parsed.length === 0) {
    if (opts.truncated) {
      throw new Error(
        `Collector "${source}" printed more than the output limit allows, ` +
          `so it was cut off in the middle and could not be read. ` +
          `Collect a smaller range, or raise the limit. ` +
          `First 200 characters: ${text.slice(0, 200)}`,
      );
    }
    throw new Error(
      `Collector "${source}" output could not be parsed into messages. ` +
        `First 200 characters: ${text.slice(0, 200)}`,
    );
  }

  const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
  const truncated = limit !== undefined && parsed.length >= limit;
  const messages = limit !== undefined ? parsed.slice(0, limit) : parsed;

  return {
    messages,
    meta: { total: parsed.length, source, truncated },
  };
}
