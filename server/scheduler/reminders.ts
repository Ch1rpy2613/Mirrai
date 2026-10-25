/**
 * Proactive reminders.
 *
 * The product document describes "memory triggers" — the app reaching out
 * when a date comes round, rather than only when the user opens it. This
 * module decides what is worth saying and when; `server/scheduler/index.ts`
 * runs it on a tick.
 */
import { ENV } from "../_core/env";
import * as db from "../db";
import { getChannelAdapter } from "../channels";
import { resolvePresence, mayReachOut } from "@shared/graduation-mode";
import { resolveRelationshipPhase } from "@shared/user-side";
import { copy, type Locale } from "@shared/copy";

export type ReminderKind = "anniversary" | "together_years" | "memory_trigger";

export interface Reminder {
  kind: ReminderKind;
  personaId: number;
  personaName: string;
  /** A stable key for today — the same reminder is only delivered once. */
  dedupeKey: string;
  /** The text to deliver. */
  text: string;
}

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Parses the quiet-hours setting, e.g. "23:00-08:00".
 */
export function isQuietHour(now: Date, spec: string): boolean {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(spec.trim());
  if (!match) return false;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  const minutes = now.getHours() * 60 + now.getMinutes();

  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  // A window that wraps past midnight covers the evening and the early hours.
  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * Works out which reminders are due for a persona today.
 */
export function collectReminders(params: {
  persona: {
    id: number;
    name: string;
    togetherFrom: string | null;
    /** When the relationship ended; null means it is still going on. */
    togetherTo?: string | null;
    /**
     * Whether the relationship is over, as the user's own events record it.
     *
     * A breakup the user wrote down is as final as an end date, and it
     * reaches the reminders even when the end date was never filled in.
     */
    relationshipEnded?: boolean;
    remindersEnabled: boolean;
    /** "quiet" and "asleep" mean the app must not reach out. */
    presence?: string | null;
    graduationStatus?: string | null;
    /**
     * Whether the two of them can reach each other right now.
     *
     * "unreachable" is not a breakup — but a push that says "today is
     * your anniversary" to somebody you cannot get through to is the
     * wrong thing to send. The relationship reminders stop; the warmth
     * does not.
     */
    reachability?: string | null;
  };
  anniversaries: Array<{ id: number; title: string; date: string | null }>;
  /** Photos the user shared, each with whatever was extracted from it. */
  photos?: Array<{ id: number; originalName: string; extractedMemory: string | null; createdAt: Date }>;
  /**
   * The language the reminder is written in.
   *
   * A reminder arrives on its own, at a moment the app chose, and it
   * lands next to the messages the person is there to read. It has to be
   * in their language.
   */
  locale?: Locale;
  now?: Date;
}): Reminder[] {
  const now = params.now ?? new Date();
  const locale = params.locale ?? "zh";
  const reminders: Reminder[] = [];

  if (!params.persona.remindersEnabled) return reminders;

  // A persona that has said goodbye, or that the user asked to be left
  // alone, must not have anything pushed to it. Announcing the anniversary
  // of a relationship the user has ended is the opposite of what the
  // graduation mechanism is for.
  const presence = resolvePresence(
    params.persona.presence,
    params.persona.graduationStatus,
  );
  if (!mayReachOut(presence)) return reminders;

  // The relationship has ended: the shared anniversaries and the years
  // together are a memory, not something to be celebrated today.
  const relationshipEnded =
    params.persona.relationshipEnded ?? Boolean(params.persona.togetherTo?.trim());

  // The two of them cannot reach each other right now. That is not the
  // end of anything — but it does mean the anniversaries are not for
  // today. "你们在一起三周年了" is a sentence nobody wants to be
  // pushed at three in the morning when they cannot even get through
  // to the person.
  const unreachable = params.persona.reachability === "unreachable";

  const dayKey = todayKey(now);
  const monthDay = now.toISOString().slice(5, 10); // MM-DD

  if (!relationshipEnded && !unreachable) {
    for (const anniversary of params.anniversaries) {
      if (!anniversary.date) continue;
      const date = anniversary.date.trim();
      // Either "MM-DD" (a yearly anniversary) or a full date.
      const matches =
        date === monthDay ||
        (date.length >= 10 && date.slice(5, 10) === monthDay) ||
        date === dayKey;
      if (!matches) continue;

      reminders.push({
        kind: "anniversary",
        personaId: params.persona.id,
        personaName: params.persona.name,
        dedupeKey: `anniversary:${anniversary.id}:${dayKey}`,
        text: copy(locale, "reminders.anniversary", { title: anniversary.title }),
      });
    }

    const from = params.persona.togetherFrom?.trim();
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) {
        const years = now.getFullYear() - start.getFullYear();
        const anniversaryThisYear = new Date(now.getFullYear(), start.getMonth(), start.getDate());
        const diffDays = Math.round(
          (now.getTime() - anniversaryThisYear.getTime()) / 86_400_000,
        );
        // Only the day itself, not a week of "it's nearly your anniversary".
        if (diffDays === 0 && years > 0) {
          reminders.push({
            kind: "together_years",
            personaId: params.persona.id,
            personaName: params.persona.name,
            dedupeKey: `together_years:${params.persona.id}:${dayKey}`,
            text: copy(locale, "reminders.togetherYears", {
              name: params.persona.name,
              years,
            }),
          });
        }
      }
    }
  }

  // A photo the user shared can carry its own date. When that date comes
  // round again, the persona has something to say about it.
  for (const photo of params.photos ?? []) {
    const label = photo.originalName?.trim() || copy(locale, "reminders.photoFallbackLabel");
    const date = extractPhotoDate(photo.extractedMemory, photo.createdAt);
    if (!date) continue;

    const matches =
      date === monthDay ||
      (date.length >= 10 && date.slice(5, 10) === monthDay) ||
      date === dayKey;
    if (!matches) continue;

    reminders.push({
      kind: "memory_trigger",
      personaId: params.persona.id,
      personaName: params.persona.name,
      dedupeKey: `memory_trigger:${photo.id}:${dayKey}`,
      text: copy(locale, "reminders.photoOnThisDay", {
        name: params.persona.name,
        label,
      }),
    });
  }

  return reminders;
}

