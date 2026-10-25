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
}): Promise<"web" | "wechat" | "feishu"> {
  const bindings = await db
    .getChannelBindingsByUserId(params.userId)
    .catch(() => []);
  const locale = await db.getUserLocale(params.userId).catch(() => "zh" as const);

  for (const binding of bindings) {
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

export async function runProactiveSweep(now: Date = new Date()): Promise<number> {
  let sent = 0;

  const candidates = await db.getProactivePersonas();
  for (const row of candidates) {
    try {
      const persona = await db.getPersonaById(row.id, row.userId);
      if (!persona) continue;
      if (persona.analysisStatus !== "ready") continue;

      const presence = resolvePresence(
        persona.presence,
        persona.graduationStatus,
      );
      if (!isProactiveDue({
        frequencyHours: row.proactiveFrequencyHours,
        lastChatAt: row.lastChatAt,
        presence,
        now,
      })) {
        continue;
      }

      const text = await composeProactiveMessage({
        persona,
        userId: row.userId,
        now,
      });
      if (!text) continue;

      // Where it goes.
      //
      // A message the user only finds by opening the app is a message
      // that arrives too late to matter. If a channel is bound, that is
      // where the persona would have written, so that is where it goes.
      // The quiet hours apply here too. A message that wakes somebody at
      // three in the morning is not the persona being thoughtful — it is
      // the app being inconsiderate, and the quiet hours are the user's
      // own decision about when that is acceptable.
      if (isQuietHour(now, ENV.reminderQuietHours)) {
        continue;
      }

      const delivered = await deliverProactive({
        userId: row.userId,
        personaId: persona.id,
        text,
        emotionalState: persona.emotionalState,
      });

      await db.createMessage({
        personaId: persona.id,
        userId: row.userId,
        role: "assistant",
        content: text,
        emotionalState: persona.emotionalState,
        channel: delivered,
        // It spoke first. The label is what makes the difference
        // between "they messaged me" and "the app told me something".
        origin: "proactive",
      });
      // The clock starts again: the user has been written to.
      await db.updatePersona(persona.id, row.userId, { lastChatAt: now });
      sent += 1;
    } catch (e) {
      console.warn("[Proactive] Could not write a message:", (e as Error).message);
    }
  }

  return sent;
}
