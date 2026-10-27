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
import { clearAllActivePersonas, getActivePersonaId, handleCommand } from "./commands";
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
    message?: { message_type?: string; content?: string; message_id?: string };
    sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  };
  sendText: (targetId: string, text: string) => Promise<void>;
  /**
   * The bot's own open id.
   *
   * Feishu delivers the messages the app sends back into the same
   * event stream, so the bot answered itself — and the answer came
   * back, and was answered too. An endless loop of model calls, at
   * the user's expense.
   */
  botOpenId?: string | null;
}): Promise<void> {
  const { userId, event, sendText } = params;
  const chatId = event?.chat_id;
  if (!chatId) return;

  /**
   * The bot's own messages are not answered.
   *
   * Two ways to recognise them: the sender is an application rather
   * than a person, and the sender is this bot.
   */
  const senderType = event?.sender?.sender_type;
  const senderOpenId = event?.sender?.sender_id?.open_id;
  if (senderType === "app") return;
  if (params.botOpenId && senderOpenId === params.botOpenId) return;

  /**
   * The delivery is only answered once.
   *
   * Feishu retries a delivery it did not hear an answer to — and the
   * guard against that was written and never called, so a retried
   * message was answered twice: two replies to the same question, and
   * two model calls.
   */
  const messageId = event.message?.message_id;
  if (messageId && hasProcessedEvent(userId, messageId)) return;

  // Feishu delivers group messages too; the ClawBot-style private
  // conversation is the supported model here.
  if (event.chat_type && event.chat_type !== "p2p") return;

  const text = extractMessageText(event.message ?? {});
  if (!text || !text.trim()) return;

  /**
   * The language the persona answers in.
   *
   * It used to be detected from each message — so the same conversation
   * could change language halfway through, and an English user who
   * never touched the switch got Chinese on WeChat and English here.
   *
   * The user's own saved language is the rule on both sides now: it is
   * the one they chose, it does not change from message to message, and
   * it is the same answer whichever door they came in by.
   */
  const locale = await db.getUserLocale(userId).catch(() => "zh" as Locale);

  /**
   * The persona this conversation talks to.
   *
   * A conversation on Feishu only learns its id when the first message
   * arrives — so a conversation that has never been bound falls back
   * to the channel's own choice, the one made in the interface.
   *
   * Without that fallback the channel could never answer: the bot said
   * "choose a persona under Settings → Feishu", and there was nothing
   * there to choose with.
   */
  const binding =
    (await db.getChannelBinding(userId, CHANNEL_ID, chatId)) ??
    (await db.getChannelDefaultPersona(userId, CHANNEL_ID));
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
    // The channel names itself — so the message that says where a
    // letter was saved can say "Feishu" and not "this channel".
    channel: "feishu",
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
    // only has to enter them once. The secret is not stored twice: the
    // *same* encrypted blob is written to the collection source.
    //
    // But the blob has to be in the collector's own vocabulary. The
    // channel calls them `appId` and `appSecret`; the collector calls
    // them `app_id` and `app_secret` — and it reads them by those
    // names. So the channel's blob was written as it was, the
    // collector's own copy was overwritten by it, and every Feishu
    // collection afterwards failed with "no Feishu credentials found",
    // seconds after the user had entered them.
    try {
      const { saveCollectionSource } = await import("../collectors/db-store");
      const collectorBlob = await encryptSecret(JSON.stringify({
        app_id: merged.appId,
        app_secret: merged.appSecret,
      }));
      await saveCollectionSource({
        userId,
        source: "feishu",
        label: copy("zh", "labels.collector.feishu"),
        encryptedCredentials: collectorBlob,
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

    /**
     * The app id is checked before anything is started.
     *
     * The SDK checks it too — and when it does not match, it writes an
     * error to its own log and *returns*, without connecting. So the
     * channel said "connected" and nothing was behind it, and the only
     * trace was a line in the server's log that nobody reads.
     */
    if (!/^cli_[0-9a-fA-F]{16}$/.test(credentials.appId)) {
      throw new Error(copy(locale, "errors.feishuInvalidAppId"));
    }

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

    /**
     * The send.
     *
     * A failure here used to be swallowed: the SDK's `create` returns
     * an object with a `code` in it rather than throwing, so a
     * rejected message — a revoked permission, a chat that is gone —
     * looked exactly like a delivered one, and the user was told their
     * message had arrived.
     *
     * So the code in the answer is read, and a failure is raised.
     */
    const sendText = async (targetId: string, text: string) => {
      const result = (await client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: targetId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      })) as { code?: number; msg?: string } | undefined;
      const code = result?.code;
      if (typeof code === "number" && code !== 0) {
        throw new Error(
          copy(locale, "errors.feishuSendFailed", {
            message: result?.msg || String(code),
          }),
        );
      }
    };

    /**
     * The bot's own open id, read once.
     *
     * It is what tells an echo from a person: Feishu sends the app's
     * own messages back into the same stream, and the bot answered
     * itself — and the answer came back, and was answered too. An
     * endless loop of model calls, at the user's expense.
     *
     * It is read the first time a message arrives, and then kept.
     */
    let botOpenId: Promise<string | null> | null = null;
    const readBotOpenId = (): Promise<string | null> => {
      if (!botOpenId) {
        botOpenId = (async () => {
          try {
            // The bot's own identity: GET /open-apis/bot/v3/info.
            //
            // The typed client does not declare the generic request, so
            // it is called through the runtime's own shape.
            const response = (await (client as any).request({
              url: "/open-apis/bot/v3/info",
              method: "GET",
            })) as any;
            const info = response?.data ?? response;
            return info?.bot?.open_id ?? info?.data?.bot?.open_id ?? null;
          } catch (e) {
            // The sender type still tells an echo from a person.
            console.warn("[Feishu] Could not read the bot's own id:", (e as Error).message);
            return null;
          }
        })();
      }
      return botOpenId;
    };

    const dispatcher = new lark.EventDispatcher().register({
      "im.message.receive_v1": async (data: any) => {
        // Feishu expects a reply within three seconds. The conversation takes
        // far longer than that, so it is started in the background and the
        // callback returns immediately.
        const chatId = data?.event?.chat_id;
        /**
         * The chain is keyed by the user as well as the chat.
         *
         * The chat id alone was the key — so two users whose chats
         * shared an id waited on each other's conversation. The ids
         * come from the other side of the platform, and the map is
         * shared by every user of this process.
         */
        const chainKey = chatId ? `${userId}:${chatId}` : null;
        const previous = chainKey ? conversationChains.get(chainKey) : undefined;
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
              botOpenId: await readBotOpenId(),
            });
          } finally {
            giveTheRoomBack();
          }
        })().catch((e) => console.error("[Feishu] Failed to handle event:", e));

        if (chainKey) {
          conversationChains.set(chainKey, run);
          // The chain is let go of once it has settled, so the map does
          // not grow for the life of the process.
          void run.finally(() => {
            if (conversationChains.get(chainKey) === run) conversationChains.delete(chainKey);
          });
        }
      },
    });

    /**
     * The connection is started, and what happened is looked at.
     *
     * `start` resolves as soon as it has *begun* — it does not wait
     * for the socket, and it never fails, because the failure happens
     * in the socket. So the status was set to "connected" before
     * anything was connected, and a Feishu that refused the connection
     * showed "connected" for ever.
     *
     * The state is read from the client instead: "connected" is only
     * written when the socket is really up.
     */
    await ws.start({ eventDispatcher: dispatcher });
    connections.set(userId, { client, ws });

    const state = ws.getConnectionStatus?.();
    if (state && state.state !== "connected") {
      /**
       * The socket is closed before the entry is dropped.
       *
       * The SDK's client reconnects by itself — so a connection that
       * never came up stayed reconnecting in the background, and the
       * retry made a *second* client. And `stop()` could not close it,
       * because the map no longer had it: the connection was alive on
       * the machine and nothing could reach it.
       */
      try {
        ws.close?.();
      } catch {
        // Already closed.
      }
      connections.delete(userId);
      const message = copy(locale, "errors.feishuNotConnected");
      await db.upsertChannelState(userId, CHANNEL_ID, {
        status: "error",
        lastError: message,
      }).catch(() => {});
      throw new Error(message);
    }

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
    /**
     * The session overrides are cleared.
     *
     * The WeChat channel does this when it stops; the Feishu one did
     * not — so the persona a conversation was switched to stayed in
     * force after the channel was disconnected, and came back with it
     * when the channel was connected again.
     */
    clearAllActivePersonas(userId);
    await db.upsertChannelState(userId, CHANNEL_ID, { status: "stopped" });
  }

  async stopAll(): Promise<void> {
    for (const userId of Array.from(connections.keys())) {
      try {
        await this.stop(userId);
      } catch {
        // A connection that will not close must not hold the
        // shutdown up.
      }
    }
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
    /**
     * The code in the answer is read.
     *
     * The SDK does not throw for a business error — it hands back the
     * body Feishu sent, with HTTP 200 and a `code` in it. So a
     * message Feishu refused — a revoked permission, a chat that is
     * gone, the bot taken out of the room — looked exactly like a
     * delivered one.
     *
     * The inbound sender above has always checked it. Only the
     * outbound path was missed, and three callers use "did it throw?"
     * as the delivery test: the proactive sweep marked the message as
     * sent (and advanced the clock, so it was never tried again), the
     * reminders kept the claim and vanished, and the app told the
     * owner they had been notified.
     */
    const result = (await connection.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: targetId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    })) as { code?: number; msg?: string } | undefined;
    const code = result?.code;
    if (typeof code === "number" && code !== 0) {
      throw new Error(
        copy(locale, "errors.feishuSendFailed", {
          message: result?.msg || String(code),
        }),
      );
    }
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
