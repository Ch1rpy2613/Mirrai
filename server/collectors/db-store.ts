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

  const seen = new Set(
    existing.map((m) =>
      idempotencyKey(m.source ?? params.source, m.timestamp ?? null, m.content),
    ),
  );

  let added = 0;
  for (const message of params.messages) {
    const timestamp = message.timestamp ? new Date(message.timestamp) : null;
    const key = idempotencyKey(params.source, timestamp, message.content);
    if (seen.has(key)) continue;
    seen.add(key);

    await db.createCollectedMessage({
      userId: params.userId,
      personaId: params.personaId,
      source: params.source,
      role: message.role,
      content: message.content,
      timestamp,
    });
    added++;
  }
  return added;
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
        authState,
        config,
        status: params.status ?? existing[0].status,
        lastSyncedAt: new Date(),
      })
      .where(eq(collectionSources.id, existing[0].id));
    return;
  }

  await client.insert(collectionSources).values({
    userId: params.userId,
    source: params.source,
    label: params.label ?? null,
    authState,
    config,
    status: params.status ?? "stopped",
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
