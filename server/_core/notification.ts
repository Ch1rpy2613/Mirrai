/**
 * Delivering a message to the person who owns the instance.
 *
 * This used to be a stub that logged the payload and reported success, so
 * the admin endpoint `system.notifyOwner` claimed to have notified somebody
 * when it had not notified anyone at all.
 *
 * There is no push service and no third-party endpoint — the product's
 * promise is that the user's data never leaves their machine. What there
 * *is* is the channel layer: a message can go out over the conversations the
 * user has already connected (WeChat, Feishu), and if no channel is
 * connected it is recorded so the web client can show it in the lobby.
 */
import * as db from "../db";
import { getChannelAdapter, type ChannelId } from "../channels";

export type NotificationPayload = {
  title: string;
  content: string;
};

export type NotificationResult = {
  /** True when the notification reached the user somehow. */
  delivered: boolean;
  /** The channel it went out on, or "web" when it was recorded instead. */
  channel: string | null;
  /** Why it was not delivered, when it was not. */
  reason?: string;
};

/**
 * Sends a notification to the owner.
 *
 * Bound conversations are preferred — a message the user can actually see
 * without opening the app. Otherwise the notification is recorded and the
 * web client picks it up.
 */
export async function notifyOwner(
  payload: NotificationPayload,
  userId: number,
): Promise<NotificationResult> {
  const text = `${payload.title}\n${payload.content}`.trim();

  const bindings = await db.getChannelBindingsByUserId(userId).catch(() => []);

  for (const binding of bindings) {
    if (!binding.isActive) continue;
    const adapter = getChannelAdapter(binding.channel as ChannelId);
    if (!adapter) continue;

    try {
      await adapter.send(userId, binding.targetId, text);
      return { delivered: true, channel: binding.channel };
    } catch (e) {
      console.warn(
        `[Notification] Could not deliver on ${binding.channel}:`,
        (e as Error).message,
      );
    }
  }

  // No channel took it. Record it so it is not lost.
  const recorded = await db
    .recordReminder({
      userId,
      // A notification is not tied to a persona, but the column is not
      // nullable. The first persona of the user is the closest thing to an
      // owner in this schema.
      personaId: await resolveOwnerPersonaId(userId),
      channel: "web",
      kind: "notification",
      text,
      dedupeKey: `notification:${userId}:${Date.now()}`,
      scheduledFor: new Date(),
    })
    .catch(() => false);

  return {
    delivered: recorded,
    channel: recorded ? "web" : null,
    reason: recorded ? undefined : "No channel was available and the notification could not be recorded.",
  };
}

/** The persona used to attach an owner-level notification to. */
async function resolveOwnerPersonaId(userId: number): Promise<number> {
  const personas = await db.getPersonasByUserId(userId).catch(() => []);
  return personas[0]?.id ?? 0;
}
