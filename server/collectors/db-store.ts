/**
 * Durable storage for collector jobs.
 *
 * The job runner keeps its live state in memory — that is what makes it
 * simple — but a collection can run for minutes, and the user should be able
 * to close the tab and come back to it. So every state change is mirrored
 * into `collection_jobs`, and a job that was still running when the process
 * died is marked interrupted at the next boot.
 *
 * The same file also stores the collection sources themselves: the platform
 * a user collects from, its auth state and its credentials — the credentials
 * encrypted, never in plaintext.
 */
import { and, eq } from "drizzle-orm";
import { collectionSources } from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../_core/crypto";
import * as db from "../db";
import type { CollectedMessage } from "./types";
import type { CollectorAuthState, CollectorCredentials, CollectInput, SourceConnector } from "./types";
import type { CollectorJob, CollectorJobStatus } from "./jobs";
import { copy } from "@shared/copy";

/**
 * Mirrors a job into the database.
 *
 * The write is fire-and-forget: a collector must not fail because the
 * database was briefly unavailable.
 */
export async function persistCollectorJob(job: CollectorJob): Promise<void> {
  try {
    const existing = await db.getCollectionJobByKey(job.id, Number(job.userId));
    const data = {
      userId: Number(job.userId),
      personaId: job.personaId ? Number(job.personaId) : null,
      source: job.source,
      status: job.status,
      progress: job.progress,
      messageCount: job.messageCount,
      error: job.error ?? null,
      startedAt: job.startedAt ? new Date(job.startedAt) : null,
      finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    };

    if (existing !== undefined) {
      await db.updateCollectionJob(existing.id, Number(job.userId), data);
      return;
    }
    await db.createCollectionJob({ jobKey: job.id, ...data });
  } catch (e) {
    console.warn("[Collectors] Could not persist the job:", e);
  }
}

/**
 * Marks every job that was still running as interrupted.
 *
 * A job that was "running" when the process stopped can never report back,
 * so leaving it in that state would show a spinner forever.
 */
export async function markInterruptedCollectorJobs(): Promise<number> {
  try {
    // The jobs that are still running, and only those.
    //
    // The twenty newest jobs of everybody used to be looked at, so a
    // job that had been running when the process died stayed "running"
    // for ever — and the interface showed a spinner that never ended.
    const jobs = await db.getRunningCollectionJobs();
    let marked = 0;
    for (const job of jobs) {
      await db.updateCollectionJob(job.id, job.userId, {
        status: "interrupted",
        error: "The server restarted while this collection was running.",
        finishedAt: new Date(),
      });
      marked++;
    }
    return marked;
  } catch (e) {
    console.warn("[Collectors] Could not reconcile interrupted jobs:", e);
    return 0;
  }
}

/**
 * The jobs of a user, newest first, read back from the database.
 */
export async function listPersistedCollectorJobs(userId: number) {
  const jobs = await db.getCollectionJobs(userId);
  return jobs.map((job) => ({
    id: job.jobKey,
    source: job.source as CollectorJob["source"],
    status: job.status as CollectorJobStatus,
    progress: job.progress,
    messageCount: job.messageCount,
    error: job.error ?? undefined,
    startedAt: job.startedAt ?? undefined,
    finishedAt: job.finishedAt ?? undefined,
  }));
}

/**
 * One persisted collection job, for the owner.
 *
 * The job list is read from the database, so a job that survived a
 * restart is in the list — and clicking it returned "not found",
 * because the detail was read from the process's memory.
 */
export async function getPersistedCollectorJob(jobKey: string, userId: number) {
  const job = await db.getCollectionJob(jobKey, userId);
  if (!job) return undefined;
  return {
    id: job.jobKey,
    source: job.source as CollectorJob["source"],
    status: job.status as CollectorJobStatus,
    progress: job.progress,
    messageCount: job.messageCount,
    error: job.error ?? undefined,
    startedAt: job.startedAt ?? undefined,
    finishedAt: job.finishedAt ?? undefined,
  };
}

/**
 * The idempotency key of a collected message.
 *
 * The plan requires the import to be idempotent per source and timestamp:
 * collecting the same history twice must not store it twice. The source is
 * part of the key, so the same sentence of the same person on two different
 * platforms stays two messages; the content keeps two different messages of
 * the same minute apart.
 */
function idempotencyKey(source: string, timestamp: Date | null, content: string): string {
  return `${source}|${timestamp?.toISOString() ?? ""}|${content}`;
}

/**
 * The idempotency key of a message that has no timestamp.
 *
 * The timestamp is what keeps two messages of the same minute apart —
 * but a message without one contributed nothing to the key, so every
 * message of the same text collapsed into one. Three "嗯" in a row —
 * which is what a chat log is full of — were stored once.
 *
 * So the occurrence is part of the key: the first "嗯" is one message,
 * the second is another, and the third is a third. It is stable: the
 * same history collected twice produces the same keys, and the import
 * stays idempotent.
 */
