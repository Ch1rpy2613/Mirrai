/**
 * In-process job runner for the chat-history collectors.
 *
 * Collecting from Feishu, DingTalk or Slack takes minutes and hits
 * rate-limited platform APIs, so the work is queued instead of run inside a
 * request. The queue is deliberately serial (one collector at a time) — a
 * second concurrent run would only earn rate-limit errors.
 *
 * The state lives in memory for now, but every access goes through the
 * `CollectorJobStore` seam so a DB-backed implementation can replace it
 * without touching the queue logic. `reconcileInterruptedJobs()` exists for
 * the same reason: a job that was running when the process died can never
 * report back, so it has to be marked as interrupted instead of staying
 * "running" forever.
 */
import { randomUUID } from "crypto";
import { COLLECTOR_SOURCES } from "./types";
import type { CollectInput, CollectResult, CollectorSourceId, SourceConnector } from "./types";

export type CollectorJobStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface CollectorJob {
  id: string;
  userId: string;
  personaId: string;
  source: CollectorSourceId;
  status: CollectorJobStatus;
  /** 0..100. */
  progress: number;
  messageCount: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: CollectResult;
}

export interface CollectorJobSpec {
  userId: string;
  personaId: string;
  source: CollectorSourceId;
  input: CollectInput;
}

export interface CollectorJobHandle {
  id: string;
  /** Snapshot of the job at enqueue time (status "queued"). */
  job: CollectorJob;
  /** Resolves with the final job state. */
  done: Promise<CollectorJob>;
}

/**
 * Storage seam for collector jobs.
 *
 * The default implementation keeps everything in memory, which is enough for
 * the single-process desktop deployment.
 */
export interface CollectorJobStore {
  get(id: string): CollectorJob | undefined;
  save(job: CollectorJob): void;
  list(userId?: string): CollectorJob[];
}

/** Creates the default in-memory job store. */
export function createMemoryJobStore(): CollectorJobStore {
  const jobs = new Map<string, CollectorJob>();
  return {
    get(id: string): CollectorJob | undefined {
      return jobs.get(id);
    },
    save(job: CollectorJob): void {
      jobs.set(job.id, job);
    },
    list(userId?: string): CollectorJob[] {
      const all = Array.from(jobs.values());
      const filtered = userId ? all.filter((job) => job.userId === userId) : all;
      return filtered.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    },
  };
}

let store: CollectorJobStore = createMemoryJobStore();

/** Swaps the job storage (e.g. for a DB-backed implementation). */
export function setCollectorJobStore(next: CollectorJobStore): void {
  store = next;
}

/**
 * Connectors used by the job runner.
 *
 * Defaults to the real registry; tests inject fakes through
 * `configureCollectors()` so the queue can be exercised without Python or
 * network access.
 */
let connectors: SourceConnector[] = COLLECTOR_SOURCES;

/** Replaces the connector list (the injection seam used by the tests). */
export function configureCollectors(list: SourceConnector[]): void {
  connectors = list;
}

/** Restores the real connector registry. */
export function resetCollectors(): void {
  connectors = COLLECTOR_SOURCES;
}

/** Looks up the connector for a source. */
export function getCollector(source: CollectorSourceId): SourceConnector | undefined {
  return connectors.find((connector) => connector.id === source);
}

type CollectorJobListener = (job: CollectorJob) => void;

const listeners = new Set<CollectorJobListener>();

/**
 * Registers a listener that receives every job state change.
 *
 * This is the hook a future DB writer would use to persist progress.
 * Returns an unsubscribe function.
 */
export function onJobUpdate(listener: CollectorJobListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notifies the listeners; a broken listener must not break the collector. */
function emit(job: CollectorJob): void {
  const snapshot: CollectorJob = { ...job };
  Array.from(listeners).forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("[Collectors] Job listener failed:", error);
    }
  });
}

/**
 * How many jobs may be waiting.
 *
 * The queue had no cap: an authenticated user could enqueue thousands of
 * collection runs, and each one spawns a Python process — the DingTalk
 * source drives a browser with it. The whole server runs out of memory
 * and CPU, not just the jobs.
 */
const MAX_QUEUE_LENGTH = 20;

