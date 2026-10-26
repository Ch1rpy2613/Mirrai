/**
 * Inbound WeChat message handling.
 *
 * Replaces the Wechaty-based handler. The input is now the parsed iLink
 * message plus the Mirrai account it belongs to.
 */
import type { ParsedInbound } from "./ilink/parse";
import { getActivePersonaId, handleCommand } from "./commands";
import { handlePersonaChat } from "./persona-bridge";
import * as db from "../db";
import { copy } from "@shared/copy";

export async function handleWeixinMessage(
  userId: number,
  parsed: ParsedInbound,
): Promise<void> {
  // The ClawBot channel is private by design; group conversations are not
  // supported by the official plugin.
  if (parsed.isGroup) return;

  const text = parsed.text?.trim();
  if (!text) return;

  const locale = await db.getUserLocale(userId).catch(() => "zh" as const);
  /**
   * The persona this conversation talks to.
   *
   * A WeChat account that has never been bound falls back to the
   * channel's own choice, the one made in the interface.
   */
  const binding =
    (await db.getWechatBindingByUserId(parsed.fromUserId, userId)) ??
    (await db.getChannelDefaultPersona(userId, "wechat"));
  if (!binding) {
    /**
     * In the reader's own language.
     *
     * The message was hard-coded Chinese — so an English user on
     * WeChat was told, in Chinese, to go and set a default persona on
     * the web.
     */
    await sendText(userId, parsed, copy(locale, "channels.noDefaultPersonaWechat"));
    return;
  }

  const defaultPersonaId = binding.personaId;

  // Slash commands are handled before the LLM so they cost no model calls.
  const commandResult = await handleCommand({
    userId,
    wechatUserId: parsed.fromUserId,
    text,
    defaultPersonaId,
    sendLetter: async (letter) => {
      return sendText(userId, parsed, letter);
    },
  });

  if (commandResult.handled) {
    if (commandResult.reply) {
      await sendText(userId, parsed, commandResult.reply);
    }
    return;
  }

  // Normal conversation with the active persona.
  //
  // The user id matters: the overrides are keyed by the user as well as
  // the conversation, and without it the lookup falls back to "the first
  // key that ends with this conversation" — across every user. The
  // wrong persona id is then looked up with the caller's id, finds
  // nothing, and the message is never answered.
  const personaId = getActivePersonaId(parsed.fromUserId, defaultPersonaId, userId);
  let reply: string | null = null;
  try {
    reply = await handlePersonaChat({
      userId,
      wechatUserId: parsed.fromUserId,
      personaId,
      messageText: text,
    });
  } catch (e) {
    /**
     * The user is told.
     *
     * The failure used to be swallowed: the pipeline reports it as an
     * event, so it arrived here as an empty reply and the message was
     * dropped without a word. The user watched their message sit there
     * unanswered.
     */
    console.warn("[WeChat] Could not answer:", (e as Error).message);
    await sendText(userId, parsed, copy(locale, "channels.replyFailed"));
    return;
  }

  if (!reply) return;

  // The bridge appends the note itself, when the app has decided that a
  // farewell is due.
  //
  // It used to be appended twice — once by the bridge and once here —
  // so the user received two instructions to type "/毕业" at the end of
  // one message. And it was hard-coded Chinese, so an English user on
  // WeChat was told to type a Chinese command.
  /**
   * The delivery is checked.
   *
   * The reply is stored in the conversation before it is sent, so the
   * web interface shows the conversation as answered. When the send
   * failed — the token had expired, the backend refused it, the user
   * had blocked the bot — nothing arrived, and the user was told
   * nothing at all.
   */
  const delivered = await sendText(userId, parsed, reply);
  if (!delivered) {
    const { noteDeliveryFailure } = await import("./bot");
    noteDeliveryFailure(
      userId,
      // The reason is about the delivery — not about the reply, which
      // was produced perfectly well.
      copy(locale, "channels.messageFailed", { reason: copy(locale, "channels.deliveryFailed") }),
    );
  }
}

/**
 * Sends a text reply, carrying the inbound context token so the backend
 * accepts the message.
 */
async function sendText(
  userId: number,
  parsed: ParsedInbound,
  text: string,
): Promise<boolean> {
  const { sendWeixinText } = await import("./bot");
  return sendWeixinText(userId, parsed.fromUserId, text, parsed.contextToken);
}
