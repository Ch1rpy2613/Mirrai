/**
 * The multi-source collection layer.
 *
 * The Python collectors in `skill-engine/tools/` were on disk but nothing
 * referenced them. This module drives them, normalises their output into one
 * contract, and runs them through a bounded-concurrency job runner.
 */
export {
  COLLECTOR_SOURCES,
  clearRestoredCredentials,
  setRestoredCredentials,
  type CollectedMessage,
  type CollectResult,
  type CollectorAuthState,
  type CollectorCredentials,
  type CollectorSourceId,
  type CollectInput,
  type SourceConnector,
} from "./types";

export {
  runCollector,
  normaliseCollectorOutput,
  parseNormalisedPayload,
  parseProgressLine,
  stripProgressLines,
  DEFAULT_COLLECTOR_TIMEOUT_MS,
  type RunCollectorOptions,
  type NormaliseCollectorOptions,
} from "./runner";

export {
  loadCollectionSource,
  saveCollectionSource,
  saveConnectorSource,
  type StoredCollectionSource,
} from "./db-store";

export {
  enqueueCollectorJob,
  getCollectorJob,
  listCollectorJobs,
  waitForCollectorJob,
  cancelCollectorJob,
  reconcileInterruptedJobs,
  configureCollectors,
  configureCollectorRunner,
  onJobUpdate,
  resetCollectors,
  getCollector,
  getCollectorConcurrency,
  createMemoryJobStore,
  setCollectorJobStore,
  type CollectorJob,
  type CollectorJobHandle,
  type CollectorJobSpec,
  type CollectorJobStatus,
} from "./jobs";