const queue: string[] = [];
const inputs = new Map<string, CollectInput>();
const controllers = new Map<string, AbortController>();
const waiters = new Map<string, Array<(job: CollectorJob) => void>>();

let active = 0;
let concurrency = 1;

/**
 * Configures the runner. `concurrency` defaults to 1 — collectors hit
 * rate-limited platform APIs, so running several at once only produces
 * failures.
 */
export function configureCollectorRunner(options: { concurrency?: number }): void {
  if (options.concurrency !== undefined) {
    concurrency = Math.max(1, Math.floor(options.concurrency));
  }
}

/** Current concurrency limit (exposed for diagnostics and tests). */
export function getCollectorConcurrency(): number {
  return concurrency;
}

function isTerminalStatus(status: CollectorJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

/** Marks a job as finished and wakes everybody waiting for it. */
function settle(job: CollectorJob, status: CollectorJobStatus, error?: string): void {
  job.status = status;
  job.finishedAt = new Date().toISOString();
  if (error) job.error = error;
  store.save(job);
  emit(job);
  const resolvers = waiters.get(job.id) ?? [];
  waiters.delete(job.id);
  resolvers.forEach((resolve) => resolve({ ...job }));
}

/** Starts queued jobs while a slot is free. */
function pump(): void {
  while (active < concurrency && queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    const job = store.get(id);
    if (!job || job.status !== "queued") continue;
    active += 1;
    void runJob(job);
  }
}

/** True when the failure was caused by a cancellation rather than a bug. */
function isCancellation(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || /cancel|abort/i.test(error.message);
  }
  return false;
}

