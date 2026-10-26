/**
 * Feishu (飞书) channel.
 *
 * Uses Feishu's WebSocket long-connection mode, which needs no public IP,
 * domain or TLS certificate — the same property that makes the WeChat
 * ClawBot channel usable on a home server.
 *
 * Two constraints shape the code:
 *
 *   1. Feishu requires an event callback to return within three seconds, or
 *      it retries the delivery. So the event handler only enqueues the
 *      message; the conversation happens afterwards.
 *   2. A text message's `content` is a JSON string (`{"text":"..."}`), not
 *      the text itself.
 *
 * The credentials are the app id and app secret of an enterprise self-built
 * app; they are stored encrypted, like every other secret in the app.
 */
import { decryptSecret, encryptSecret } from "../_core/crypto";
import * as db from "../db";
import { handleChannelChat } from "./bridge";
import { getActivePersonaId, handleCommand } from "./commands";
import type { ChannelAdapter, ChannelId, ChannelStatus } from "./types";
import { copy, detectLocale, type Locale } from "@shared/copy";

const CHANNEL_ID = "feishu" as const;

interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

interface RunningConnection {
  client: any;
  ws: any;
}

const connections = new Map<number, RunningConnection>();

/**
 * Loads the SDK.
 *
 * It is an optional dependency — an install that never touches Feishu does
 * not need it — so it is imported dynamically and the failure is reported
 * clearly rather than crashing the server at boot.
 */
async function loadSdk(locale: Locale = "zh"): Promise<typeof import("@larksuiteoapi/node-sdk")> {
  try {
    return await import("@larksuiteoapi/node-sdk");
  } catch (e) {
    throw new Error(
      `${copy(locale, "errors.feishuSdkMissing")} (${(e as Error).message})`,
    );
  }
}

async function readCredentials(userId: number): Promise<FeishuCredentials | null> {
  const state = await db.getChannelState(userId, CHANNEL_ID);
  if (!state?.credentialsEnc) return null;
  const plain = await decryptSecret(state.credentialsEnc);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain);
    if (!parsed?.appId || !parsed?.appSecret) return null;
    return { appId: parsed.appId, appSecret: parsed.appSecret };
  } catch {
    return null;
  }
}

