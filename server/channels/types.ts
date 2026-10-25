/**
 * The channel adapter interface.
 *
 * A channel is anywhere a user can talk to a persona: the official WeChat
 * ClawBot channel, Feishu, and anything added later. Each channel delivers
 * inbound messages and sends replies; everything else — memory recall, the
 * emotional state, the safety layer, the graduation check — is shared.
 */
import type { ChannelId } from "./bridge";

export type { ChannelId };

export interface ChannelStatus {
  /** The channel this status describes. */
  channel: ChannelId;
  /** True when the channel is connected and able to deliver messages. */
  connected: boolean;
  /** Channel-specific status word, e.g. "stopped" or "logged_in". */
  status: string;
  /** Channel-specific detail — a QR code url, an error message, and so on. */
  detail?: Record<string, unknown> | null;
}

export interface ChannelAdapter {
  id: ChannelId;
  /** Display name shown in the settings UI. */
  label: string;
  /**
   * The display name in the language asked for.
   *
   * A channel is a place a person talks to their persona; the name is
   * how they recognise it.
   */
  labelForLocale?(locale: "zh" | "en"): string;
  /** True when the channel needs credentials before it can be started. */
  requiresCredentials: boolean;
  /**
   * Starts the channel for one user.
   *
   * The locale is the language of the person starting it, and it decides
   * the language of the errors a failure reports.
   */
  start(userId: number, locale?: "zh" | "en"): Promise<void>;
  /** Stops the channel for one user. */
  stop(userId: number): Promise<void>;
  /** Reports the current state of the channel for one user. */
  status(userId: number): Promise<ChannelStatus>;
  /**
   * Sends a text message to a conversation.
   *
   * The locale is the language of the person the message goes to, and it
   * decides the language of the error a failed send reports.
   */
  send(userId: number, targetId: string, text: string, locale?: "zh" | "en"): Promise<void>;
  /**
   * Binds a persona as the default for the channel's conversations.
   *
   * The locale is the language of the person who is binding it, and it
   * decides the language of the error a failed bind reports.
   */
  setDefaultPersona(userId: number, personaId: number, locale?: "zh" | "en"): Promise<void>;
  /**
   * Restores a previously connected channel on boot.
   *
   * Returns true when the channel was restored. Channels that cannot be
   * restored (missing credentials, expired sessions) simply return false.
   */
  restore?(userId: number): Promise<boolean>;
}

/**
 * The display name of a channel, in the language asked for.
 */
export function channelLabel(adapter: ChannelAdapter, locale: "zh" | "en" = "zh"): string {
  return adapter.labelForLocale ? adapter.labelForLocale(locale) : adapter.label;
}
