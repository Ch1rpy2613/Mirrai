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
import { zonedDateKey, zonedHour, zonedMinute } from "@shared/timezone";
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

/**
 * The day, in the user's own calendar.
 *
 * The scheduler is the only part of the app that used to count days in
 * the server's — or rather, in *UTC's* — calendar: `toISOString()` is
 * the day in Greenwich, whatever the server's own clock says. An
 * anniversary was therefore matched against the wrong day for anybody
 * whose day does not start at the same moment, and the quiet hours were
 * measured against the server's wall clock rather than the reader's.
 */
function todayKey(now: Date, timezone?: string | null): string {
  return zonedDateKey(now, timezone);
}

/**
 * Parses the quiet-hours setting, e.g. "23:00-08:00".
 */
export function isQuietHour(now: Date, spec: string, timezone?: string | null): boolean {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(spec.trim());
  if (!match) return false;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);
  // The hour the *reader* is in, not the hour the server is in.
  const minutes = zonedHour(now, timezone) * 60 + zonedMinute(now, timezone);

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
  /**
   * The photos.
   *
   * The date the photo was taken is passed in rather than the whole
   * extracted text: the sweep runs once a minute, and the extracted
   * text is up to half a megabyte per file.
   */
  photos?: Array<{ id: number; originalName: string; dateHint?: string | null; createdAt: Date }>;
  /**
   * The language the reminder is written in.
   *
   * A reminder arrives on its own, at a moment the app chose, and it
   * lands next to the messages the person is there to read. It has to be
   * in their language.
   */
  locale?: Locale;
  /**
   * The time zone the reminders are counted in.
   *
   * The day an anniversary falls on is the user's day, not the server's
   * and not Greenwich's.
   */
  timezone?: string | null;
  now?: Date;
}): Reminder[] {
  const now = params.now ?? new Date();
  const locale = params.locale ?? "zh";
  const timezone = params.timezone ?? null;
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

  const dayKey = todayKey(now, timezone);
  // The month and the day, in the user's calendar.
  const monthDay = dayKey.slice(5, 10); // MM-DD

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
      /**
       * The date they met, read as a calendar day.
       *
       * It used to be read as an instant — `new Date("2021-05-20")` is
       * midnight in Greenwich — and then the year, the month and the
       * day were taken from the *server's* calendar. So on any server
       * west of Greenwich the anniversary came a day early, and the
       * year came from a different calendar than the month and the
       * day.
       *
       * The parts are read as they are written. A date with only a
       * month is the first of it, as it always was.
       */
      const parts = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(from);
      if (parts) {
        /**
         * The years, in the user's own calendar.
         *
         * The year comes from the user's day, so the anniversary is
         * counted on the day they are living on.
         */
        const userYear = Number(dayKey.slice(0, 4));
        const startYear = Number(parts[1]);
        const years = userYear - startYear;
        // The month and the day of the start, as they were written.
        const startMonthDay = `${parts[2]}-${parts[3] ?? "01"}`;
        // Only the day itself, not a week of "it's nearly your anniversary".
        if (monthDay === startMonthDay && years > 0) {
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
    const date = extractPhotoDate(photo.dateHint, photo.createdAt, timezone);
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
  dateHint: string | null | undefined,
  createdAt: Date,
  timezone?: string | null,
): string | null {
  if (dateHint) {
    const match = dateHint.match(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/);
    if (match) return match[0];
  }
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return null;
  /**
   * The day the photo was uploaded, in the reader's own calendar.
   *
   * It used to be the *UTC* day — `toISOString().slice(0, 10)` — and the
   * upload time is a timestamp without a time zone, so it is the
   * server's own wall clock. On a server that is not on UTC, every
   * photo uploaded before eight in the morning was filed under the day
   * before — so the "on this day" reminder for it came a day early.
   *
   * The day is read in the reader's calendar because that is the
   * calendar it is compared against: the anniversary it is matched
   * with is the reader's day too.
   */
  return zonedDateKey(createdAt, timezone);
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
  /** The time zone the quiet hours are measured in. */
  timezone?: string | null;
  now?: Date;
}): Promise<boolean> {
  const { userId, reminder } = params;
  const now = params.now ?? new Date();
  // The channel's own wording — what it says when it cannot deliver — has
  // to be in the language of the person it is delivering to.
  const locale = params.locale ?? (await db.getUserLocale(userId));

  if (isQuietHour(now, ENV.reminderQuietHours, params.timezone ?? null)) {
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
  const adapter =
    params.channel && params.targetId
      ? getChannelAdapter(params.channel as any)
      : undefined;

  /**
   * The slot is claimed before the reminder is sent.
   *
   * The dedupe row has a unique index on `(userId, dedupeKey)`, so
   * exactly one sweep can win it. Writing it after the send left a
   * window in which two sweeps both saw "not delivered yet" and both
   * sent — the user got the same anniversary twice, and the second one
   * arrived after they had already answered.
   *
   * If the send then fails, the claim is taken back and the next tick
   * tries again: a reminder that cannot be delivered is worth another
   * attempt, and a reminder that is delivered twice is not.
   */
  const claimed = await db.recordReminder({
    userId,
    personaId: reminder.personaId,
    channel: adapter ? params.channel! : "web",
    kind: reminder.kind,
    text: reminder.text,
    dedupeKey: reminder.dedupeKey,
    scheduledFor: now,
  });
  if (!claimed) return false;

  if (adapter) {
    try {
      await adapter.send(userId, params.targetId!, reminder.text, locale);
      return true;
    } catch (e) {
      console.warn(`[Reminders] Could not deliver on ${params.channel}:`, e);
      /**
       * The claim moves to the web.
       *
       * It used to be given back and claimed again — two writes where
       * one will do. And if the first write failed (and its error was
       * swallowed), the second one hit the unique index and did
       * nothing: so the reminder was neither sent nor shown, and the
       * old claim stood for the rest of the day.
       */
      const moved = await db
        .moveReminderToWeb(userId, reminder.dedupeKey)
        .catch((e2) => {
          console.warn("[Reminders] Could not move the reminder to the web:", e2);
          return false;
        });
      if (moved) return true;
      // The claim could not be moved, so the slot is given back and the
      // next tick tries again — a reminder that cannot be delivered is
      // worth another attempt.
      await db.forgetReminder(userId, reminder.dedupeKey).catch(() => undefined);
      return false;
    }
  }

  /**
   * Otherwise it surfaces in the web client — and the claim above was
   * made for the web.
   *
   * The row used to be written twice: once to claim the slot, and once
   * to record the delivery. The second write hit the unique index and
   * returned false — so the reminder was delivered, the user saw it,
   * and the sweep reported nothing.
   */
  return true;
}

/**
 * Collects and delivers every reminder that is due.
 */
export async function runReminderSweep(now: Date = new Date()): Promise<number> {
  let delivered = 0;

  /**
   * The user's own settings, read once per tick.
   *
   * The sweep runs every minute and walks every persona. The locale
   * and the time zone are the *user's*, not the persona's — so a user
   * with five personas was read five times, every minute, for ever.
   */
  const perUser = new Map<number, {
    locale: "zh" | "en";
    timezone: string | null;
  }>();

  try {
    const personas = await db.getAllPersonasForReminders();
    for (const persona of personas) {
      /**
       * One persona at a time.
       *
       * The try/catch used to wrap the whole loop, so one bad persona
       * meant the rest were skipped for that tick — and since the
       * anniversary is only ever delivered on its own day, their
       * anniversary was silently missed for the year.
       */
      try {
      /**
       * The anniversaries, and only the anniversaries.
       *
       * The whole memory list used to be read — up to two hundred
       * rows of every persona — once a minute, for ever, to look at
       * the handful of them that were anniversaries.
       */
      const anniversaries = await db.getAnniversaryMemories(persona.id, persona.userId);
      /**
       * The photos.
       *
       * Only the columns that are used, and only the photos. The whole
       * file table used to be read — with the extracted text, up to
       * half a megabyte each — once a minute, for ever, to look for a
       * date.
       */
      const files = await db.getPhotoReminderCandidates(persona.id, persona.userId);
      let settings = perUser.get(persona.userId);
      if (!settings) {
        settings = {
          locale: await db.getUserLocale(persona.userId).catch(() => "zh" as const),
          timezone: await db.getUserTimezone(persona.userId).catch(() => null),
        };
        perUser.set(persona.userId, settings);
      }
      const locale = settings.locale;
      /**
       * The *reader's* clock.
       *
       * The persona's own zone was used: the reminder is read by a
       * person, and the quiet hours are that person's decision about
       * when they want to be woken up. The persona's zone is the
       * persona's.
       */
      const timezone = settings.timezone;
      const reminders = collectReminders({
        locale,
        // The user's own calendar.
        timezone,
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
        anniversaries: anniversaries.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.date,
        })),
        photos: files.map((f) => ({
          id: f.id,
          originalName: f.originalName,
          dateHint: f.dateHint,
          createdAt: f.createdAt,
        })),
        now,
      });

        /**
         * The user's bindings, read once.
         *
         * They were read inside the loop over the reminders, so a user
         * with three reminders was read three times — on a timer that
         * runs every minute.
         */
        const bindings = await db.getChannelBindingsByUserId(persona.userId);

        /**
         * The bindings, in a fixed order.
         *
         * The order the rows came back in is the database's, not the
         * app's — so a user with the same persona bound on two channels
         * had the reminder go to one of them and then, on the next
         * tick, to the other. The choice is now the same every time.
         */
        const orderedBindings = [...bindings].sort((a, b) => {
          if (a.personaId !== b.personaId) return a.personaId - b.personaId;
          if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
          return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
        });

        for (const reminder of reminders) {
          // A reminder about 小A should not be pushed into the conversation
          // that is set up for 小B. Prefer the binding for this persona; fall
          // back to the web card rather than to the wrong conversation.
          const binding =
            orderedBindings.find((b) => b.isActive && b.personaId === reminder.personaId) ??
            null;

          const sent = await deliverReminder({
            userId: persona.userId,
            reminder,
            channel: binding?.channel ?? null,
            targetId: binding?.targetId ?? null,
            locale,
            timezone,
            now,
          });
          if (sent) delivered++;
        }
      } catch (e) {
        console.warn(
          `[Reminders] Persona ${persona.id} failed:`,
          (e as Error)?.message ?? e,
        );
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
