/**
 * First-run setup status.
 *
 * The client uses this to decide whether to show the onboarding wizard:
 * whether the instance has any users, and whether an LLM provider has been
 * configured.
 */
import * as db from "../db";
import { registry } from "../llm";

export interface SetupStatus {
  /** True when the database has no users at all. */
  needsBootstrap: boolean;
  /** True when at least one LLM provider is usable. */
  hasLlmProvider: boolean;
  /** True when the database could not be reached. */
  databaseUnavailable: boolean;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  let hasUsers = false;
  let databaseUnavailable = false;

  try {
    const userIds = await db.getAllUserIds();
    hasUsers = userIds.length > 0;
  } catch (e) {
    databaseUnavailable = true;
    console.warn("[Bootstrap] Could not read user list:", e);
  }

  const hasLlmProvider = registry.list().some((p) => p.configured);

  return {
    needsBootstrap: !hasUsers && !databaseUnavailable,
    hasLlmProvider,
    databaseUnavailable,
  };
}
