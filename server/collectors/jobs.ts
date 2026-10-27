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
import * as db from "../db";
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
  /**
   * How many messages the collector found, before the limit.
   *
   * The count that was kept was the same as the count that was found
   * — so a collection that was cut short said it had found exactly as
   * many as it kept, and nothing said the rest were left behind.
   */
  foundCount?: number;
  /**
   * How many messages were kept out of the ones that were found.
   *
   * It is not the same as `messageCount`, which is how many rows were
   * *newly written*: re-collecting a history the user already imported
   * writes nothing, and the message count says zero — while the
   * number kept is the number of messages the collection held.
   */
  keptCount?: number;
  /** Whether the collection was cut short. */
  truncated?: boolean;
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
 * How many finished jobs the store keeps.
 *
 * The store never let anything go: every collection run anybody had
 * ever started stayed in the process for as long as it lived. On a
 * long-running server that is a slow leak, and the list the interface
 * asks for grew for ever.
 */
const MAX_KEPT_JOBS = 200;

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

  /**
   * Lets the oldest finished job go when there are too many.
   *
   * A job that is still queued or running is never let go of.
   */
  const evict = (): void => {
    if (jobs.size <= MAX_KEPT_JOBS) return;
    const finished = Array.from(jobs.values())
      .filter((job) => job.status === "completed" || job.status === "failed" || job.status === "interrupted")
      .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
    // The map is keyed in insertion order, so the first finished job in
    // the list is the oldest one.
    for (const job of finished) {
      if (jobs.size <= MAX_KEPT_JOBS) break;
      jobs.delete(job.id);
    }
  };

  return {
    get(id: string): CollectorJob | undefined {
      return jobs.get(id);
    },
    save(job: CollectorJob): void {
      jobs.set(job.id, job);
      evict();
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

/**
 * How many jobs one user may have waiting.
 *
 * The queue is shared by everybody, and it is strictly serial — so one
 * user who queued twenty runs made every other user's collection wait
 * behind them for tens of minutes. The rate limit (five a minute) does
 * not help: twenty runs is four minutes of pressing the button.
 */
const MAX_QUEUE_LENGTH_PER_USER = 3;

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
    /**
     * The failure is caught here.
     *
     * The job was run with `void` — so a rejection was an unhandled
     * one, and the queue's bookkeeping was skipped with it: the slot
     * was never given back and the next job was never started. One
     * failure and the collectors stopped for the life of the process.
     */
    /**
     * The slot is given back once.
     *
     * It used to be given back here *and* in the runner's `finally` —
     * so a runner that rejected after its `finally` had already run
     * took the slot twice, and the count went negative. A negative
     * count means the queue starts more collectors than the limit
     * allows: an unbounded number of Playwright browsers.
     */
    void runJob(job).catch((error) => {
      console.error("[Collectors] The job runner failed:", error);
      pump();
    });
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
  /**
   * The controller is registered *first*.
   *
   * It used to be registered after the job was marked running and
   * after two awaits — a dynamic import and a database round trip. So
   * a cancellation that arrived in that window found no controller,
   * was silently ignored, and the collector went on for up to thirty
   * minutes and imported its messages anyway. The caller was told the
   * cancellation had worked.
   */
  const controller = new AbortController();
  controllers.set(job.id, controller);

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

  try {
    const base = inputs.get(job.id) ?? {};
    const input: CollectInput = {
      ...base,
      // Whose collection this is. The credentials are the user's own
      // and they are held under the user's id: they used to be held
      // under the source alone, so one user's credentials were used for
      // another user's collection.
      userId: Number.isFinite(Number(job.userId)) ? Number(job.userId) : null,
      /**
       * The reader's own time zone.
       *
       * A timestamp that names a wall clock but no zone is the
       * reader's clock — it is their chat history. It used to be read
       * in the *server's* zone, so on a server in another country
       * every message landed at the wrong hour, and often on the wrong
       * day.
       */
      timezone:
        Number.isFinite(Number(job.userId))
          ? (await db.getUserTimezone(Number(job.userId))) ?? undefined
          : undefined,
      /**
       * The language the reader reads.
       *
       * The collectors report what went wrong in words, and those words
       * are read by a person.
       */
      locale:
        Number.isFinite(Number(job.userId))
          ? ((await db.getUserLocale(Number(job.userId)).catch(() => "zh" as const)) ?? "zh")
          : "zh",
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
    // How many there were, and whether the collection was cut short.
    job.foundCount = result.meta?.total ?? result.messages.length;
    // How many the collection held — which is not how many were *new*.
    job.keptCount = result.messages.length;
    job.truncated = result.meta?.truncated === true;
    job.progress = 100;

    // The collected messages belong to the persona, not just to the job
    // report — they are what the distillation pipeline reads.
    const personaId = Number(job.personaId);
    const userId = Number(job.userId);
    if (Number.isFinite(personaId) && Number.isFinite(userId)) {
      const { importCollectedMessages } = await import("./db-store");
      /**
       * The import is not allowed to fail quietly.
       *
       * The failure was caught here and the job settled as
       * "completed" — with a message count that did not match what was
       * stored. So the user was told the collection worked, and the
       * persona had none of it.
       */
      const added = await importCollectedMessages({
        personaId,
        userId,
        source: job.source,
        messages: result.messages,
      });
      if (added > 0) {
        console.log(`[Collectors] Imported ${added} message(s) into persona ${personaId}`);
      }
      /**
       * The count is what was *written*.
       *
       * It was the count the collector returned — which is not the same
       * thing. The import is idempotent, so collecting the same
       * history twice writes nothing the second time — and the job
       * still said "500 messages". So the user was told 500 messages
       * had been collected into their persona, and their persona had
       * gained nothing.
       */
      job.messageCount = added;
    } else {
      job.messageCount = result.messages.length;
    }

    /**
     * Nothing was collected, and the collector said why.
     *
     * The run is reported as a success with zero messages — and the
     * persona is then distilled from nothing. The reason the collector
     * had written down ("the bot is not in the chat", "Playwright is
     * not installed") was in the transcript, which the server never
     * opened.
     *
     * So the run is reported as what it was: a failure, with the
     * collector's own words.
     */
    const note = result.meta?.note;
    if (result.messages.length === 0 && note) {
      settle(job, "failed", note);
      return;
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
      /**
       * The import cannot reject.
       *
       * It is a dynamic import inside a `finally`, so a failure there
       * rejected the whole job — and the bookkeeping below it, the
       * slot being given back and the next job being started, was
       * skipped with it.
       */
      try {
        const { clearRestoredCredentials } = await import("./types");
        clearRestoredCredentials(job.source, userId);
      } catch (error) {
        console.warn("[Collectors] Could not clear the credentials:", error);
      }
    }
    active = Math.max(0, active - 1);
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
/**
 * The queue could not take the job.
 *
 * A typed error, so the procedure can say what happened instead of the
 * generic "something went wrong on the server".
 */
export class CollectorQueueFullError extends Error {
  constructor(
    message: string,
    /** How many are waiting, for the message. */
    readonly waiting: number,
    /** How many may wait. */
    readonly limit: number,
    /** Whether it is the whole queue or this user's share of it. */
    readonly perUser: boolean,
  ) {
    super(message);
    this.name = "CollectorQueueFullError";
  }
}

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
    throw new CollectorQueueFullError(
      `Too many collection runs are already waiting (${MAX_QUEUE_LENGTH}). Try again when they have finished.`,
      MAX_QUEUE_LENGTH,
      MAX_QUEUE_LENGTH,
      false,
    );
  }
  /**
   * The user's own share of the queue.
   *
   * The queue is shared and it is serial, so one user could fill it
   * and everybody else waited behind them.
   */
  const userId = String(spec.userId);
  const waitingForThisUser = queue.filter((id) => {
    const waiting = store.get(id);
    return waiting ? String(waiting.userId) === userId : false;
  }).length;
  if (waitingForThisUser >= MAX_QUEUE_LENGTH_PER_USER) {
    throw new CollectorQueueFullError(
      `You already have ${MAX_QUEUE_LENGTH_PER_USER} collection runs waiting. Try again when one of them has finished.`,
      waitingForThisUser,
      MAX_QUEUE_LENGTH_PER_USER,
      true,
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
    foundCount: 0,
    keptCount: 0,
    truncated: false,
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
        // The empty list goes too — it used to be left behind for
        // every job that timed out.
        if (current.length === 0) waiters.delete(jobId);
        else waiters.set(jobId, current);
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
    /**
     * The input goes with it.
     *
     * It used to be cleared only in the job's own `finally` — and a
     * job cancelled before it started never runs one. So every
     * cancelled job kept its input — the target, the options, the
     * credentials — for the life of the process.
     */
    inputs.delete(jobId);
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
 * Cancels every job that is running or queued.
 *
 * It is what the process calls when it is asked to shut down: a
 * collector that is still running survives the server — the DingTalk
 * one drives a Chromium — and goes on to its own timeout.
 */
export function cancelAllCollectorJobs(): void {
  for (const job of store.list()) {
    if (job.status === "queued" || job.status === "running") {
      cancelCollectorJob(job.id);
    }
  }
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