function untimedKey(source: string, content: string, occurrence: number): string {
  return `${source}||${content}#${occurrence}`;
}

/**
 * Imports collected messages into the persona.
 *
 * The import is idempotent: a message that is already there — same source,
 * same timestamp and same content — is not added twice, so re-running a
 * collection does not duplicate the history.
 *
 * Returns how many rows were actually inserted.
 */
export async function importCollectedMessages(params: {
  personaId: number;
  userId: number;
  source: string;
  messages: CollectedMessage[];
}): Promise<number> {
  // Only the keys of the messages that are already there.
  //
  // The whole row of every message ever collected was loaded — fifty
  // thousand rows of a full chat log — of which three fields were used.
  const existing = await db.getCollectedMessageKeys(
    params.personaId,
    params.userId,
    params.source,
  );

  const seen = new Set<string>();
  /**
   * How many of each untimed message are already there.
   *
   * The count is what tells the first "嗯" from the second.
   */
  const untimedCounts = new Map<string, number>();
  for (const m of existing) {
    if (m.timestamp) {
      seen.add(idempotencyKey(m.source ?? params.source, m.timestamp, m.content));
      continue;
    }
    const source = m.source ?? params.source;
    const occurrence = untimedCounts.get(m.content) ?? 0;
    untimedCounts.set(m.content, occurrence + 1);
    seen.add(untimedKey(source, m.content, occurrence));
  }

  /**
   * The rows that are actually new, gathered first.
   *
   * They used to be inserted one at a time, so a chat log of fifty
   * thousand lines was fifty thousand round trips to the database, and
   * the collection sat there for an hour.
   */
  const rows = [];
  /**
   * How many of each untimed message this batch holds.
   *
   * It starts at zero: the first "嗯" of the batch is the first "嗯"
   * that was stored, so a re-collected history matches itself.
   */
  const batchCounts = new Map<string, number>();
  for (const message of params.messages) {
    const timestamp = message.timestamp ? new Date(message.timestamp) : null;
    let key: string;
    if (timestamp) {
      key = idempotencyKey(params.source, timestamp, message.content);
    } else {
      const occurrence = batchCounts.get(message.content) ?? 0;
      batchCounts.set(message.content, occurrence + 1);
      key = untimedKey(params.source, message.content, occurrence);
    }
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      userId: params.userId,
      personaId: params.personaId,
      source: params.source,
      role: message.role,
      content: message.content,
      timestamp,
    });
  }
  if (rows.length === 0) return 0;
  await db.createCollectedMessages(rows);
  return rows.length;
}

/**
 * The name a collected transcript gives each side.
 *
 * "我" is Chinese, so it lives in the copy table. "TA" cannot go there
 * either: the copy table's Chinese half has to carry Chinese characters,
 * and "TA" — the letter pair the app has always written for the other
 * person — has none of them. So it is spelled out here, with its English
 * counterpart beside it.
 */
export function collectedSpeaker(role: string, locale: "zh" | "en" = "zh"): string {
  if (role === "user") return copy(locale, "prompt.speakerSelf");
  return locale === "en" ? "Them: " : "TA：";
}

/**
 * Renders collected messages as the transcript the distillation pipeline
 * expects.
 */
export function toTranscript(
  messages: Array<{ role: string; content: string }>,
  locale: "zh" | "en" = "zh",
): string {
  return messages
    .map((m) => `${collectedSpeaker(m.role, locale)}${m.content}`)
    .join("\n");
}

// ─── Collection sources ──────────────────────────────────────────────────────

/** The shape of `collection_sources.config`. */
interface StoredCollectionConfig {
  /** AES-256-GCM blob produced by `encryptSecret`. */
  encrypted?: string;
}

/** A stored collection source, with its credentials decrypted. */
export interface StoredCollectionSource {
  source: string;
  label?: string;
  /** The result of the last authorisation check. */
  authState?: CollectorAuthState;
  status?: string;
  lastSyncedAt?: Date;
  /** The credentials, decrypted. */
  credentials?: CollectorCredentials;
}

/**
 * Stores a collection source.
 *
 * The credentials are encrypted with `encryptSecret` (AES-256-GCM, key
 * derived from `JWT_SECRET`) before they are written, so the database never
 * holds a plaintext API token. `encryptedCredentials` accepts a blob that
 * was already encrypted — that is what `connector.exportCredentials()`
 * returns — and `credentials` accepts plaintext that is encrypted here.
 */
