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
  /**
   * True when *this* user has a provider of their own.
   *
   * The environment can have no provider at all while the user has
   * configured one through the interface — and that user can chat. The
   * interface asks about "is there a provider" to decide whether to
   * send somebody to the first-run wizard, and answering "no" for a user
   * who has one sent them there forever: the wizard has no exit, so
   * every visit to the front page bounced them back into it.
   */
  hasUserProvider: boolean;
  /** True when the database could not be reached. */
  databaseUnavailable: boolean;
}

export async function getSetupStatus(userId?: number | null): Promise<SetupStatus> {
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

  // The user's own key, if they have one.
  let hasUserProvider = false;
  if (userId != null) {
    try {
      const configs = await db.getLlmConfigsByUserId(userId);
      hasUserProvider = configs.some((config) => Boolean(config.apiKey));
    } catch (e) {
      console.warn("[Bootstrap] Could not read the user's providers:", e);
    }
  }

  return {
    needsBootstrap: !hasUsers && !databaseUnavailable,
    hasLlmProvider,
    hasUserProvider,
    databaseUnavailable,
  };
}
