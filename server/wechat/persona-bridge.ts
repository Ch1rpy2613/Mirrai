/**
 * WeChat persona bridge.
 *
 * The conversation itself lives in `server/channels/bridge.ts` so that every
 * channel shares one implementation.
 */
import { handleChannelChat } from "../channels/bridge";
import * as db from "../db";

/**
 * Handles one inbound WeChat message against a persona.
 *
 * The persona id is resolved by the caller (default binding, or a
 * session-scoped override chosen with `/使用`).
 */
export async function handlePersonaChat(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  messageText: string;
}): Promise<string | null> {
  return handleChannelChat({
    userId: params.userId,
    conversationKey: params.wechatUserId,
    personaId: params.personaId,
    messageText: params.messageText,
    channel: "wechat",
    /**
     * The language the user reads.
     *
     * It was left out, so the bridge fell back to Chinese: an English
     * user got Chinese replies, Chinese emotion descriptions and Chinese
     * care notes on WeChat — and English on Feishu, which passes it.
     */
    locale: await db.getUserLocale(params.userId),
  });
}
