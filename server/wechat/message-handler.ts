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

export async function handleWeixinMessage(
  userId: number,
  parsed: ParsedInbound,
): Promise<void> {
  // The ClawBot channel is private by design; group conversations are not
  // supported by the official plugin.
  if (parsed.isGroup) return;

  const text = parsed.text?.trim();
  if (!text) return;

  const binding = await db.getWechatBindingByUserId(parsed.fromUserId, userId);
  if (!binding) {
    await sendText(userId, parsed, "还没有设置默认分身。请在网页端「设置 → 微信」里选择要对话的分身。");
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
  const reply = await handlePersonaChat({
    userId,
    wechatUserId: parsed.fromUserId,
    personaId,
    messageText: text,
  });

  if (!reply) return;

  // The bridge appends the note itself, when the app has decided that a
  // farewell is due.
  //
  // It used to be appended twice — once by the bridge and once here —
  // so the user received two instructions to type "/毕业" at the end of
  // one message. And it was hard-coded Chinese, so an English user on
  // WeChat was told to type a Chinese command.
  await sendText(userId, parsed, reply);
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