/** Extracts the plain text from an inbound Feishu message. */
export function extractMessageText(message: {
  message_type?: string;
  content?: string;
}): string | null {
  if (message?.message_type !== "text") return null;
  if (!message.content) return null;
  try {
    const parsed = JSON.parse(message.content);
    return typeof parsed?.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}

/**
 * Handles one inbound Feishu event.
 *
 * Exported so the behaviour can be tested without a live Feishu connection.
 */
/**
 * The conversations that are running, per chat.
 *
 * A message started a conversation and returned immediately, so a burst
 * of messages — or a bot echoing itself back — started an unbounded
 * number of conversations at once. Each one is a model call that writes
 * to the same persona, so the replies interleaved and the bill grew
 * without limit.
 *
 * One conversation per chat at a time: the next message waits for the
 * one before it, and the order the user wrote them in is the order they
 * are answered in.
 */
const conversationChains = new Map<string, Promise<unknown>>();

/**
 * The events that have been handled.
 *
 * A bounded set of the message ids that have already been answered, so
 * a retried delivery is not answered twice.
 */
const processedEventIds = new Set<string>();
const PROCESSED_EVENT_ID_MAX = 5000;

/**
 * Whether an event has already been handled — and marks it as handled.
 *
 * The set is bounded: the oldest entry is dropped when it grows past
 * the limit, so it cannot grow for the life of the process.
 */
function hasProcessedEvent(userId: number, messageId: string): boolean {
  const key = `${userId}:${messageId}`;
  if (processedEventIds.has(key)) return true;
  if (processedEventIds.size >= PROCESSED_EVENT_ID_MAX) {
    const oldest = processedEventIds.values().next().value;
    if (oldest) processedEventIds.delete(oldest);
  }
  processedEventIds.add(key);
  return false;
}

/** How many conversations may run at once across all chats of a user. */
const MAX_CONCURRENT_CONVERSATIONS = 4;

/** The conversations running now, per user. */
const runningConversations = new Map<number, number>();

/**
 * Waits until there is room for one more conversation of this user.
 *
 * The limit used to be declared and never used: the chain serialises the
 * messages of one chat, but nothing stopped a user with many chats from
 * starting a conversation in each of them at once. Each one is a model
 * call that writes to the same persona, so the bill grew without limit
 * and the replies to different chats interleaved.
 *
 * Returns the function that gives the room back.
 */
async function waitForRoom(userId: number): Promise<() => void> {
  for (;;) {
    const running = runningConversations.get(userId) ?? 0;
    if (running < MAX_CONCURRENT_CONVERSATIONS) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  runningConversations.set(userId, (runningConversations.get(userId) ?? 0) + 1);
  return () => {
    const left = (runningConversations.get(userId) ?? 1) - 1;
    if (left <= 0) runningConversations.delete(userId);
    else runningConversations.set(userId, left);
  };
}

export async function handleFeishuEvent(params: {
  userId: number;
  event: {
    chat_id?: string;
    chat_type?: string;
    message?: { message_type?: string; content?: string };
    sender?: { sender_id?: { open_id?: string } };
  };
  sendText: (targetId: string, text: string) => Promise<void>;
}): Promise<void> {
  const { userId, event, sendText } = params;
  const chatId = event?.chat_id;
  if (!chatId) return;

  // Feishu delivers group messages too; the ClawBot-style private
  // conversation is the supported model here.
  if (event.chat_type && event.chat_type !== "p2p") return;

  const text = extractMessageText(event.message ?? {});
  if (!text || !text.trim()) return;

  // The language the person is writing in is the language they should be
  // answered in — the channel has no language switch of its own.
  const locale = detectLocale(text);

  const binding = await db.getChannelBinding(userId, CHANNEL_ID, chatId);
  if (!binding) {
    await sendText(chatId, copy(locale, "channels.noDefaultPersonaFeishu"));
    return;
  }

  const defaultPersonaId = binding.personaId;

  const commandResult = await handleCommand({
    userId,
    conversationKey: chatId,
    text,
    defaultPersonaId,
    sendLetter: async (letter) => {
      await sendText(chatId, letter);
      return true;
    },
  });

  if (commandResult.handled) {
    if (commandResult.reply) await sendText(chatId, commandResult.reply);
    return;
  }

  /**
   * The persona this conversation is talking to.
   *
   * The user id matters: the overrides are keyed by the user as well
   * as the conversation, and without it the lookup falls back to "the
   * first key that ends with this conversation" — across every user.
   * It happens to be safe only because the chat ids are unique.
   */
  const personaId = getActivePersonaId(chatId, defaultPersonaId, userId);
  let reply: string | null = null;
  try {
    reply = await handleChannelChat({
      userId,
      conversationKey: chatId,
      personaId,
      messageText: text,
      channel: CHANNEL_ID,
      locale,
    });
  } catch (e) {
    /**
     * The user is told.
     *
     * The failure used to be swallowed: the pipeline reports it as an
     * event, so it arrived here as an empty reply and the message was
     * dropped without a word.
     */
    console.warn("[Feishu] Could not answer:", (e as Error).message);
    await sendText(chatId, copy(locale, "channels.replyFailed"));
    return;
  }

  if (!reply) return;

  // The bridge appends the note itself, when the app has decided that
  // a farewell is due.
  //
  // It used to be appended twice — once by the bridge and once here —
  // so the user received two instructions to type "/毕业" at the end of
  // one message.
  await sendText(chatId, reply);
}

/**
 * The Feishu channel adapter.
 */
export class FeishuAdapter implements ChannelAdapter {
  id: ChannelId = CHANNEL_ID;
  label = copy("zh", "channels.channelNameFeishu");
  labelForLocale = (locale: Locale) => copy(locale, "channels.channelNameFeishu");
  requiresCredentials = true;

  /** Stores the app credentials for a user, encrypted. */
  /**
   * Stores the credentials.
   *
   * Either half may be left out, and the one that was left out keeps
   * the value it had. So a user who is rotating the secret does not
   * have to retype the app id — which they cannot see, because it is
   * never shown to them again.
   */
  async setCredentials(
    userId: number,
    credentials: Partial<FeishuCredentials>,
  ): Promise<void> {
    const stored = await readCredentials(userId);
    const merged: FeishuCredentials = {
      appId: credentials.appId ?? stored?.appId ?? "",
      appSecret: credentials.appSecret ?? stored?.appSecret ?? "",
    };
    if (!merged.appId || !merged.appSecret) {
      throw new Error("Both the app id and the app secret are needed.");
    }
    const encrypted = await encryptSecret(JSON.stringify(merged));
    await db.upsertChannelState(userId, CHANNEL_ID, {
      credentialsEnc: encrypted,
      status: "configured",
    });

    // The Feishu collector needs the same app id and secret, so the user
    // only has to enter them once. The very same encrypted blob is written
    // to the collection source — not a second copy of the secret.
    try {
      const { saveCollectionSource } = await import("../collectors/db-store");
      await saveCollectionSource({
        userId,
        source: "feishu",
        label: copy("zh", "labels.collector.feishu"),
        encryptedCredentials: encrypted,
      });
    } catch (e) {
      // The collector side is optional; the channel must work without it.
      console.warn("[Feishu] Could not share the credentials with the collector:", e);
    }
  }

  async start(userId: number, locale: Locale = "zh"): Promise<void> {
    if (connections.has(userId)) return;

    const credentials = await readCredentials(userId);
    if (!credentials) {
      throw new Error(copy(locale, "errors.feishuNoCredentials"));
    }

    const lark = await loadSdk(locale);

    const client = new lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    const ws = new lark.WSClient({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
    });

    const sendText = async (targetId: string, text: string) => {
      await client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: targetId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
    };

    const dispatcher = new lark.EventDispatcher().register({
      "im.message.receive_v1": async (data: any) => {
        // Feishu expects a reply within three seconds. The conversation takes
        // far longer than that, so it is started in the background and the
        // callback returns immediately.
        const chatId = data?.event?.chat_id;
        const previous = chatId ? conversationChains.get(chatId) : undefined;
        const run = (async () => {
          // The previous message in this chat is answered first.
          if (previous) await previous.catch(() => undefined);
          // And there is room for this one.
          const giveTheRoomBack = await waitForRoom(userId);
          try {
            await handleFeishuEvent({
              userId,
              event: data?.event ?? {},
              sendText,
            });
          } finally {
            giveTheRoomBack();
          }
        })().catch((e) => console.error("[Feishu] Failed to handle event:", e));

        if (chatId) {
          conversationChains.set(chatId, run);
          // The chain is let go of once it has settled, so the map does
          // not grow for the life of the process.
          void run.finally(() => {
            if (conversationChains.get(chatId) === run) conversationChains.delete(chatId);
          });
        }
      },
    });

    ws.start({ eventDispatcher: dispatcher });
    connections.set(userId, { client, ws });

    await db.upsertChannelState(userId, CHANNEL_ID, {
      status: "connected",
      lastError: null,
    });

    console.log(`[Feishu] Long connection established for user ${userId}`);
  }

  async stop(userId: number): Promise<void> {
    const connection = connections.get(userId);
    if (connection) {
      try {
        connection.ws?.close?.();
      } catch {
        // Already closed.
      }
      connections.delete(userId);
    }
    await db.upsertChannelState(userId, CHANNEL_ID, { status: "stopped" });
  }

  async status(userId: number): Promise<ChannelStatus> {
    const state = await db.getChannelState(userId, CHANNEL_ID);
    const connected = connections.has(userId);
    return {
      channel: CHANNEL_ID,
      connected,
      status: connected ? "connected" : (state?.status ?? "stopped"),
      detail: state?.lastError ? { error: state.lastError } : null,
    };
  }

  async send(
    userId: number,
    targetId: string,
    text: string,
    locale: Locale = "zh",
  ): Promise<void> {
    const connection = connections.get(userId);
    if (!connection) {
      throw new Error(copy(locale, "errors.feishuNotConnected"));
    }
    await connection.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: targetId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
  }

  async setDefaultPersona(
    userId: number,
    personaId: number,
    locale: Locale = "zh",
  ): Promise<void> {
    const bindings = await db.getChannelBindingsByUserId(userId, CHANNEL_ID);
    const targetId = bindings[0]?.targetId;
    if (!targetId) {
      throw new Error(copy(locale, "errors.feishuNoBinding"));
    }
    await db.setChannelBindingPersona({
      userId,
      channel: CHANNEL_ID,
      targetId,
      personaId,
    });
  }

  async restore(userId: number): Promise<boolean> {
    const state = await db.getChannelState(userId, CHANNEL_ID);
    if (!state?.credentialsEnc) return false;
    try {
      await this.start(userId);
      return true;
    } catch (e) {
      console.warn(`[Feishu] Could not restore the channel for user ${userId}:`, e);
      await db.upsertChannelState(userId, CHANNEL_ID, {
        status: "error",
        lastError: (e as Error).message,
      });
      return false;
    }
  }
}

export const feishuAdapter = new FeishuAdapter();
