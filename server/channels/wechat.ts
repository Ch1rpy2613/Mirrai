/**
 * The WeChat ClawBot channel, wrapped as a channel adapter.
 *
 * The protocol implementation in `server/wechat/` is unchanged — this module
 * only adapts it to the shared channel interface so that the WeChat and
 * Feishu channels can be driven by the same code.
 */
import {
  getBotStatus,
  startWeChatBot,
  stopWeChatBot,
  restoreWeChatBot,
  sendWeixinText,
} from "../wechat/bot";
import { setWechatBindingPersona, getWechatBindingsByUserId } from "../db";
import { clearAllActivePersonas } from "../wechat/commands";
import type { ChannelAdapter, ChannelId, ChannelStatus } from "./types";
import { copy, type Locale } from "@shared/copy";

const CHANNEL_ID = "wechat" as const;

export class WechatAdapter implements ChannelAdapter {
  id: ChannelId = CHANNEL_ID;
  label = copy("zh", "channels.channelLabelWechat");
  labelForLocale = (locale: Locale) => copy(locale, "channels.channelLabelWechat");
  requiresCredentials = false;

  async start(userId: number): Promise<void> {
    startWeChatBot(userId);
  }

  async stop(userId: number): Promise<void> {
    await stopWeChatBot(userId);
    /**
     * Only this user's overrides.
     *
     * The whole map was cleared — so one user stopping their WeChat
     * channel reset the persona that every other user had chosen in
     * their own conversation.
     */
    clearAllActivePersonas(userId);
  }

  async stopAll(): Promise<void> {
    const { stopAllWeChatBots } = await import("../wechat/bot");
    await stopAllWeChatBots();
  }

  async status(userId: number): Promise<ChannelStatus> {
    const snapshot = getBotStatus(userId);
    return {
      channel: CHANNEL_ID,
      connected: snapshot.status === "logged_in",
      status: snapshot.status,
      detail: {
        qrCodeUrl: snapshot.qrCodeUrl,
        loggedInUser: snapshot.loggedInUser,
        lastError: snapshot.lastError,
      },
    };
  }

  async send(
    userId: number,
    targetId: string,
    text: string,
    locale: Locale = "zh",
  ): Promise<void> {
    // `sendWeixinText` reports a missing or expired bot session by
    // returning false rather than throwing. Swallowing that would let the
    // caller record the message as delivered when nothing was sent, so the
    // failure has to surface.
    const sent = await sendWeixinText(userId, targetId, text);
    if (!sent) {
      throw new Error(copy(locale, "errors.wechatSendFailed"));
    }
  }

  async setDefaultPersona(
    userId: number,
    personaId: number,
    locale: Locale = "zh",
  ): Promise<void> {
    const bindings = await getWechatBindingsByUserId(userId);
    const targetId = bindings[0]?.wechatUserId;
    if (!targetId) {
      throw new Error(copy(locale, "errors.wechatNoBinding"));
    }
    await setWechatBindingPersona({
      userId,
      wechatUserId: targetId,
      personaId,
    });
  }

  async restore(userId: number): Promise<boolean> {
    return restoreWeChatBot(userId);
  }
}

export const wechatAdapter = new WechatAdapter();
