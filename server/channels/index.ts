/**
 * The channel registry.
 *
 * Adding a channel means adding an adapter here; everything else — the
 * conversation pipeline, the commands, the safety layer — is shared.
 */
import { feishuAdapter } from "./feishu";
import { wechatAdapter } from "./wechat";
import { channelLabel } from "./types";
import type { ChannelAdapter, ChannelId, ChannelStatus } from "./types";

export type { ChannelAdapter, ChannelId, ChannelStatus };
export { channelLabel };

const adapters = new Map<ChannelId, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  adapters.set(adapter.id, adapter);
}

registerChannel(wechatAdapter);
registerChannel(feishuAdapter);

export function getChannelAdapter(id: ChannelId): ChannelAdapter | undefined {
  return adapters.get(id);
}

export function listChannels(): ChannelAdapter[] {
  return Array.from(adapters.values());
}

/**
 * Restores the channels that were connected before the last restart.
 *
 * A channel that cannot be restored (expired credentials, a channel that was
 * never configured) is skipped rather than failing the boot.
 */
/**
 * Stops every channel that is running.
 *
 * The WeChat poll loop and the Feishu long connection keep running
 * until they are told to stop — so without this the process was left
 * with them open when it was asked to shut down.
 */
export async function stopAllChannels(): Promise<void> {
  for (const adapter of listChannels()) {
    if (typeof adapter.stopAll !== "function") continue;
    try {
      await adapter.stopAll();
    } catch {
      // A channel that will not stop must not hold the shutdown up.
    }
  }
}

export async function restoreChannels(userIds: number[]): Promise<void> {
  for (const userId of userIds) {
    for (const adapter of listChannels()) {
      if (typeof adapter.restore !== "function") continue;
      try {
        const restored = await adapter.restore(userId);
        if (restored) {
          console.log(`[Channels] Restored the ${adapter.id} channel for user ${userId}`);
        }
      } catch (e) {
        console.warn(`[Channels] Could not restore the ${adapter.id} channel for user ${userId}:`, e);
      }
    }
  }
}
