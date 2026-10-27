/**
 * The sweep that lets the persona speak first.
 *
 * It runs on the same tick as the reminders. A persona that is due
 * writes a message and it lands in the conversation, where the user will
 * find it the next time they open the app — and, if a channel is bound,
 * where the channel can deliver it.
 */
import * as db from "../db";
import { composeProactiveMessage, isProactiveDue } from "./proactive";
import { loadBehaviorProfile } from "../_core/behavior-profile";
import { resolvePresence } from "@shared/graduation-mode";
import { getChannelAdapter } from "../channels";
import { isQuietHour } from "../scheduler/reminders";
import { ENV } from "../_core/env";

/**
 * Sends the message on whichever channel is bound.
 *
 * The web client is the fallback, and the message is always stored
 * there too — the channel is a delivery, not a location.
 */
async function deliverProactive(params: {
  userId: number;
  personaId: number;
  text: string;
  emotionalState: string | null;
  /** The user's language, if the sweep has already read it. */
  locale?: "zh" | "en";
}): Promise<"web" | "wechat" | "feishu"> {
  const bindings = await db
    .getChannelBindingsByUserId(params.userId)
    .catch(() => []);
  const locale = params.locale ?? (await db.getUserLocale(params.userId).catch(() => "zh" as const));

  /**
   * The bindings, in a fixed order.
   *
   * The order the rows came back in is the database's, not the app's —
   * so a user with the same persona bound on two channels had the
   * message go to one of them and then, on the next sweep, to the
   * other. The reminder sweep already sorts its bindings; this one now
   * does the same, so the choice is the same every time.
   */
  const orderedBindings = [...bindings].sort((a, b) => {
    if (a.personaId !== b.personaId) return a.personaId - b.personaId;
    if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
    return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  });

  for (const binding of orderedBindings) {
    if (!binding.isActive) continue;
    // The channel carries a persona of its own; a message from a
    // different one would arrive in the wrong conversation.
    if (binding.personaId !== params.personaId) continue;

    const adapter = getChannelAdapter(binding.channel as any);
    if (!adapter) continue;

    try {
      await adapter.send(params.userId, binding.targetId, params.text, locale);
      return binding.channel as "wechat" | "feishu";
    } catch (e) {
      console.warn(
        `[Proactive] Could not deliver on ${binding.channel}:`,
        (e as Error).message,
      );
    }
  }

  return "web";
}

/**
 * The personas whose last attempt failed, and when.
 *
 * A persona that cannot be written for — a model that is down, a
 * provider that refuses — was tried again on the next tick, and the
 * next, and the next. The sweep runs every minute, so a broken
 * provider cost a model call a minute, for ever, for that persona.
 *
 * The backoff is in memory: it is a cushion, not a record, and a
 * restart clearing it is fine.
 */
const failedAttempts = new Map<number, number>();

/** How long a persona waits after a failed attempt. */
const FAILURE_BACKOFF_MS = 60 * 60 * 1000;

/**
 * The moment the silence began.
 *
 * The later of the two: the last time the *user* spoke, and the last
 * time the app spoke first.
 *
 * The user's silence is what the message is about — but the app's own
 * voice is what the window is counted from, because the rule is "the
 * app may not speak first more often than the window the user bought".
 * Measuring the window from the user's silence alone meant the app's
 * own message never reset it: the persona was due again on the next
 * tick, and the next, writing a fresh message — and paying for a fresh
 * model call — every minute.
 *
 * The old column is the fallback, for the personas that have not been
 * spoken to since the column was added.
 */
function silenceStart(row: {
  lastChatAt: Date | null;
  lastUserMessageAt: Date | null;
}): Date | null {
  const user = row.lastUserMessageAt ? new Date(row.lastUserMessageAt) : null;
  const app = row.lastChatAt ? new Date(row.lastChatAt) : null;
  if (user && app) {
    const later = user.getTime() >= app.getTime() ? user : app;
    return Number.isNaN(later.getTime()) ? null : later;
  }
  const only = user ?? app;
  if (!only) return null;
  return Number.isNaN(only.getTime()) ? null : only;
}

