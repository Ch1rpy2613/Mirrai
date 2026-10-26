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
import { runConversation, PersonaAsleepError } from "../chat/service";
import { copy } from "@shared/copy";

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
  let graduationSuggested = false;

  try {
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
      } else if (event.type === "done") {
        graduationSuggested = event.graduationSuggested;
      }
    }
  } catch (e) {
    /**
     * A persona that has said goodbye.
     *
     * `runConversation` throws when the persona is asleep, and the
     * message is the notice the app means to show: "{name} has
     * graduated. If you still want to talk, wake this persona up
     * first."
     *
     * On the web the throw became a response, so the user saw it. On a
     * channel both entry points only logged it — so a person who kept
     * talking to a persona that had said goodbye watched their message
     * sit there unanswered for ever, with no indication that the
     * persona was asleep.
     */
    if (e instanceof PersonaAsleepError) return e.message;
    throw e;
  }

  /**
   * The app may have decided that a farewell is due.
   *
   * On the web that opens a card; on a channel there is nowhere to open
   * one, so the suggestion was simply dropped — which meant the one
   * place the user is least surrounded by the rest of the interface was
   * the one place the suggestion never reached.
   *
   * The note is added here, and only here. The channels used to add a
   * second one of their own, so the user received two instructions to
   * type "/毕业" at the end of one message.
   */
  const farewellDue = graduationSuggested || persona.graduationStatus === "suggested";
  if (farewellDue && reply) {
    reply += copy(params.locale ?? "zh", "channels.graduationNote");
  }

  return reply;
}