/** Runs one job to completion. */
async function runJob(job: CollectorJob): Promise<void> {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  store.save(job);
  emit(job);

  const connector = getCollector(job.source);
  if (!connector) {
    settle(job, "failed", `Unknown collector source "${job.source}"`);
    active -= 1;
    pump();
    return;
  }

  // Restore the credentials the user authorised earlier, so a collection can
  // run without the user re-entering them.
  const userId = Number(job.userId);
  if (Number.isFinite(userId) && connector.importCredentials) {
    try {
      const { loadCollectionSource } = await import("./db-store");
      const stored = await loadCollectionSource(userId, job.source);
      if (stored?.credentials) connector.importCredentials(stored.credentials, userId);
    } catch (e) {
      console.warn("[Collectors] Could not restore the stored credentials:", e);
    }
  }

  const controller = new AbortController();
  controllers.set(job.id, controller);

  try {
    const base = inputs.get(job.id) ?? {};
    const input: CollectInput = {
      ...base,
      // Whose collection this is. The credentials are the user's own
      // and they are held under the user's id: they used to be held
      // under the source alone, so one user's credentials were used for
      // another user's collection.
      userId: Number.isFinite(Number(job.userId)) ? Number(job.userId) : null,
      onProgress: (pct: number) => {
        const next = Math.max(0, Math.min(100, Math.round(pct)));
        if (next <= job.progress) return;
        job.progress = next;
        store.save(job);
        emit(job);
      },
      signal: controller.signal,
    };

    const result = await connector.collect(input);
    job.result = result;
    job.messageCount = result.messages.length;
    job.progress = 100;

    // The collected messages belong to the persona, not just to the job
    // report — they are what the distillation pipeline reads.
    const personaId = Number(job.personaId);
    const userId = Number(job.userId);
    if (Number.isFinite(personaId) && Number.isFinite(userId)) {
      const { importCollectedMessages } = await import("./db-store");
      const added = await importCollectedMessages({
        personaId,
        userId,
        source: job.source,
        messages: result.messages,
      }).catch((e) => {
        console.warn("[Collectors] Could not store the collected messages:", e);
        return 0;
      });
      if (added > 0) {
        console.log(`[Collectors] Imported ${added} message(s) into persona ${personaId}`);
      }
    }

    settle(job, "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    settle(job, isCancellation(error) ? "interrupted" : "failed", message);
  } finally {
    controllers.delete(job.id);
    inputs.delete(job.id);
    // The credentials are let go of when the job ends.
    //
    // They used to stay in the process for as long as it lived, in
    // plaintext, for every source anybody had ever collected from.
    if (connector.importCredentials && Number.isFinite(userId)) {
      const { clearRestoredCredentials } = await import("./types");
      clearRestoredCredentials(job.source, userId);
    }
    active -= 1;
    pump();
  }
}

/**
 * Queues a collection job.
 *
 * The returned handle carries the job id and a promise that settles with the
 * final job state; `waitForCollectorJob()` does the same for a job that was
 * queued earlier.
 */
export async function enqueueCollectorJob(
  spec: CollectorJobSpec,
): Promise<CollectorJobHandle> {
  /**
   * The queue is not allowed to grow without bound.
   *
   * Each job spawns a Python process — the DingTalk source drives a
   * browser with it — so an authenticated user could enqueue thousands
   * of them and take the whole server's memory and CPU with them.
   */
  if (queue.length >= MAX_QUEUE_LENGTH) {
    throw new Error(
      `Too many collection runs are already waiting (${MAX_QUEUE_LENGTH}). Try again when they have finished.`,
    );
  }

  const job: CollectorJob = {
    id: randomUUID(),
    userId: spec.userId,
    personaId: spec.personaId,
    source: spec.source,
    status: "queued",
    progress: 0,
    messageCount: 0,
  };

  store.save(job);
  inputs.set(job.id, spec.input ?? {});

  const queuedSnapshot: CollectorJob = { ...job };
  emit(job);

  const done = new Promise<CollectorJob>((resolve) => {
    const resolvers = waiters.get(job.id) ?? [];
    resolvers.push(resolve);
    waiters.set(job.id, resolvers);
  });

  queue.push(job.id);
  pump();

  return { id: job.id, job: queuedSnapshot, done };
}

/** Returns a snapshot of a job, if it exists. */
export function getCollectorJob(jobId: string): CollectorJob | undefined {
  const job = store.get(jobId);
  return job ? { ...job } : undefined;
}

/** Lists the jobs of one user (all jobs when no user is given). */
export function listCollectorJobs(userId?: string): CollectorJob[] {
  return store.list(userId).map((job) => ({ ...job }));
}

/**
 * Waits until a job settles.
 *
 * Rejects when `timeoutMs` elapses before the job finished.
 */
export function waitForCollectorJob(
  jobId: string,
  timeoutMs?: number,
): Promise<CollectorJob> {
  const existing = store.get(jobId);
  if (existing && isTerminalStatus(existing.status)) {
    return Promise.resolve({ ...existing });
  }

  return new Promise<CollectorJob>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const onSettled = (settled: CollectorJob): void => {
      if (timer) clearTimeout(timer);
      resolve({ ...settled });
    };

    const resolvers = waiters.get(jobId) ?? [];
    resolvers.push(onSettled);
    waiters.set(jobId, resolvers);

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const current = waiters.get(jobId) ?? [];
        const index = current.indexOf(onSettled);
        if (index >= 0) current.splice(index, 1);
        reject(new Error(`Timed out waiting for collector job ${jobId} after ${timeoutMs}ms`));
      }, timeoutMs);
    }
  });
}

/**
 * Cancels a job.
 *
 * A queued job is dropped, a running job gets its collector aborted.
 */
export function cancelCollectorJob(jobId: string): boolean {
  const job = store.get(jobId);
  if (!job) return false;
  if (job.status === "queued") {
    const index = queue.indexOf(jobId);
    if (index >= 0) queue.splice(index, 1);
    settle(job, "interrupted", "Collector job was cancelled before it started");
    return true;
  }
  if (job.status === "running") {
    controllers.get(jobId)?.abort();
    return true;
  }
  return false;
}

/**
 * Marks jobs that were running when the process went away as interrupted.
 *
 * With the in-memory store this is a no-op on a cold start (there is nothing
 * in memory yet), but the semantics are what a DB-backed implementation needs
 * and the tests rely on it: a job that is still "running" can never report
 * back, so it must not stay in that state.
 */
export function reconcileInterruptedJobs(): CollectorJob[] {
  const reconciled: CollectorJob[] = [];
  for (const job of store.list()) {
    if (job.status !== "running") continue;
    settle(job, "interrupted", "Collector job was interrupted by a server restart");
    reconciled.push({ ...job });
  }
  return reconciled;
}
