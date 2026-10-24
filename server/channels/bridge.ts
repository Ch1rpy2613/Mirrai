/**
 * The conversation bridge shared by every channel.
 *
 * A channel delivers a message; this turns it into a reply from the user's
 * persona. The actual conversation lives in `server/chat/service.ts`, so the
 * web UI, the streaming endpoint and every channel behave identically —
 * memory recall, the safety layer and the graduation check all apply.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { runConversation } from "../chat/service";

export type ChannelId = "wechat" | "feishu";

export interface ChannelChatParams {
  userId: number;
  /** The conversation identifier on the channel. */
  conversationKey: string;
  personaId: number;
  messageText: string;
  /** Which channel the message arrived on. */
  channel: ChannelId;
  /**
   * The user's interface language.
   *
   * The channels have no language switch of their own, so this comes from
   * the user's saved preference. It decides which emotion triggers the
   * heuristic uses and which language the prompt is written in.
   */
  locale?: "zh" | "en";
}

/**
 * Handles one inbound channel message against a persona.
 *
 * The persona id is resolved by the caller (default binding, or a
 * session-scoped override chosen with `/使用`).
 *
 * Returns null when the persona cannot answer — not ready, or gone.
 */
export async function handleChannelChat(params: ChannelChatParams): Promise<string | null> {
  const { userId, personaId, messageText } = params;

  const persona = await db.getPersonaById(personaId, userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  let reply: string | null = null;

  for await (const event of runConversation({
    persona: persona as Persona,
    userId,
    message: messageText,
    providerName: (persona as any).llmProvider || undefined,
    channel: params.channel,
    mode: "once",
    locale: params.locale ?? "zh",
  })) {
    if (event.type === "delta") {
      reply = (reply ?? "") + event.text;
    }
  }

  return reply;
}