/**
 * Finds the date a photo belongs to.
 *
 * The extracted text usually mentions it ("2021-05-20 在海边"); when it does
 * not, the upload date is the best guess available.
 */
export function extractPhotoDate(
  extractedMemory: string | null | undefined,
  createdAt: Date,
): string | null {
  if (extractedMemory) {
    const match = extractedMemory.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/);
    if (match) return match[0];
  }
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return null;
  return createdAt.toISOString().slice(0, 10);
}

/**
 * Delivers a reminder on the best available channel.
 *
 * A bound channel is preferred; otherwise the reminder is recorded for the
 * web client to show in the lobby.
 */
export async function deliverReminder(params: {
  userId: number;
  reminder: Reminder;
  targetId?: string | null;
  channel?: string | null;
  locale?: Locale;
  now?: Date;
}): Promise<boolean> {
  const { userId, reminder } = params;
  const now = params.now ?? new Date();
  // The channel's own wording — what it says when it cannot deliver — has
  // to be in the language of the person it is delivering to.
  const locale = params.locale ?? (await db.getUserLocale(userId));

  if (isQuietHour(now, ENV.reminderQuietHours)) {
    return false;
  }

  // The scheduler ticks every minute. Without this check the same
  // anniversary would be pushed to the channel once a minute for the whole
  // day — the dedupe row is only written *after* the send, so the row
  // alone cannot prevent the repeat.
  if (await db.hasReminderDelivery(userId, reminder.dedupeKey)) {
    return false;
  }

  // Prefer a bound conversation channel.
  if (params.channel && params.targetId) {
    const adapter = getChannelAdapter(params.channel as any);
    if (adapter) {
      try {
        await adapter.send(userId, params.targetId, reminder.text, locale);
        const recorded = await db.recordReminder({
          userId,
          personaId: reminder.personaId,
          channel: params.channel,
          kind: reminder.kind,
          text: reminder.text,
          dedupeKey: reminder.dedupeKey,
          scheduledFor: now,
        });
        return recorded;
      } catch (e) {
        console.warn(`[Reminders] Could not deliver on ${params.channel}:`, e);
      }
    }
  }

  // Otherwise it surfaces in the web client.
  const recorded = await db.recordReminder({
    userId,
    personaId: reminder.personaId,
    channel: "web",
    kind: reminder.kind,
    text: reminder.text,
    dedupeKey: reminder.dedupeKey,
    scheduledFor: now,
  });
  return recorded;
}

/**
 * Collects and delivers every reminder that is due.
 */
export async function runReminderSweep(now: Date = new Date()): Promise<number> {
  let delivered = 0;

  try {
    const personas = await db.getAllPersonasForReminders();
    for (const persona of personas) {
      const anniversaries = await db.getMemoriesByPersonaId(persona.id, persona.userId);
      const files = await db.getFilesByPersonaId(persona.id, persona.userId);
      const locale = await db.getUserLocale(persona.userId);
      const reminders = collectReminders({
        locale,
        persona: {
          id: persona.id,
          name: persona.name,
          togetherFrom: persona.togetherFrom,
          togetherTo: persona.togetherTo,
          remindersEnabled: persona.remindersEnabled,
          presence: persona.presence,
          graduationStatus: persona.graduationStatus,
          reachability: persona.reachability,
          relationshipEnded: await isRelationshipOver(
            persona.id,
            persona.userId,
            persona.togetherTo,
          ),
        },
        anniversaries: anniversaries
          .filter((m) => m.category === "anniversary")
          .map((m) => ({ id: m.id, title: m.title, date: m.date })),
        photos: files
          .filter((f) => f.fileType === "image")
          .map((f) => ({
            id: f.id,
            originalName: f.originalName,
            extractedMemory: f.extractedMemory,
            createdAt: f.createdAt,
          })),
        now,
      });

      for (const reminder of reminders) {
        const bindings = await db.getChannelBindingsByUserId(persona.userId);
        // A reminder about 小A should not be pushed into the conversation
        // that is set up for 小B. Prefer the binding for this persona; fall
        // back to the web card rather than to the wrong conversation.
        const binding =
          bindings.find((b) => b.isActive && b.personaId === reminder.personaId) ??
          null;

        const sent = await deliverReminder({
          userId: persona.userId,
          reminder,
          channel: binding?.channel ?? null,
          targetId: binding?.targetId ?? null,
          locale,
          now,
        });
        if (sent) delivered++;
      }
    }
  } catch (e) {
    console.warn("[Reminders] The sweep failed:", e);
  }

  return delivered;
}

/**
 * Whether the relationship has ended.
 *
 * Both signals count: the end date the user filled in, and the breakup the
 * user wrote down as an event. The second one matters because the date
 * field is easy to leave empty, and an anniversary announced to someone
 * whose relationship has finished is the exact opposite of what the
 * graduation mechanism is for.
 */
async function isRelationshipOver(
  personaId: number,
  userId: number,
  togetherTo: string | null,
): Promise<boolean> {
  if (togetherTo?.trim()) return true;
  try {
    const events = await db.getRelationshipEvents(personaId, userId, 20);
    const phase = resolveRelationshipPhase(events as any);
    return phase === "breakup" || phase === "apart";
  } catch {
    return false;
  }
}