export async function runProactiveSweep(now: Date = new Date()): Promise<number> {
  let sent = 0;

  /**
   * The user's own settings, read once per tick.
   *
   * The sweep runs every minute and walks every persona. The locale,
   * the time zone and the channel bindings are the *user's*, not the
   * persona's — so a user with five personas was read five times, every
   * minute, for ever.
   */
  const perUser = new Map<number, {
    locale: "zh" | "en";
    timezone: string | null;
  }>();

  const candidates = await db.getProactivePersonas();
  for (const row of candidates) {
    try {
      /**
       * A persona that failed recently is left alone.
       *
       * The failure happened before the message was written, so the
       * persona is still "due" — and without this the sweep tried it
       * again a minute later, and the minute after that.
       */
      const lastFailure = failedAttempts.get(row.id);
      if (lastFailure !== undefined && now.getTime() - lastFailure < FAILURE_BACKOFF_MS) {
        continue;
      }
      /**
       * The whole persona row is not read here.
       *
       * It used to be — every minute, for every proactive persona —
       * just to learn whether the persona was ready and how it
       * behaves. Both are in the row the sweep already has. So an
       * instance with twenty proactive personas read twenty full rows
       * a minute and threw nineteen of them away.
       */
      if (row.analysisStatus !== "ready") continue;

      const presence = resolvePresence(
        row.presence,
        row.graduationStatus,
      );
      if (!isProactiveDue({
        frequencyHours: row.proactiveFrequencyHours,
        /**
         * The silence, measured from the later of the two.
         *
         * There are two clocks, and they are not the same question.
         * "How long has the *user* been quiet" is one; "when did the
         * app last speak first" is the other. The persona may not speak
         * first more often than the window the user bought — and the
         * window is counted from the later of the two, or the app
         * would speak first every tick: the sweep wrote a message, the
         * column it measured from never moved, the deadline stayed in
         * the past, and the persona was due again on the very next
         * minute. A fresh model call, a fresh message, for ever.
         *
         * The user's own column is the one that matters for the
         * *content* of the message — and `collectProactiveContext`
         * measures that from the user's silence, not from the app's.
         */
        lastChatAt: silenceStart(row),
        presence,
        now,
        // The persona's own timing, when it has been measured. Without
        // it the old fixed window applies and nothing changes.
        personaId: row.id,
        behaviorProfile: loadBehaviorProfile(row),
      })) {
        continue;
      }

      // Where it goes.
      //
      // A message the user only finds by opening the app is a message
      // that arrives too late to matter. If a channel is bound, that is
      // where the persona would have written, so that is where it goes.
      // The quiet hours apply here too. A message that wakes somebody at
      // three in the morning is not the persona being thoughtful — it is
      // the app being inconsiderate, and the quiet hours are the user's
      // own decision about when that is acceptable.
      /**
       * The quiet hours are the *reader's* decision.
       *
       * They were measured against the server's wall clock, because no
       * zone was passed at all: so at half past midnight in the user's
       * own time the app decided it was not quiet and pushed a message,
       * and at half past eight in the morning — when their quiet hours
       * ended — it decided it was quiet and delivered nothing all day.
       *
       * The check is made *before* the message is composed. It used to
       * come after: so every tick during the quiet hours wrote a
       * message, paid for the model call, and threw it away — and since
       * it was never stored, the persona stayed "due" and the next tick
       * did it again. That is about five hundred wasted model calls per
       * due persona per night.
       */
      let settings = perUser.get(row.userId);
      if (!settings) {
        settings = {
          locale: await db.getUserLocale(row.userId).catch(() => "zh" as const),
          timezone: await db.getUserTimezone(row.userId).catch(() => null),
        };
        perUser.set(row.userId, settings);
      }
      if (isQuietHour(now, ENV.reminderQuietHours, settings.timezone)) {
        continue;
      }

      /**
       * The language the persona speaks.
       *
       * The locale was read for the delivery and then not passed here
       * — so the message was composed in Chinese, the system prompt
       * included, and an English user had a Chinese message pushed
       * into their channel.
       */
      /**
       * The persona, in full.
       *
       * Only now — the persona is about to be spoken for, and the
       * message is composed from everything it knows.
       */
      const persona = await db.getPersonaById(row.id, row.userId);
      if (!persona) continue;

      const text = await composeProactiveMessage({
        persona,
        userId: row.userId,
        locale: settings.locale,
        now,
      });
      if (!text) continue;

      /**
       * The message is stored before it is sent.
       *
       * It used to be sent first and stored afterwards — and if the
       * store failed, the "the clock starts again" line never ran
       * either. So the silence never restarted, and the next tick, a
       * minute later, composed and sent another one: a stream of
       * near-duplicate messages, each freshly written so with different
       * wording, pushed to the user's channel.
       */
      const messageId = await db.createMessage({
        personaId: persona.id,
        userId: row.userId,
        role: "assistant",
        content: text,
        emotionalState: persona.emotionalState,
        channel: "web",
        // It spoke first. The label is what makes the difference
        // between "they messaged me" and "the app told me something".
        origin: "proactive",
      });
      // The clock starts again: the user has been written to.
      await db.updatePersona(persona.id, row.userId, { lastChatAt: now });

      const delivered = await deliverProactive({
        userId: row.userId,
        personaId: persona.id,
        text,
        emotionalState: persona.emotionalState,
        locale: settings.locale,
      });
      // The channel it went out on is worth recording.
      if (delivered !== "web" && messageId) {
        await db.updateMessageChannel(messageId, row.userId, delivered).catch(() => undefined);
      }
      sent += 1;
      failedAttempts.delete(row.id);
    } catch (e) {
      console.warn("[Proactive] Could not write a message:", (e as Error).message);
      // The persona waits before it is tried again.
      failedAttempts.set(row.id, now.getTime());
    }
  }

  return sent;
}