export async function saveCollectionSource(params: {
  userId: number;
  source: string;
  label?: string;
  /** The result of the last authorisation check. */
  authState?: CollectorAuthState;
  /** Plaintext credentials — encrypted before they are written. */
  credentials?: CollectorCredentials;
  /** An already encrypted credential blob. */
  encryptedCredentials?: string;
  status?: string;
}): Promise<void> {
  const client = await db.getDb();
  if (!client) return;

  let encrypted = params.encryptedCredentials;
  if (!encrypted && params.credentials && Object.keys(params.credentials).length > 0) {
    encrypted = await encryptSecret(JSON.stringify(params.credentials));
  }

  const config: StoredCollectionConfig | null = encrypted ? { encrypted } : null;
  const authState = params.authState ?? null;

  const existing = await client
    .select()
    .from(collectionSources)
    .where(
      and(
        eq(collectionSources.userId, params.userId),
        eq(collectionSources.source, params.source),
      ),
    );

  if (existing.length > 0) {
    await client
      .update(collectionSources)
      .set({
        label: params.label ?? null,
        /**
         * The authorisation result that is already stored is kept.
         *
         * It was written unconditionally — so a call without one wiped
         * it, and the source looked unauthorised again with no
         * explanation.
         */
        authState: params.authState ?? existing[0].authState,
        /**
         * The credentials that are already stored are kept.
         *
         * The config was written unconditionally, so a call without
         * credentials — which happens whenever the credential set
         * resolves to empty — silently deleted them and the user had to
         * authorise the source again with no explanation.
         */
        config: config ?? existing[0].config,
        status: params.status ?? existing[0].status,
        lastSyncedAt: new Date(),
      })
      .where(eq(collectionSources.id, existing[0].id));
    return;
  }

  /**
   * The insert is an upsert.
   *
   * Two presses of the button both found nothing and both inserted —
   * and the reader took the first of an unordered select, so it could
   * be the row with the older credentials. There is a unique index on
   * `(userId, source)` now, so the second insert would be refused
   * outright; the upsert is what makes it an update instead.
   */
  await client
    .insert(collectionSources)
    .values({
      userId: params.userId,
      source: params.source,
      label: params.label ?? null,
      authState,
      config,
      status: params.status ?? "stopped",
    })
    .onConflictDoUpdate({
      target: [collectionSources.userId, collectionSources.source],
      set: {
        label: params.label ?? null,
        authState: params.authState ?? null,
        config,
        status: params.status ?? "stopped",
        lastSyncedAt: new Date(),
      },
    });
}

/**
 * Reads a stored collection source back, with its credentials decrypted.
 *
 * A blob that cannot be decrypted (rotated key, corrupted row) yields no
 * credentials instead of an error — the caller then treats the source as
 * "needs to be authorised again".
 */
export async function loadCollectionSource(
  userId: number,
  source: string,
): Promise<StoredCollectionSource | undefined> {
  const client = await db.getDb();
  if (!client) return undefined;

  const rows = await client
    .select()
    .from(collectionSources)
    .where(
      and(
        eq(collectionSources.userId, userId),
        eq(collectionSources.source, source),
      ),
    );
  const row = rows[0];
  if (!row) return undefined;

  const config = (row.config ?? null) as StoredCollectionConfig | null;
  let credentials: CollectorCredentials | undefined;
  if (config?.encrypted) {
    const plaintext = await decryptSecret(config.encrypted);
    if (plaintext) {
      try {
        const parsed: unknown = JSON.parse(plaintext);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          credentials = parsed as CollectorCredentials;
        }
      } catch {
        credentials = undefined;
      }
    }
  }

  // The Feishu channel and the Feishu collector use the same app
  // credentials. When the user configured the channel but never the
  // collector, the channel's copy is used — so they only enter the secret
  // once.
  if (!credentials && source === "feishu") {
    const state = await db.getChannelState(userId, "feishu");
    if (state?.credentialsEnc) {
      const plaintext = await decryptSecret(state.credentialsEnc);
      if (plaintext) {
        try {
          const parsed: unknown = JSON.parse(plaintext);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            credentials = parsed as CollectorCredentials;
          }
        } catch {
          credentials = undefined;
        }
      }
    }
  }

  return {
    source: row.source,
    label: row.label ?? undefined,
    authState: (row.authState ?? undefined) as CollectorAuthState | undefined,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ?? undefined,
    credentials,
  };
}

/**
 * Persists a connector: its auth state and its encrypted credentials.
 *
 * The auth state is taken from `checkAuth()` when the caller does not pass
 * one, so the stored row always says whether the source is usable.
 */
export async function saveConnectorSource(params: {
  userId: number;
  connector: SourceConnector;
  input?: CollectInput;
  authState?: CollectorAuthState;
  label?: string;
}): Promise<void> {
  const input = params.input ?? {};
  const authState = params.authState ?? (await params.connector.checkAuth(input));
  const encrypted = await params.connector.exportCredentials?.(input);
  await saveCollectionSource({
    userId: params.userId,
    source: params.connector.id,
    label: params.label ?? params.connector.label,
    authState,
    encryptedCredentials: encrypted ?? undefined,
  });
}

/**
 * The collection sources a user has authorised.
 *
 * The credential blob is never returned — the caller only learns whether a
 * source has one.
 */
export async function listCollectionSources(userId: number) {
  const client = await db.getDb();
  if (!client) return [];
  return client.select().from(collectionSources)
    .where(eq(collectionSources.userId, userId))
    .orderBy(collectionSources.createdAt);
}
