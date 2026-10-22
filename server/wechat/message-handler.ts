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
  const personaId = getActivePersonaId(parsed.fromUserId, defaultPersonaId);
  const reply = await handlePersonaChat({
    userId,
    wechatUserId: parsed.fromUserId,
    personaId,
    messageText: text,
  });

  if (!reply) return;

  // When the system has decided it is time to let go, surface the option
  // alongside the reply so the ritual can be completed from WeChat.
  const persona = await db.getPersonaById(personaId, userId);
  if (persona?.graduationStatus === "suggested") {
    await sendText(
      userId,
      parsed,
      `${reply}\n\n（如果你觉得是时候了，回复「/毕业」我来写最后一封信。）`,
    );
    return;
  }

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
