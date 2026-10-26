import { eq, desc, and, or, sql, count, sum, gte, ilike, asc, lt, lte, max, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes,
  chatSummaries, safetyEvents, graduationAssessments,
  channelBindings, channelStates, channelDefaultPersonas, personaTemplates, personaQuestionnaireAnswers,
  reminderDeliveries, researchProfiles, collectedMessages, collectionSources,
  collectionJobs,
  evalCases, evalRuns, outboundLetters,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
  InsertChatSummary, InsertSafetyEvent, InsertGraduationAssessment,
  InsertPersonaTemplate, InsertPersonaQuestionnaireAnswer,
  InsertResearchProfile, InsertCollectedMessage,
  InsertCollectionJob,
  InsertEvalCase, InsertEvalRun, InsertOutboundLetter,
  userMoods, relationshipEvents, letters, memoryExtractions,
  InsertUserMood, InsertRelationshipEvent, InsertLetter,
} from "../drizzle/schema";
import { BUILTIN_SCENE_DEFINITIONS } from "@shared/copy/scenes";
import { localDateKey, previousDateKey, zonedDateKey, zonedDayKeySince } from "@shared/timezone";
import { userDayColumn, userHourColumn } from "./_core/user-day";
import { dayShiftMinutes } from "@shared/timezone";

let _db: ReturnType<typeof drizzle> | null = null;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|econnrefused|etimedout|connection terminated|socket hang up|too many clients/.test(msg);
}

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
      return _db;
    } catch (error) {
      if (attempt < 2 && isTransientDbError(error)) {
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      return null;
    }
  }
  return null;
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (isTransientDbError(err) && attempt < maxRetries) {
        _db = null;
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Transient error, reconnecting in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * The transaction handle handed to `withTransaction` callbacks.
 */
export type DbTransaction = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0];

/**
 * Runs a set of writes inside a single database transaction.
 *
 * The transaction is wrapped in `withRetry`, so a transient connection
 * failure is retried with a fresh connection instead of failing the write.
 */
export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    return db.transaction(async (tx) => fn(tx));
  });
}

// ─── User helpers ───────────────────────────────────────────────────────────

export async function createUser(data: {
  username: string;
  passwordHash: string;
  name: string;
  /**
   * The account's role.
   *
   * The first account is the administrator's — it is called "admin" and
   * it is written to a credentials file. It was created with the
   * default role, so it was an ordinary account with a name that
   * promised something else.
   */
  role?: "user" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    role: data.role ?? "user",
    lastSignedIn: new Date(),
  }).returning({ id: users.id });
  return result.id;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

export async function updateUserProfile(
  id: number,
  data: {
    name?: string;
    /**
     * The address, or `null` to take it away.
     *
     * `undefined` means "leave it alone" — so an empty field cannot
     * clear the address unless the caller says `null` explicitly.
     */
    email?: string | null;
    timezone?: string | null;
    addressStyle?: string | null;
    boundaries?: string | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, id));
}

// ─── The persona reaching out first ─────────────────────────────────────────

/**
 * The personas that may speak first.
 *
 * Only the ones whose user asked for it: the frequency is not zero.
 */
export async function getProactivePersonas() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personas.id,
    userId: personas.userId,
    name: personas.name,
    lastChatAt: personas.lastChatAt,
    presence: personas.presence,
    graduationStatus: personas.graduationStatus,
    proactiveFrequencyHours: personas.proactiveFrequencyHours,
  }).from(personas)
    .where(sql`${personas.proactiveFrequencyHours} > 0`);
}

// ─── Letters ────────────────────────────────────────────────────────────────

/**
 * Writes a letter.
 *
 * "private" is kept and never answered; "waiting" is delivered, and the
 * reply lands later.
 */
/**
 * Writes a letter, and the message that carries it, together.
 *
 * The two are one thing: a letter that is in the letters table but not
 * in the conversation is answered by the persona and never seen by the
 * user. They were two writes with nothing between them, so a failure
 * in the middle left the letter delivered with no message in the thread
 * — and the reply could never be regenerated, because the letter was
 * already answered.
 */
export async function createLetterWithMessage(
  letter: InsertLetter,
  message: {
    personaId: number;
    userId: number;
    content: string;
    channel?: "web" | "wechat" | "feishu";
    origin?: string;
  },
): Promise<typeof letters.$inferSelect> {
  return withTransaction(async (tx) => {
    const [row] = await tx.insert(letters).values(letter).returning();
    await tx.insert(messages).values({
      personaId: message.personaId,
      userId: message.userId,
      role: "user",
      content: message.content,
      emotionalState: null,
      channel: message.channel ?? "web",
      origin: message.origin ?? "letter",
    });
    return row;
  });
}

export async function createLetter(params: {
  userId: number;
  personaId: number;
  body: string;
  mood?: string | null;
  status: "private" | "waiting";
  /** "letter" is written to the persona; "todo" is kept for later. */
  kind?: "letter" | "todo";
  replyAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(letters)
    .values({
      userId: params.userId,
      personaId: params.personaId,
      body: params.body,
      kind: params.kind ?? "letter",
      mood: params.mood ?? null,
      status: params.status,
      replyAt: params.replyAt ?? null,
      createdAt: new Date(),
    })
    .returning();
  return row ?? null;
}

/** The letters to a persona, newest first. */
/**
 * How many letters there are.
 *
 * The box showed the newest fifty and said nothing about the rest, so
 * the fifty-first simply disappeared from the screen while it was still
 * in the export. The number is what tells the user that.
 */
export async function countLetters(personaId: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(letters)
    .where(and(eq(letters.personaId, personaId), eq(letters.userId, userId)));
  return Number(row?.value ?? 0);
}

export async function getLetters(personaId: number, userId: number, limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(letters)
    .where(and(eq(letters.personaId, personaId), eq(letters.userId, userId)))
    .orderBy(desc(letters.createdAt))
    .limit(limit);
}

/**
 * The notes the user kept for later.
 *
 * 「等 TA 回来再说」 — the things to say when the two of them are in
 * touch again. They are surfaced when the user comes back, not pushed
 * out of the blue.
 */
export async function getWaitingNotes(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "todo"),
    ))
    .orderBy(desc(letters.createdAt))
    .limit(20);
}

/** Pushes a letter's reply further out. */
export async function deferLetter(id: number, userId: number, replyAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set({ replyAt })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning();
  return row ?? null;
}

/** The letters whose reply is due, across every user. */
/**
 * How long a claim on a letter is taken to belong to a process that is
 * no longer running.
 *
 * The answer takes a model call, and a model call is allowed two
 * minutes — three times over, with the retries between them. So the
 * window has to be longer than the worst case, not the typical one: at
 * five minutes the claim went stale *while the first answer was still
 * being written*, so the next sweep claimed the same letter and
 * answered it again — the second answer overwrote the first, and the
 * conversation got both.
 *
 * Fifteen minutes is comfortably longer than the worst case.
 */
export const LETTER_CLAIM_STALE_MS = 15 * 60_000;

export async function getDueLetters(now: Date, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The letters that are due, and that nobody is answering right now.
   *
   * A letter that a sweep has claimed is skipped — until the claim has
   * gone stale, which means the process that took it is gone.
   */
  const staleBefore = new Date(now.getTime() - LETTER_CLAIM_STALE_MS);
  return db.select().from(letters)
    .where(and(
      eq(letters.status, "waiting"),
      lte(letters.replyAt, now),
      or(
        isNull(letters.claimedAt),
        lt(letters.claimedAt, staleBefore),
      ),
    ))
    .orderBy(asc(letters.replyAt))
    .limit(limit);
}

/** The last answer given to a persona, for the reply gap. */
export async function getLastLetterReplyAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ repliedAt: letters.repliedAt }).from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.status, "answered"),
    ))
    .orderBy(desc(letters.repliedAt))
    .limit(1);
  return rows[0]?.repliedAt ?? null;
}

/** Records the answer to a letter. */
/**
 * Writes the answer into a letter.
 *
 * The claim — `claimLetter` — is what keeps two sweeps from both
 * answering the same letter. This only fills in the text of a letter
 * that has already been claimed.
 */
/**
 * Writes the answer to a letter, and the message that carries it,
 * together.
 *
 * The two are one thing: a reply that lives only in a list is a
 * notification; one that lands in the thread is a reply. They were
 * two writes with nothing between them, so a failure in the middle
 * left the answer in the list and never in the conversation — and the
 * letter was already answered, so it could never be regenerated.
 */
export async function answerLetterWithMessage(
  id: number,
  userId: number,
  replyText: string,
  repliedAt: Date,
  message: {
    personaId: number;
    content: string;
    emotionalState: string | null;
    channel?: "web" | "wechat" | "feishu";
  },
): Promise<boolean> {
  return withTransaction(async (tx) => {
    /**
     * Only a letter that is still waiting.
     *
     * The write used to take any letter — so a second sweep, which had
     * claimed the letter because the first claim had gone stale,
     * overwrote the first answer's text *and* inserted a second
     * message into the conversation. The user saw two replies to the
     * same letter in the thread, and only the second one in the box.
     */
    const [row] = await tx.update(letters)
      .set({ status: "answered", replyText, repliedAt, claimedAt: null })
      .where(and(
        eq(letters.id, id),
        eq(letters.userId, userId),
        eq(letters.status, "waiting"),
      ))
      .returning({ id: letters.id });
    if (!row) return false;
    await tx.insert(messages).values({
      personaId: message.personaId,
      userId,
      role: "assistant",
      content: message.content,
      emotionalState: message.emotionalState,
      channel: message.channel ?? "web",
      // It is the answer to a letter. Without the marker it was just
      // another message, and the connection to the letter was gone.
      origin: "letter",
    });
    return true;
  });
}

export async function answerLetter(
  id: number,
  userId: number,
  replyText: string,
  repliedAt: Date = new Date(),
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set({ status: "answered", replyText, repliedAt, claimedAt: null })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Claims a letter for answering, before the answer is written.
 *
 * The answer takes a model call, so the claim has to happen first: two
 * sweeps that overlap would otherwise both write an answer.
 */
export async function claimLetter(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * The claim.
   *
   * The letter stays "waiting": it is only answered when the answer
   * has been written. It used to be marked "answered" with an empty
   * reply before the model call, so that nothing could answer it
   * twice — but then a process that stopped during the call left it
   * answered with nothing in it, for ever, because only "waiting"
   * letters are picked up.
   *
   * A claim that has gone stale belongs to a process that is gone, so
   * the letter is claimed again.
   */
  const staleBefore = new Date(Date.now() - LETTER_CLAIM_STALE_MS);
  const [row] = await db.update(letters)
    .set({ claimedAt: new Date() })
    .where(and(
      eq(letters.id, id),
      eq(letters.userId, userId),
      eq(letters.status, "waiting"),
      or(
        isNull(letters.claimedAt),
        lt(letters.claimedAt, staleBefore),
      ),
    ))
    .returning({ id: letters.id });
  return Boolean(row);
}

/**
 * Gives a letter back, so that it can be answered again.
 *
 * It is called when the answer could not be written — the model call
 * failed, or the database did. Without it, the letter would stay
 * claimed for five minutes for nothing.
 */
export async function releaseLetterClaim(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(letters)
    .set({ claimedAt: null })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)));
}

/** Marks a letter as answered with nothing — the persona stayed quiet. */
/**
 * A letter the persona could not answer.
 *
 * It used to set the letter back to "private" — the status of a letter
 * that was *kept* and never sent. But the letter had been delivered: it
 * was in the conversation as the user's own message, written
 * atomically with the row. So one provider hiccup turned a delivered
 * letter into a kept one, the interface showed the "kept" badge, and
 * `replyAt: null` meant the sweep never picked it up again — the reply
 * never came and the app said the letter had never been sent.
 *
 * The letter keeps its "waiting" status, and the attempt is put back
 * an hour later — so it is tried again, and the user is not told a
 * lie.
 */
export async function markLetterUnanswered(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set({
      status: "waiting",
      replyAt: new Date(Date.now() + LETTER_RETRY_AFTER_MS),
      claimedAt: null,
    })
    .where(and(
      eq(letters.id, id),
      eq(letters.userId, userId),
      // Only a letter that is still waiting — one that has been
      // answered keeps its answer.
      eq(letters.status, "waiting"),
    ))
    .returning();
  return row ?? null;
}

/**
 * How long a letter waits before it is tried again.
 *
 * Long enough not to hammer a provider that is having a bad minute,
 * short enough that the reply still arrives while the user cares.
 */
export const LETTER_RETRY_AFTER_MS = 60 * 60_000;

export async function deleteLetter(id: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  const deleted = await db.delete(letters)
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning({ id: letters.id });
  return deleted.length > 0;
}

// ─── The user's own side ────────────────────────────────────────────────────

/**
 * Records how the user is doing today.
 *
 * One entry per day: checking in again replaces it, because the point is
 * that recording is cheap enough to do every day.
 */
export async function upsertUserMood(params: {
  userId: number;
  date: string;
  mood: string;
  note?: string | null;
  source?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const [row] = await db.insert(userMoods)
    .values({
      userId: params.userId,
      date: params.date,
      mood: params.mood,
      note: params.note ?? null,
      source: params.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userMoods.userId, userMoods.date],
      set: {
        mood: params.mood,
        note: params.note ?? null,
        source: params.source ?? "manual",
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

/**
 * The messages the user sent to one persona since a point in time.
 *
 * The emotion snapshot belongs to a persona, so its count has to be that
 * persona's messages — not the user's across every conversation.
 */
export async function getUserMessageCountForPersonaSince(
  personaId: number,
  userId: number,
  since: Date,
) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  return result?.c || 0;
}

/** The user's own moods, oldest first. */
export async function getUserMoods(
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window is applied to the *day* of the mood.
   *
   * It was applied to `createdAt` — when the row was written. So a
   * mood recorded today for a day three weeks ago was inside a "last
   * thirty days" chart although its day was outside it, and a mood
   * recorded yesterday for today was outside a "last seven days" chart
   * although its day was inside it. The chart plots the day.
   *
   * The window is in the user's own calendar too, so the days it names
   * are the days the moods are filed under.
   */
  const since = zonedDayKeySince(days, timezone);
  return db.select().from(userMoods)
    .where(and(eq(userMoods.userId, userId), gte(userMoods.date, since)))
    .orderBy(asc(userMoods.date));
}

/**
 * The user's most recent mood.
 *
 * A mood from three days ago is not a mood any more, so only the last
 * couple of days count.
 */
export async function getRecentUserMood(userId: number, maxAgeDays = 2) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userMoods)
    .where(eq(userMoods.userId, userId))
    .orderBy(desc(userMoods.date))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - new Date(row.date).getTime();
  if (age > maxAgeDays * 86_400_000) return null;
  return row;
}

/**
 * Records something that actually happened in the relationship.
 *
 * The events are the user's own record of their own life. The app does not
 * guess them: guessing would mean inventing a relationship the user did
 * not have.
 */
export async function createRelationshipEvent(params: {
  userId: number;
  personaId: number;
  kind: string;
  title: string;
  detail?: string | null;
  happenedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(relationshipEvents)
    .values({
      userId: params.userId,
      personaId: params.personaId,
      kind: params.kind,
      title: params.title,
      detail: params.detail ?? null,
      happenedAt: params.happenedAt ?? new Date(),
      recordedAt: new Date(),
    })
    .returning();
  return row ?? null;
}

/** What happened in the relationship, most recent first. */
export async function getRelationshipEvents(
  personaId: number,
  userId: number,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(relationshipEvents)
    .where(and(
      eq(relationshipEvents.personaId, personaId),
      eq(relationshipEvents.userId, userId),
    ))
    .orderBy(desc(relationshipEvents.happenedAt))
    .limit(limit);
}

export async function deleteRelationshipEvent(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const deleted = await db.delete(relationshipEvents)
    .where(and(eq(relationshipEvents.id, id), eq(relationshipEvents.userId, userId)))
    .returning({ id: relationshipEvents.id });
  return deleted.length > 0;
}

/**
 * The user's own time zone.
 *
 * A single column read, because the chat pipeline needs it on every turn
 * and the full user row is more than it needs.
 */
/**
 * The language the user reads.
 *
 * The interface sends it on every request, but the things the app sends
 * on its own — a reminder at midnight, a reply in a chat window — have to
 * know it without being asked, so it is kept here.
 */
export async function getUserLocale(userId: number): Promise<"zh" | "en"> {
  const db = await getDb();
  if (!db) return "zh";
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  return row?.locale === "en" ? "en" : "zh";
}

/** Remembers the language the user reads. */
export async function setUserLocale(userId: number, locale: "zh" | "en"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

export async function getUserTimezone(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ timezone: users.timezone }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return rows[0]?.timezone ?? null;
}

/**
 * Sets whether the app may read the user's own messages to assess their
 * emotional trajectory.
 */
export async function updateUserTrajectoryAssessment(id: number, setting: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ trajectoryAssessment: setting }).where(eq(users.id, id));
}

/**
 * Sets the instance-wide default for the graduation mechanism.
 *
 * The value is stored as written; the callers only ever pass one of the
 * three known modes.
 */
export async function updateUserGraduationMode(id: number, mode: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ graduationMode: mode }).where(eq(users.id, id));
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/**
 * Bumps the user's token version, retiring every session that was issued
 * before the bump. Used on logout and after a password change.
 */
export async function bumpUserTokenVersion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, id));
}

/**
 * Deletes every row belonging to a user, in one transaction.
 *
 * The list covers every user-scoped table in the schema — there are no
 * foreign keys to cascade, so a table left out here would keep orphaned rows
 * behind after the account is gone. `server/db-migrations.test.ts` asserts
 * that this list stays in step with the schema.
 */
export async function deleteUserAccount(id: number) {
  await withTransaction(async (tx) => {
    await tx.delete(channelBindings).where(eq(channelBindings.userId, id));
    await tx.delete(channelDefaultPersonas).where(eq(channelDefaultPersonas.userId, id));
    await tx.delete(channelStates).where(eq(channelStates.userId, id));
    await tx.delete(chatSummaries).where(eq(chatSummaries.userId, id));
    await tx.delete(collectedMessages).where(eq(collectedMessages.userId, id));
    await tx.delete(collectionJobs).where(eq(collectionJobs.userId, id));
    await tx.delete(collectionSources).where(eq(collectionSources.userId, id));
    await tx.delete(diaryEntries).where(eq(diaryEntries.userId, id));
    await tx.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
    await tx.delete(evalCases).where(eq(evalCases.userId, id));
    await tx.delete(evalRuns).where(eq(evalRuns.userId, id));
    await tx.delete(graduationAssessments).where(eq(graduationAssessments.userId, id));
    await tx.delete(llmConfigs).where(eq(llmConfigs.userId, id));
    await tx.delete(letters).where(eq(letters.userId, id));
    await tx.delete(memories).where(eq(memories.userId, id));
    await tx.delete(memoryExtractions).where(eq(memoryExtractions.userId, id));
    await tx.delete(messages).where(eq(messages.userId, id));
    await tx.delete(outboundLetters).where(eq(outboundLetters.userId, id));
    await tx.delete(personaFiles).where(eq(personaFiles.userId, id));
    await tx.delete(personaQuestionnaireAnswers).where(eq(personaQuestionnaireAnswers.userId, id));
    await tx.delete(personaTemplates).where(eq(personaTemplates.userId, id));
    await tx.delete(relationshipEvents).where(eq(relationshipEvents.userId, id));
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, id));
    await tx.delete(researchProfiles).where(eq(researchProfiles.userId, id));
    await tx.delete(safetyEvents).where(eq(safetyEvents.userId, id));
    await tx.delete(scenes).where(eq(scenes.userId, id));
    await tx.delete(skillJobs).where(eq(skillJobs.userId, id));
    await tx.delete(userMoods).where(eq(userMoods.userId, id));
    await tx.delete(wechatBindings).where(eq(wechatBindings.userId, id));
    await tx.delete(wechatBotState).where(eq(wechatBotState.userId, id));
    await tx.delete(personas).where(eq(personas.userId, id));
    await tx.delete(users).where(eq(users.id, id));
  });
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, totalMessages: 0, totalFiles: 0, storageUsed: 0 };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.userId, userId));
  const [fileCount] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [fileSize] = await db.select({ s: sum(personaFiles.fileSize) }).from(personaFiles).where(eq(personaFiles.userId, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    totalMessages: msgCount?.c || 0,
    totalFiles: fileCount?.c || 0,
    storageUsed: Number(fileSize?.s) || 0,
  };
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({ username: users.username, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId));
  const personaList = await db.select().from(personas).where(eq(personas.userId, userId));
  // Bounded: the bundle is serialised into one string in memory, and an
  // unbounded query is an out-of-memory crash for the whole server.
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId))
    .orderBy(messages.createdAt).limit(50_000);
  return { user, personas: personaList, messages: messageList };
}

// ─── Persona helpers ────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personas).values(data).returning({ id: personas.id });
  return result.id;
}

export async function getPersonasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
}

/**
 * The user's personas, with the little the lobby shows about each.
 *
 * The three numbers used to be asked for one persona at a time — so
 * the lobby, which is the first screen of the app, made one round trip
 * per persona plus three. Four queries do the same work.
 */
export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);

  // The newest message of each persona.
  const lastMessages = await db
    .selectDistinct({
      personaId: messages.personaId,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(
      eq(messages.userId, userId),
      inArray(messages.personaId, ids),
    ))
    .orderBy(desc(messages.createdAt));

  // The number of files of each persona.
  const fileCounts = await db.select({
    personaId: personaFiles.personaId,
    c: count(),
  })
    .from(personaFiles)
    .where(and(
      eq(personaFiles.userId, userId),
      inArray(personaFiles.personaId, ids),
    ))
    .groupBy(personaFiles.personaId);

  // Whether each persona is bound to a WeChat conversation.
  const bindings = await db.select({
    personaId: wechatBindings.personaId,
    c: count(),
  })
    .from(wechatBindings)
    .where(and(
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
      inArray(wechatBindings.personaId, ids),
    ))
    .groupBy(wechatBindings.personaId);

  const lastByPersona = new Map<number, { content: string; createdAt: Date }>();
  for (const row of lastMessages) {
    if (lastByPersona.has(row.personaId)) continue;
    lastByPersona.set(row.personaId, {
      content: (row.content || "").slice(0, 60),
      createdAt: row.createdAt,
    });
  }
  const filesByPersona = new Map(fileCounts.map((r) => [r.personaId, Number(r.c)]));
  const bindingsByPersona = new Map(bindings.map((r) => [r.personaId, Number(r.c)]));

  return list.map((p) => ({
    ...p,
    lastMessage: lastByPersona.get(p.id) ?? null,
    fileCount: filesByPersona.get(p.id) ?? 0,
    wechatBound: (bindingsByPersona.get(p.id) ?? 0) > 0,
  }));
}

export async function getUserStats(userId: number, timezone?: string | null) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  /**
   * The user's midnight.
   *
   * It was the server's — so "today's chats" on the lobby counted the
   * wrong day for anybody who was not on the server's clock. It also
   * gates the "five conversations in a day" achievement, so the
   * achievement could be won with yesterday's conversations.
   */
  const today = new Date();
  const shift = dayShiftMinutes(timezone);
  today.setMinutes(today.getMinutes() + shift);
  today.setHours(0, 0, 0, 0);
  today.setMinutes(today.getMinutes() - shift);
  const [todayCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, today)));
  const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    todayChats: todayCount?.c || 0,
    memberSince: userRow?.createdAt || new Date(),
  };
}

export async function getRecentActivity(userId: number, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messages.id,
    personaId: messages.personaId,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
    personaName: personas.name,
    emotionalState: personas.emotionalState,
  })
    .from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map(r => ({
    ...r,
    content: (r.content || "").slice(0, 80),
  }));
}

export async function getPersonaById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  return result[0];
}

/**
 * Adds one to a persona's chat count.
 *
 * The count used to be read at the start of the turn and written back
 * as an absolute number — so two turns that overlapped both read N and
 * both wrote N+1, and one turn was never counted. The count is a gate
 * on the graduation, so a persona could reach the ritual with fewer
 * conversations than it had.
 *
 * The increment is done by the database, so it cannot be lost.
 */
export async function incrementChatCount(id: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .update(personas)
    .set({ chatCount: sql`"chatCount" + 1` })
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .returning({ chatCount: personas.chatCount });
  return rows[0]?.chatCount ?? 0;
}

export async function updatePersona(id: number, userId: number, data: Partial<InsertPersona>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(personas).set(data).where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

/**
 * Deletes a persona and everything that hangs off it, in one transaction.
 *
 * Ownership is checked *before* anything is deleted. The row deletes are
 * scoped to the persona's owner as well as the persona itself, so a caller
 * who guessed another user's persona id cannot wipe their history — and
 * cannot even delete the rows that belong to it.
 *
 * Covers every table with a `personaId` — the same completeness rule as
 * `deleteUserAccount`, and checked by `server/db-delete-coverage.test.ts`.
 */
export async function deletePersona(id: number, userId: number) {
  // The ownership check comes first: without it, a caller who passed
  // somebody else's persona id would still delete that persona's messages
  // and memories.
  const owned = await getPersonaById(id, userId);
  if (!owned) throw new Error("Persona not found");

  await withTransaction(async (tx) => {
    await tx.delete(channelBindings).where(and(eq(channelBindings.personaId, id), eq(channelBindings.userId, userId)));
    await tx.delete(channelDefaultPersonas).where(and(eq(channelDefaultPersonas.personaId, id), eq(channelDefaultPersonas.userId, userId)));
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.personaId, id), eq(chatSummaries.userId, userId)));
    await tx.delete(collectedMessages).where(and(eq(collectedMessages.personaId, id), eq(collectedMessages.userId, userId)));
    await tx.delete(collectionJobs).where(and(eq(collectionJobs.personaId, id), eq(collectionJobs.userId, userId)));
    await tx.delete(diaryEntries).where(and(eq(diaryEntries.personaId, id), eq(diaryEntries.userId, userId)));
    await tx.delete(emotionSnapshots).where(and(eq(emotionSnapshots.personaId, id), eq(emotionSnapshots.userId, userId)));
    await tx.delete(evalCases).where(and(eq(evalCases.personaId, id), eq(evalCases.userId, userId)));
    await tx.delete(evalRuns).where(and(eq(evalRuns.personaId, id), eq(evalRuns.userId, userId)));
    await tx.delete(graduationAssessments).where(and(eq(graduationAssessments.personaId, id), eq(graduationAssessments.userId, userId)));
    await tx.delete(memories).where(and(eq(memories.personaId, id), eq(memories.userId, userId)));
    await tx.delete(memoryExtractions).where(and(eq(memoryExtractions.personaId, id), eq(memoryExtractions.userId, userId)));
    await tx.delete(messages).where(and(eq(messages.personaId, id), eq(messages.userId, userId)));
    await tx.delete(outboundLetters).where(and(eq(outboundLetters.personaId, id), eq(outboundLetters.userId, userId)));
    await tx.delete(personaFiles).where(and(eq(personaFiles.personaId, id), eq(personaFiles.userId, userId)));
    await tx.delete(personaQuestionnaireAnswers).where(and(eq(personaQuestionnaireAnswers.personaId, id), eq(personaQuestionnaireAnswers.userId, userId)));
    await tx.delete(relationshipEvents).where(and(eq(relationshipEvents.personaId, id), eq(relationshipEvents.userId, userId)));
    await tx.delete(reminderDeliveries).where(and(eq(reminderDeliveries.personaId, id), eq(reminderDeliveries.userId, userId)));
    await tx.delete(researchProfiles).where(and(eq(researchProfiles.personaId, id), eq(researchProfiles.userId, userId)));
    await tx.delete(safetyEvents).where(and(eq(safetyEvents.personaId, id), eq(safetyEvents.userId, userId)));
    await tx.delete(skillJobs).where(and(eq(skillJobs.personaId, id), eq(skillJobs.userId, userId)));
    await tx.delete(letters).where(and(eq(letters.personaId, id), eq(letters.userId, userId)));
    await tx.delete(wechatBindings).where(and(eq(wechatBindings.personaId, id), eq(wechatBindings.userId, userId)));
    await tx.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
  });
}

// ─── PersonaFile helpers ────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data).returning({ id: personaFiles.id });
  return result.id;
}

/**
 * The newest uploaded files, with only what the retrieval needs.
 *
 * The full-text column of an uploaded chat log is megabytes long, and
 * the hot path pulled all of it — for every file of the persona, on
 * every chat turn — of which two summaries of four hundred characters
 * were used.
 */
export async function getFileSummariesByPersonaId(
  personaId: number,
  userId: number,
  limit = 20,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
    extractedMemory: personaFiles.extractedMemory,
    createdAt: personaFiles.createdAt,
  })
    .from(personaFiles)
    .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
    .orderBy(desc(personaFiles.createdAt))
    .limit(limit);
}

/**
 * The photos of a persona, and the date each of them was taken.
 *
 * The sweep runs once a minute, and it used to read every uploaded file
 * in full — the extracted text is up to half a megabyte each — only to
 * look for a date. So the whole table was read every minute, for ever,
 * and the answer was thrown away.
 *
 * The date is now found by the database, and only the columns that are
 * used come back.
 */
export async function getPhotoReminderCandidates(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
    createdAt: personaFiles.createdAt,
    // The first date in the extracted text, if there is one.
    dateHint: sql<string | null>`substring(${personaFiles.extractedMemory} from '[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}-[0-9]{2}')`,
  })
    .from(personaFiles)
    .where(and(
      eq(personaFiles.personaId, personaId),
      eq(personaFiles.userId, userId),
      eq(personaFiles.fileType, "image"),
    ))
    .orderBy(desc(personaFiles.createdAt));
}

/**
 * The titles of the files whose summaries were recalled.
 *
 * A file summary carries a negative id — it lives in another table, and
 * the negative id is what keeps the two apart. So the memories table
 * has no row for it, and the title was empty.
 */
export async function getFileSummaryTitles(ids: number[], userId: number) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, string>();
  const unique = Array.from(new Set(ids));
  const rows = await db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
  })
    .from(personaFiles)
    .where(and(inArray(personaFiles.id, unique), eq(personaFiles.userId, userId)));
  return new Map(rows.map((r) => [r.id, r.originalName]));
}

/**
 * Whether a message of this user's points at a given file.
 *
 * The files written before the TTS output was scoped per user have no
 * owner in their path, so the path cannot say whose they are. Their
 * names are the hash of the text they were made from, so two people
 * who asked for the same words share one file — and every signed-in
 * user could fetch it.
 *
 * So the file is served to the people whose own conversation points at
 * it, and to nobody else.
 */
export async function userHasMessageWithMediaUrl(
  userId: number,
  mediaUrl: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.mediaUrl, mediaUrl)))
    .limit(1);
  return rows.length > 0;
}

/**
 * One file, by its id.
 *
 * Scoped by the owner, so a file id that was guessed reaches nothing.
 */
export async function getPersonaFileById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(personaFiles)
    .where(and(eq(personaFiles.id, id), eq(personaFiles.userId, userId)))
    .limit(1);
  return rows[0];
}

/**
 * A file, as the list of the files of a persona returns it.
 */
export type PersonaFileRow = Omit<
  typeof personaFiles.$inferSelect,
  "extractedMemory"
> & { extractedMemory?: string | null };

/**
 * The files of a persona, newest first.
 *
 * The extracted text is not part of the answer unless it is asked for.
 * It is up to half a million characters per file, and the list of the
 * files is shown on a page that never reads it — so every visit pulled
 * megabytes of chat-log text to the browser and threw it away.
 */
export async function getFilesByPersonaId(
  personaId: number,
  userId: number,
  options: { withExtractedMemory?: boolean } = {},
): Promise<Array<PersonaFileRow>> {
  const db = await getDb();
  if (!db) return [];
  const columns = {
    id: personaFiles.id,
    personaId: personaFiles.personaId,
    userId: personaFiles.userId,
    fileType: personaFiles.fileType,
    originalName: personaFiles.originalName,
    fileKey: personaFiles.fileKey,
    fileUrl: personaFiles.fileUrl,
    fileSize: personaFiles.fileSize,
    processStatus: personaFiles.processStatus,
    createdAt: personaFiles.createdAt,
  };
  /**
   * The extracted text is read only when it is asked for.
   *
   * The column is left out of the select otherwise — so the text is
   * never brought back from the database at all, rather than being
   * brought back and thrown away.
   */
  const rows = options.withExtractedMemory
    ? await db.select({ ...columns, extractedMemory: personaFiles.extractedMemory })
        .from(personaFiles)
        .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
        .orderBy(desc(personaFiles.createdAt))
    : await db.select(columns)
        .from(personaFiles)
        .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
        .orderBy(desc(personaFiles.createdAt));
  return rows;
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(messages).values(data).returning({ id: messages.id });
  return result.id;
}

/**
 * Records which channel a message went out on.
 *
 * The message is stored before it is sent, so that a failure to store
 * it cannot leave the user with a message that was sent but never
 * counted — and the clock that stops the persona from speaking again
 * starts with the same write.
 */
export async function updateMessageChannel(
  id: number,
  userId: number,
  channel: "web" | "wechat" | "feishu",
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(messages)
    .set({ channel })
    .where(and(eq(messages.id, id), eq(messages.userId, userId)));
}

export async function getMessagesByPersonaId(personaId: number, userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

/**
 * A single message, if it belongs to the user.
 */
/**
 * One message, by its id.
 *
 * The persona may be named, and then the message has to be in that
 * conversation: a reply that quotes a message of another persona of
 * the same user quotes the wrong conversation.
 */
export async function getMessageById(
  messageId: number,
  userId: number,
  personaId?: number,
) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messages)
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The messages before a given one, oldest first.
 *
 * The chat page used to load the last fifty messages and stop there, so
 * a long conversation simply had no beginning. Everything was in the
 * database; there was no way to reach it.
 */
export async function getMessagesBefore(
  personaId: number,
  userId: number,
  beforeId: number,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      lt(messages.id, beforeId),
    ))
    .orderBy(desc(messages.id)).limit(limit);
  return rows.reverse();
}

/** Whether there are older messages to load. */
export async function hasOlderMessages(
  personaId: number,
  userId: number,
  beforeId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: messages.id }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      lt(messages.id, beforeId),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Deletes every message of a conversation.
 *
 * The count of conversations goes back to zero with them.
 *
 * It used to stay, so the lobby's "total chats" counted conversations
 * the user had just thrown away — and so did the gate on the
 * graduation, which counts the conversations of the relationship.
 */
export async function clearMessagesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.transaction(async (tx) => {
    await tx.delete(messages)
      .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
    await tx.update(personas)
      .set({ chatCount: 0 })
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  });
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  // The wildcards are escaped, so a search for "50%" does not match
  // everything that contains a digit.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${escaped}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

/**
 * Searches across every persona the user has.
 *
 * A person looking for something they said six months ago does not
 * remember which conversation it was in — and the thing they are
 * looking for is often a memory or a diary entry rather than a message.
 */
export async function searchAllMessages(
  userId: number,
  query: string,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  const [messageRows, memoryRows, diaryRows] = await Promise.all([
    db.select({
      id: messages.id,
      personaId: messages.personaId,
      kind: sql<string>`'message'`,
      role: messages.role,
      title: sql<string>`NULL`,
      content: messages.content,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(eq(messages.userId, userId), ilike(messages.content, pattern)))
      .orderBy(desc(messages.createdAt))
      .limit(limit),

    db.select({
      id: memories.id,
      personaId: memories.personaId,
      kind: sql<string>`'memory'`,
      role: sql<string>`'assistant'`,
      title: memories.title,
      content: sql<string>`COALESCE(${memories.description}, '')`,
      createdAt: memories.createdAt,
    }).from(memories)
      .where(and(
        eq(memories.userId, userId),
        or(
          ilike(memories.title, pattern),
          ilike(sql`COALESCE(${memories.description}, '')`, pattern),
        ),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(limit),

    db.select({
      id: diaryEntries.id,
      personaId: diaryEntries.personaId,
      kind: sql<string>`'diary'`,
      role: sql<string>`'assistant'`,
      title: sql<string>`NULL`,
      content: diaryEntries.summary,
      createdAt: diaryEntries.createdAt,
    }).from(diaryEntries)
      .where(and(
        eq(diaryEntries.userId, userId),
        or(
          ilike(diaryEntries.summary, pattern),
          ilike(sql`COALESCE(${diaryEntries.reflection}, '')`, pattern),
        ),
      ))
      .orderBy(desc(diaryEntries.createdAt))
      .limit(limit),
  ]);

  return [...messageRows, ...memoryRows, ...diaryRows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

// ─── WeChat Binding helpers ─────────────────────────────────────────────────

export async function createWechatBinding(data: InsertWechatBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(wechatBindings).values(data).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding({
    userId: data.userId,
    wechatUserId: data.wechatUserId,
    personaId: data.personaId,
    wechatName: data.wechatName ?? null,
  });
  return result.id;
}

export async function getWechatBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(eq(wechatBindings.userId, userId));
}

/**
 * Finds the default persona binding for a WeChat conversation.
 *
 * `wechatUserId` is the iLink conversation counterpart id — in the official
 * ClawBot model this is the account owner's own Weixin id.
 */
export async function getWechatBindingByUserId(wechatUserId: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(
      eq(wechatBindings.wechatUserId, wechatUserId),
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
    )).limit(1);
  return result[0];
}

/**
 * Sets the default persona for a WeChat conversation, replacing any existing
 * binding for the same (user, wechatUserId) pair.
 */
export async function setWechatBindingPersona(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(wechatBindings).where(and(
    eq(wechatBindings.wechatUserId, params.wechatUserId),
    eq(wechatBindings.userId, params.userId),
  )).limit(1);

  if (existing[0]) {
    await db.update(wechatBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { wechatName: params.wechatName } : {}),
    }).where(eq(wechatBindings.id, existing[0].id));
    await syncWechatChannelBinding(params);
    return existing[0].id;
  }

  const [result] = await db.insert(wechatBindings).values({
    userId: params.userId,
    wechatUserId: params.wechatUserId,
    personaId: params.personaId,
    wechatName: params.wechatName ?? null,
    isActive: true,
  }).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding(params);
  return result.id;
}

/**
 * Mirrors a WeChat binding into the channel-neutral table.
 *
 * The WeChat channel keeps its own table for one more release, but the
 * reminder scheduler and the Feishu adapter work in channel-neutral terms —
 * they read `channel_bindings`. Without this mirror a WeChat account bound
 * after the channel layer landed would never receive a channel reminder.
 */
async function syncWechatChannelBinding(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, "wechat"),
    eq(channelBindings.targetId, params.wechatUserId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { targetName: params.wechatName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return;
  }

  await db.insert(channelBindings).values({
    userId: params.userId,
    channel: "wechat",
    targetId: params.wechatUserId,
    targetName: params.wechatName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).onConflictDoNothing();
}

/**
 * Removes a WeChat binding.
 *
 * It says whether a row was actually removed: the delete is scoped to
 * the owner, so a row that does not exist — or belongs to somebody
 * else — is silently not removed, and the caller used to report that
 * as a success.
 */
export async function deleteWechatBinding(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(wechatBindings)
    .where(and(eq(wechatBindings.id, id), eq(wechatBindings.userId, userId)))
    .returning({ id: wechatBindings.id, wechatUserId: wechatBindings.wechatUserId });
  /**
   * The mirror goes with it.
   *
   * Every WeChat binding also has a row in `channel_bindings` — and
   * that is the row the scheduler reads. So unbinding in the settings
   * removed the row from the WeChat tab, and the anniversary reminders
   * and the proactive messages kept being pushed into the very
   * conversation the user had just unbound.
   */
  for (const row of rows) {
    await db.delete(channelBindings).where(and(
      eq(channelBindings.userId, userId),
      eq(channelBindings.channel, "wechat"),
      eq(channelBindings.targetId, row.wechatUserId),
    ));
  }
  return rows.length > 0;
}

// ─── Skill Job helpers ──────────────────────────────────────────────────────

export async function createSkillJob(data: InsertSkillJob) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(skillJobs).values(data).returning({ id: skillJobs.id });
  return result.id;
}

export async function getSkillJobById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId))).limit(1);
  return result[0];
}

export async function updateSkillJob(
  id: number,
  userId: number,
  data: Partial<InsertSkillJob>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(skillJobs).set(data)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId)));
}

// ─── LLM Config helpers ────────────────────────────────────────────────────

export async function getLlmConfigsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmConfigs).where(eq(llmConfigs.userId, userId));
}

export async function upsertLlmConfig(userId: number, data: Partial<InsertLlmConfig> & { providerName: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, data.providerName))).limit(1);
  if (existing[0]) {
    await db.update(llmConfigs).set(data).where(eq(llmConfigs.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(llmConfigs).values({ userId, ...data }).returning({ id: llmConfigs.id });
  return result.id;
}

/**
 * Makes one of the user's provider configurations the default.
 *
 * The name is matched without regard to case: the provider names come
 * from the registry, where they are written "OpenAI", while a row the
 * user saved by hand can hold "openai". The old comparison was exact,
 * so a case difference matched nothing — and because the defaults were
 * cleared first, the user was left with *no* default provider at all.
 *
 * Returns false when the user has no row for that provider, so the
 * defaults are left alone rather than cleared for nothing.
 */
export async function setDefaultLlmConfig(userId: number, providerName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({
    id: llmConfigs.id,
    providerName: llmConfigs.providerName,
  }).from(llmConfigs).where(eq(llmConfigs.userId, userId));
  const wanted = rows.find(
    (row) => row.providerName.toLowerCase() === providerName.trim().toLowerCase(),
  );
  if (!wanted) return false;

  await withTransaction(async (tx) => {
    await tx.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
    await tx.update(llmConfigs).set({ isDefault: true }).where(eq(llmConfigs.id, wanted.id));
  });
  return true;
}

export async function getDefaultLlmConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  return rows[0] ?? null;
}

// ─── Daily Activity helpers ────────────────────────────────────────────────

export async function getDailyChatCounts(userId: number, days = 30, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  // The day a message belongs to is the user's day, not the server's.
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({
    date: day,
    count: count(),
  })
    .from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(day);
  return rows;
}

// ─── WeChat Bot State helpers ───────────────────────────────────────────────

export async function getWechatBotState(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  return result[0];
}

/** Lists the ids of all users, used to restore per-user channel state on boot. */
export async function getAllUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}

export type WechatBotStateUpdate = Partial<{
  status: string;
  qrCodeUrl: string | null;
  loggedInUser: string | null;
  lastError: string | null;
  botTokenEnc: string | null;
  accountId: string | null;
  baseUrl: string | null;
  wechatUserId: string | null;
  syncBuf: string | null;
  lastInboundAt: Date | null;
}>;

export async function upsertWechatBotState(userId: number, data: WechatBotStateUpdate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set(data as any).where(eq(wechatBotState.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(wechatBotState).values({ userId, ...data } as any).returning({ id: wechatBotState.id });
  return result.id;
}

/** Persists the long-poll cursor so restarts do not lose inbound messages. */
export async function saveWechatSyncBuf(userId: number, syncBuf: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set({ syncBuf }).where(eq(wechatBotState.id, existing[0].id));
    return;
  }
  await db.insert(wechatBotState).values({ userId, syncBuf } as any);
}

/** Records the timestamp of the last inbound message (24h keep-alive check). */
export async function touchWechatLastInbound(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set({ lastInboundAt: new Date() }).where(eq(wechatBotState.id, existing[0].id));
  }
}

// ─── Intimacy helpers ─────────────────────────────────────────────────────

export async function getIntimacyData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const persona = await db.select({ chatCount: personas.chatCount, createdAt: personas.createdAt }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
  const [memCount] = await db.select({ c: count() }).from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)));
  const emotionRows = await db.select({ s: emotionSnapshots.emotionalState }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .groupBy(emotionSnapshots.emotionalState);
  const daysSinceCreation = Math.floor((Date.now() - new Date(persona[0].createdAt).getTime()) / 86400000);
  // The days the conversations happened on, in the user's own calendar.
  //
  // Two things were wrong here, and together they made the streak always
  // zero: the database hands a `DATE` back as a JavaScript Date rather
  // than as the string the code compared it against, and the day it was
  // compared with was the *UTC* day while the stored value is the
  // server's own clock.
  //
  // The streak is one of the inputs to the intimacy score, and the
  // intimacy score is one of the gates on the graduation — so a streak
  // that was always zero meant the whole ritual was unreachable.
  const timezone = await getUserTimezone(userId);
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const recentDays = await db.select({ d: day }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .groupBy(day).orderBy(desc(day)).limit(30);
  let consecutiveDays = 0;
  // Walk back from today, in the user's calendar.
  let cursor = zonedDateKey(new Date(), timezone);
  for (let i = 0; i < recentDays.length; i++) {
    if (recentDays[i].d !== cursor) break;
    consecutiveDays++;
    cursor = previousDateKey(cursor);
  }
  return {
    chatCount: persona[0].chatCount,
    totalMessages: msgCount?.c || 0,
    memoryCount: memCount?.c || 0,
    emotionVariety: emotionRows.length,
    daysSinceCreation,
    consecutiveDays,
  };
}

export async function updateIntimacy(personaId: number, userId: number, score: number, level: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ intimacyScore: score, intimacyLevel: level })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Memory helpers ───────────────────────────────────────────────────────

export async function createMemory(data: InsertMemory) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(memories).values(data).returning({ id: memories.id });
  return result.id;
}

/**
 * How many memories a persona holds.
 *
 * The list is capped, and the cap used to be silent: a person with four
 * hundred memories was shown two hundred of them with nothing saying so.
 */
export async function countMemories(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)));
  return result?.c || 0;
}

/**
 * The anniversaries of a persona.
 *
 * Only the anniversaries: the sweep ran every minute and read up to
 * two hundred memories of every persona to look at the handful of them
 * that were anniversaries.
 */
export async function getAnniversaryMemories(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: memories.id,
    title: memories.title,
    date: memories.date,
  })
    .from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.category, "anniversary"),
    ))
    .orderBy(asc(memories.date));
}

export async function getMemoriesByPersonaId(
  personaId: number,
  userId: number,
  limit: number = MEMORY_LIST_LIMIT,
) {
  const db = await getDb();
  if (!db) return [];
  // Pinned first, then by weight, then newest. The retrieval scorer does
  // its own ranking, but a low-weight memory should not be invisible to it
  // just because it is old — the candidate list is capped, so the order
  // decides what gets scored at all.
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.isPinned), desc(memories.importance), desc(memories.createdAt))
    .limit(limit);
}

/** How many memories the list returns at once. */
export const MEMORY_LIST_LIMIT = 200;


/**
 * Records that an extraction has just run.
 *
 * It is a timestamp on the conversation rather than a new table: the
 * extraction is a fact about a conversation, and the conversation is
 * where it belongs.
 */
/**
 * Records that an extraction ran.
 *
 * The moment it records is the moment the run covered — not the wall
 * clock. A run that only had room for some of the messages must not
 * claim the rest: they would never be looked at.
 */
export async function markMemoryExtracted(
  personaId: number,
  userId: number,
  extractedAt: Date = new Date(),
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  /**
   * The row is brought up to date, not added to.
   *
   * The write said "do nothing on a conflict", but the table had no
   * constraint for a conflict to happen on — so a row was added every
   * time, and the log grew for ever. And with the constraint there, a
   * plain "do nothing" would have kept the *first* extraction's time
   * for ever, so the window of every later extraction would have been
   * the whole history.
   */
  await db.insert(memoryExtractions)
    .values({ personaId, userId, extractedAt, lastAttemptAt: extractedAt })
    .onConflictDoUpdate({
      target: [memoryExtractions.personaId, memoryExtractions.userId],
      set: { extractedAt, lastAttemptAt: extractedAt },
    });
}

/**
 * Records that an extraction *tried*, whether or not it worked.
 *
 * The window only moves when the answer could be read — so a model
 * that answers with prose instead of JSON left it where it was, and
 * the next turn paid for another call. The attempt is a separate
 * column, so a failing extraction is retried at most once per
 * interval.
 */
export async function markMemoryAttempted(
  personaId: number,
  userId: number,
  attemptedAt: Date = new Date(),
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(memoryExtractions)
    .values({ personaId, userId, extractedAt: attemptedAt, lastAttemptAt: attemptedAt })
    .onConflictDoUpdate({
      target: [memoryExtractions.personaId, memoryExtractions.userId],
      set: { lastAttemptAt: attemptedAt },
    });
}

/**
 * When the extraction last tried, whether or not it worked.
 */
export async function getLastExtractionAttemptAt(
  personaId: number,
  userId: number,
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ at: max(memoryExtractions.lastAttemptAt) }).from(memoryExtractions)
    .where(and(eq(memoryExtractions.personaId, personaId), eq(memoryExtractions.userId, userId)));
  return rows[0]?.at ?? null;
}

/**
 * The last time an extraction ran, from the extraction log.
 */
export async function getLastExtractionAt(personaId: number, userId: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ at: max(memoryExtractions.extractedAt) }).from(memoryExtractions)
    .where(and(eq(memoryExtractions.personaId, personaId), eq(memoryExtractions.userId, userId)));
  return rows[0]?.at ?? null;
}

/**
 * The titles of a set of memories, by id.
 *
 * A message records which memories it recalled, so the interface can
 * show what the persona had in mind when it answered.
 */
/**
 * The titles of some memories.
 *
 * Scoped to the owner, like every other read here. The ids come from
 * the caller's own messages today, so nothing has leaked yet — but this
 * was the only reading helper in the file that did not check, and a
 * helper that does not check is one call away from one that does not.
 */
/**
 * The titles of a set of memories.
 *
 * The owner is required: without it, the helper hands back any user's
 * memory titles for the ids it is given. The only caller passes it, but
 * a parameter that may be left out is a parameter that will be.
 */
export async function getMemoryTitles(ids: number[], userId: number) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, string>();
  const unique = Array.from(new Set(ids));
  const rows = await db.select({
    id: memories.id,
    title: memories.title,
    subject: memories.subject,
  }).from(memories).where(and(inArray(memories.id, unique), eq(memories.userId, userId)));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/**
 * Edits a memory, and lets the user pin it.
 *
 * The retrieval used to read `isPinned` and sort by `importance`, and
 * nothing ever wrote either — so "pin a memory" did not exist. The
 * fields were there; the door was not.
 */
export async function updateMemory(
  id: number,
  userId: number,
  data: {
    title?: string;
    description?: string | null;
    category?: "milestone" | "memory" | "anniversary" | "anchor";
    date?: string | null;
    isPinned?: boolean;
    importance?: number;
    /** Whose memory this is: "them" or "me". */
    subject?: "them" | "me";
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(memories)
    .set(data)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Removes a memory.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteMemory(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

// ─── Emotion Snapshot helpers ─────────────────────────────────────────────

export async function createEmotionSnapshot(data: InsertEmotionSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(emotionSnapshots).values(data).returning({ id: emotionSnapshots.id });
  return result.id;
}

/**
 * Brings a day's snapshot up to date.
 *
 * The snapshot was written once, when the first message of the day
 * arrived, and never touched again — so the "message count" in the
 * emotion report was really "the number of messages at that moment".
 * A user who sent one message at nine in the morning and nine more at
 * nine at night showed a count of one for the day.
 */
export async function updateEmotionSnapshot(
  id: number,
  userId: number,
  data: { emotionalState?: string; messageCount?: number },
) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(emotionSnapshots)
    .set(data)
    .where(and(eq(emotionSnapshots.id, id), eq(emotionSnapshots.userId, userId)))
    .returning();
  return row ?? null;
}

export async function getEmotionSnapshots(
  personaId: number,
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window, in the user's own calendar.
   *
   * The rows carry the user's day in their `date` column, so the
   * window has to be a day key in the same calendar. It was the
   * server's clock — so a "last thirty days" chart showed thirty-one
   * days, and the left-most label fell outside the window it claimed.
   */
  const since = zonedDayKeySince(days, timezone);
  return db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(
  personaId: number,
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  // The window is the user's own calendar — the same one the rows are
  // filed under.
  const since = zonedDayKeySince(days, timezone);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .groupBy(emotionSnapshots.emotionalState);
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  return { snapshots, distribution, totalDays: snapshots.length, totalMessages };
}

export async function getTodaySnapshot(
  personaId: number,
  userId: number,
  /**
   * The day the snapshot is looked up under.
   *
   * It has to be the same day the snapshot was *written* under — the
   * user's own calendar. It used to be the UTC day, so the two
   * disagreed for sixteen hours out of every twenty-four: the "one
   * snapshot a day" guard fired against yesterday's row, and a user who
   * only talked between midnight and eight in the morning got no
   * snapshot at all for that day.
   */
  today: string = localDateKey(new Date()),
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId), eq(emotionSnapshots.date, today)))
    .limit(1);
  return rows[0];
}

// ─── Analytics helpers ────────────────────────────────────────────────────

export async function getMessageVolume(userId: number, days: number, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window is the user's days.
   *
   * It was an absolute instant — "now, minus thirty days" — while the
   * rows are bucketed by the user's day. So a thirty-day window covered
   * thirty-*one* day keys: the oldest one held only part of a day, and
   * the chart drew a bar the user could not account for.
   */
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({ date: day, count: count() })
    .from(messages)
    .where(and(
      eq(messages.userId, userId),
      // The user's own messages: the chart is about how much the *user*
      // talked, and the persona always answers within seconds.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day).orderBy(day);
  return fillMissingDays(rows, days, timezone);
}

/**
 * The days of a range, with the days that have nothing in them.
 *
 * The charts joined the days that had rows with a continuous line — so
 * a user who was there on the first day of the month and on the last
 * saw a smooth curve implying steady contact.
 */
function fillMissingDays(
  rows: Array<{ date: string; count: number }>,
  days: number,
  timezone?: string | null,
): Array<{ date: string; count: number }> {
  const byDate = new Map(rows.map((row) => [row.date, Number(row.count)]));
  const filled: Array<{ date: string; count: number }> = [];
  const today = zonedDateKey(new Date(), timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return rows;
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  cursor.setUTCDate(cursor.getUTCDate() - Math.max(0, days - 1));
  for (let i = 0; i < Math.max(1, days); i++) {
    const key = cursor.toISOString().slice(0, 10);
    filled.push({ date: key, count: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return filled;
}

export async function getEmotionTimeline(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    date: emotionSnapshots.date,
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.userId, userId), gte(emotionSnapshots.createdAt, since)))
    .groupBy(emotionSnapshots.date, emotionSnapshots.emotionalState)
    .orderBy(emotionSnapshots.date);
}

export async function getPersonaEngagement(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    personaId: messages.personaId,
    name: personas.name,
    messageCount: count(),
  }).from(messages)
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(messages.personaId, personas.name)
    .orderBy(desc(count()));
}

export async function getHourlyDistribution(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  // The user's days — see the message volume above.
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  /**
   * The hour, in the user's own calendar.
   *
   * It was the server's clock — the hour the message was written on
   * the machine that wrote it. So the chart of the active hours and
   * the chart of the days, in the same answer, were on two different
   * calendars.
   */
  const hour = userHourColumn(timezone);
  return db.select({
    hour,
    count: count(),
  }).from(messages)
    .where(and(
      eq(messages.userId, userId),
      // The user's own messages: the chart is "when do *you* talk".
      // The persona answers within seconds, so counting its replies
      // made every hour look busy — and made the numbers disagree with
      // the safety counter, which counts only the user's turns.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(hour);
}

export async function getAnalyticsStats(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };
  // The user's days — see the message volume above.
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.userId, userId),
      // The user's own messages, like the charts beside it.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  /**
   * The days the user was active, in the user's own calendar.
   *
   * They were the server's days — and the volume chart in the same
   * answer used the user's days. So the "active days" number and the
   * chart beside it disagreed about which days those were.
   */
  const day = userDayColumn(timezone);
  const activeDaysRows = await db.select({ d: day }).from(messages)
    .where(and(
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day).orderBy(day);
  const activeDays = activeDaysRows.length;
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < activeDaysRows.length; i++) {
    if (i === 0) { currentStreak = 1; }
    else {
      const prev = new Date(activeDaysRows[i - 1].d);
      const curr = new Date(activeDaysRows[i].d);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }
  return {
    totalMessages: msgCount?.c || 0,
    activeDays,
    longestStreak,
    /**
     * The average over the *range*.
     *
     * It was over the days the user was there — so a hundred messages
     * over five active days in a thirty-day window read as "twenty
     * messages a day", six times what the label implies, with the
     * denominator never stated.
     */
    avgPerDay: Math.round((msgCount?.c || 0) / Math.max(1, days)),
  };
}

// ─── Diary helpers ────────────────────────────────────────────────────────

export async function createDiaryEntry(data: InsertDiaryEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(diaryEntries).values(data).returning({ id: diaryEntries.id });
  return result.id;
}

export async function getDiaryEntries(userId: number, personaId?: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({
    id: diaryEntries.id, personaId: diaryEntries.personaId, date: diaryEntries.date,
    summary: diaryEntries.summary, highlights: diaryEntries.highlights,
    emotionalArc: diaryEntries.emotionalArc, quotes: diaryEntries.quotes,
    reflection: diaryEntries.reflection, messageCount: diaryEntries.messageCount,
    createdAt: diaryEntries.createdAt, personaName: personas.name,
  }).from(diaryEntries)
    .innerJoin(personas, eq(diaryEntries.personaId, personas.id))
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows;
}

export async function getDiaryByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId), eq(diaryEntries.date, date)))
    .limit(1);
  return rows[0];
}

/**
 * Removes a diary entry.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteDiaryEntry(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(diaryEntries)
    .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)))
    .returning({ id: diaryEntries.id });
  return rows.length > 0;
}

/**
 * The messages of one day, in the user's own calendar.
 *
 * The day a message belongs to is the user's day, not the server's: the
 * timestamps are stored without a time zone, so `DATE(createdAt)` is
 * the day it was written on the machine that wrote it. The shift is the
 * same one the daily counts use.
 */
export async function getMessagesByDate(
  personaId: number,
  userId: number,
  date: string,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), sql`${day} = ${date}`))
    .orderBy(asc(messages.createdAt));
}

export async function getDiaryDates(userId: number, personaId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({ date: diaryEntries.date }).from(diaryEntries).where(and(...conditions));
  return rows.map(r => r.date);
}

// ─── SCENES ──────────────────────────────────────────────────────────────────

/**
 * The scenes every installation ships with.
 *
 * The wording comes from the copy table, so the row that is seeded and the
 * wording the interface shows cannot drift apart. The row keeps the
 * Chinese name because that name is how the scene is recognised: the
 * seeding looks for it, and a row that already carries it is left alone.
 *
 * Exported so the seeding routine can be tested without a database.
 */
export const BUILTIN_SCENES: InsertScene[] = BUILTIN_SCENE_DEFINITIONS.map((scene) => ({
  name: scene.name,
  icon: scene.icon,
  description: scene.description.zh,
  systemPromptOverlay: scene.overlay.zh,
  emotionalState: scene.emotionalState,
  starters: scene.starters.map((starter) => starter.zh),
  isBuiltin: true,
}));

/**
 * Seeds the built-in scenes.
 *
 * The scenes are identified by their name, and the list grows with every
 * release — so the seeding fills in whatever is missing rather than
 * deciding that an installation which already has a built-in scene is
 * complete. Otherwise a new scene would only ever appear on a fresh
 * install.
 *
 * Two processes may seed at the same time, so the insert ignores conflicts:
 * the partial unique index on the built-in names decides which row wins.
 *
 * Exported so the routine can be tested without a database.
 */
export async function seedBuiltinScenes(db: ReturnType<typeof drizzle>): Promise<void> {
  const existing = await db.select({ name: scenes.name }).from(scenes).where(eq(scenes.isBuiltin, true));
  const have = new Set(existing.map((row) => row.name));
  const missing = BUILTIN_SCENES.filter((scene) => !have.has(scene.name));
  if (missing.length === 0) return;
  await db.insert(scenes).values(missing).onConflictDoNothing();
}

export async function getScenes(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await seedBuiltinScenes(db);
  return db.select().from(scenes)
    .where(sql`${scenes.isBuiltin} = true OR ${scenes.userId} = ${userId}`)
    .orderBy(desc(scenes.isBuiltin), asc(scenes.createdAt));
}

/**
 * Reads a scene by id.
 *
 * Built-in scenes belong to no user and are readable by everyone; a custom
 * scene is only readable by the user who created it.
 */
export async function getSceneById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(scenes)
    .where(and(
      eq(scenes.id, id),
      or(eq(scenes.isBuiltin, true), eq(scenes.userId, userId)),
    )).limit(1);
  return row || null;
}

export async function createScene(data: InsertScene) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(scenes).values(data).returning();
  return row;
}

/**
 * Deletes a custom scene.
 *
 * Returns false when nothing was deleted — the scene belongs to somebody
 * else, or it is a built-in one. The caller turns that into a refusal
 * rather than reporting a success that did not happen.
 */
export async function deleteScene(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const deleted = await db.delete(scenes).where(and(
    eq(scenes.id, id),
    eq(scenes.isBuiltin, false),
    eq(scenes.userId, userId),
  ));
  return (deleted.rowCount ?? 0) > 0;
}

/**
 * Attaches a scene to a persona.
 *
 * Only the persona's owner may change this, and only their own scenes (or a
 * built-in one) may be attached — otherwise a user could graft another
 * user's scene prompt onto their persona.
 */
export async function activateScene(personaId: number, sceneId: number | null, userId: number) {
  const db = await getDb();
  if (!db) return;

  if (sceneId != null) {
    const scene = await getSceneById(sceneId, userId);
    if (!scene) throw new Error("Scene not found");
  }

  await db.update(personas).set({ activeSceneId: sceneId, updatedAt: new Date() })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Export helpers ─────────────────────────────────────────────────────────

/**
 * How many messages one persona's export carries.
 *
 * The export is held in memory and then serialised into one string, so
 * the ceiling is a memory ceiling rather than a policy one. The
 * whole-account export has had one all along; the single-persona one
 * did not — and a persona with a hundred thousand messages read all of
 * them, and then built one HTML string out of them.
 */
const MAX_PERSONA_EXPORT_MESSAGES = 10_000;

/** How many memories one persona's export carries. */
const MAX_PERSONA_EXPORT_MEMORIES = 10_000;

/** How many days of emotional snapshots one persona's export carries. */
const MAX_PERSONA_EXPORT_SNAPSHOTS = 3_650;

/** How many diary entries one persona's export carries. */
const MAX_PERSONA_EXPORT_DIARIES = 3_650;

/** How many letters one persona's export carries. */
const MAX_PERSONA_EXPORT_LETTERS = 10_000;

export async function getExportData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [persona] = await db.select().from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt))
    .limit(MAX_PERSONA_EXPORT_MESSAGES);
  /**
   * The other four lists are bounded as well.
   *
   * The export is held in memory and then rendered into one HTML
   * string, so the ceiling is a memory ceiling rather than a policy
   * one. Memories grow by up to five a day, diaries and snapshots by
   * one a day each, and letters by as many as the user writes.
   */
  const allMemories = await db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(asc(memories.createdAt))
    .limit(MAX_PERSONA_EXPORT_MEMORIES);
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .orderBy(asc(emotionSnapshots.date))
    .limit(MAX_PERSONA_EXPORT_SNAPSHOTS);
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date))
    .limit(MAX_PERSONA_EXPORT_DIARIES);
  const allLetters = await db.select().from(letters)
    .where(and(eq(letters.personaId, personaId), eq(letters.userId, userId)))
    .orderBy(asc(letters.createdAt))
    .limit(MAX_PERSONA_EXPORT_LETTERS);
  return {
    persona,
    messages: allMessages,
    memories: allMemories,
    emotionSnapshots: allSnapshots,
    diaryEntries: allDiaries,
    letters: allLetters,
  };
}

// ─── Message-level helpers ──────────────────────────────────────────────────

/**
 * Rewrites a message the user sent.
 *
 * Only the user's own messages can be edited: the persona's replies are
 * what they are, and letting them be rewritten would quietly change the
 * record of the conversation.
 */
export async function updateUserMessage(
  messageId: number,
  userId: number,
  content: string,
  personaId?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * The message has to be in the conversation the user is looking at.
   *
   * The edit was scoped to the user alone, so a message of one persona
   * could be edited through another — the conversation on the screen
   * and the conversation that changed were two different ones.
   */
  const updated = await db.update(messages)
    .set({ content })
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  return updated.length > 0;
}

/**
 * Deletes a single message.
 *
 * The chat history is the user's, and a single message in the middle of it
 * can be something they would rather not have written down.
 */
export async function deleteMessage(
  messageId: number,
  userId: number,
  personaId?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // The message has to be in the conversation the user is looking at.
  const deleted = await db.delete(messages)
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  return deleted.length > 0;
}

/**
 * Deletes a message and everything the persona said after it.
 *
 * This is what "regenerate" needs: the old reply and everything after it
 * belonged to a turn that is being replaced.
 *
 * The cut is made inside one persona. It used to be made by time across
 * the whole account, so pressing "regenerate" in one conversation deleted
 * the messages of every other conversation the user had — the history of
 * another persona, destroyed by a button in this one.
 */
/**
 * A message, as it is kept so that it can be put back.
 */
export interface MessageSnapshot {
  role: string;
  content: string;
  emotionalState: string | null;
  messageType: string | null;
  mediaUrl: string | null;
  replyToId: number | null;
  /**
   * Where the message came from.
   *
   * It was left out — so a restored WeChat message became a "web" one,
   * and a letter's answer or a proactive message became an ordinary
   * turn. The transcript said the wrong thing about where the message
   * came from.
   */
  channel: string | null;
  /** "letter" or "proactive", when the message was one of those. */
  origin: string | null;
  createdAt: Date;
}

/**
 * The messages from a given one onwards, oldest first.
 *
 * They are read so that they can be put back: a regeneration replaces a
 * turn, and the turn it replaces has to survive a failure.
 */
export async function getMessagesFrom(
  messageId: number,
  personaId: number,
  userId: number,
): Promise<MessageSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    role: messages.role,
    content: messages.content,
    emotionalState: messages.emotionalState,
    messageType: messages.messageType,
    mediaUrl: messages.mediaUrl,
    replyToId: messages.replyToId,
    channel: messages.channel,
    origin: messages.origin,
    createdAt: messages.createdAt,
  })
    .from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.id, messageId),
    ))
    .orderBy(asc(messages.id));
}

/**
 * Writes a set of messages back.
 *
 * The ids are new ones, and the order is the order they are given in —
 * so a turn that is put back reads the same way it did before.
 */
export async function restoreMessages(
  rows: MessageSnapshot[],
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  for (const row of rows) {
    await db.insert(messages).values({
      personaId,
      userId,
      role: row.role as "user" | "assistant",
      content: row.content,
      emotionalState: row.emotionalState,
      messageType: row.messageType as any,
      mediaUrl: row.mediaUrl,
      replyToId: row.replyToId,
      // The message keeps its own origin: a WeChat message stays a
      // WeChat message, and a letter's answer stays a letter's answer.
      ...(row.channel ? { channel: row.channel as any } : {}),
      ...(row.origin ? { origin: row.origin as any } : {}),
      createdAt: row.createdAt,
    });
  }
  return rows.length;
}

export async function deleteMessagesFrom(
  messageId: number,
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const target = await db.select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.id, messageId),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
    ))
    .limit(1);
  if (target.length === 0) return 0;

  // The ids are a sequence, so "this message and everything after it" is
  // `id >= this one`. Cutting by time instead would take the messages
  // that share the millisecond with it as well.
  const deleted = await db.delete(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.id, target[0].id),
    ))
    .returning({ id: messages.id });
  return deleted.length;
}

/** The message before the given one, for "regenerate the last reply". */
/**
 * The message before a given one.
 *
 * It used to read the persona's entire history — every row, with every
 * message's text — to find one. A persona with fifty thousand messages
 * read all of them on each "regenerate".
 *
 * The row before it is found in the database instead: the messages
 * before it, newest first, one row.
 */
export async function getPreviousMessage(
  personaId: number,
  userId: number,
  messageId: number,
  /**
   * The role the row must have.
   *
   * It was the row immediately before — whatever it was. So a reply to
   * a message the user did not write (a proactive message, a letter
   * answer, a message that came from another channel) had no previous
   * *user* message, and the regeneration said "that message was not
   * found".
   *
   * With a role, the search walks back to the nearest row of that
   * role — which is the user's own question that the reply answered.
   */
  role?: "user" | "assistant",
) {
  const db = await getDb();
  if (!db) return null;
  // The row before it is found by the database: the messages that are
  // older than the one asked for, newest first, one row.
  const rows = await db.select().from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      ...(role ? [eq(messages.role, role)] : []),
      sql`"createdAt" < (SELECT "createdAt" FROM "messages" WHERE "id" = ${messageId} AND "personaId" = ${personaId} AND "userId" = ${userId})`,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(
  personaId: number,
  userId: number,
  days: number = 14,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  // The user's own calendar, like the rows themselves.
  const since = zonedDayKeySince(days, timezone);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ));
}

/**
 * The number of messages in a window of days.
 *
 * The window is the user's own.
 *
 * It used to be the server's midnight-to-midnight, while the emotion
 * trend one line above was measured on the user's — so the two halves
 * of the same gate were on two different calendars, and the gate
 * fired at the wrong moment for anybody not on the server's clock.
 */
/**
 * The start of the user's own day, N days ago.
 *
 * The messages are stored with the server's wall clock, so the user's
 * midnight has to be expressed in it: shift to the user's clock, take
 * the day, shift back.
 */
function startOfUserDay(now: Date, timezone: string | null | undefined, daysAgo: number): Date {
  const start = new Date(now.getTime());
  const shift = dayShiftMinutes(timezone, now);
  start.setMinutes(start.getMinutes() + shift);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(start.getMinutes() - shift);
  start.setDate(start.getDate() - daysAgo);
  return start;
}

export async function getMessageCountInRange(
  personaId: number,
  userId: number,
  startDaysAgo: number,
  endDaysAgo: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const start = startOfUserDay(now, timezone, startDaysAgo);
  const end = startOfUserDay(now, timezone, endDaysAgo);
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, start),
      sql`${messages.createdAt} < ${end}`
    ));
  return result?.c || 0;
}

export async function setGraduationStatus(
  personaId: number, userId: number,
  status: "suggested" | "graduated" | "declined" | null,
  farewellLetter?: string,
  /**
   * Whether the letter is the simplified one.
   *
   * It is recorded next to the letter because the two belong together:
   * a reader has to be able to tell which of the two they are looking
   * at, and that has to survive a reload.
   */
  farewellDegraded?: boolean,
  /**
   * Which lines the second pass kept, and which it cut.
   *
   * It is stored next to the letter because the two belong together:
   * the letter is the result, and this is how it got there.
   */
  farewellDraft?: unknown,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const data: Record<string, any> = { graduationStatus: status, updatedAt: now };
  if (status === "suggested") {
    // The offer is recorded so it is made once rather than on every turn.
    data.graduationSuggestedAt = now;
  }
  if (status === "declined") {
    // A refusal is recorded too: it starts the cooldown, after which the
    // offer may be made again.
    data.graduationDeclinedAt = now;
  }
  if (status === "graduated") {
    data.graduatedAt = now;
    data.presence = "asleep";
    if (farewellLetter) data.farewellLetter = farewellLetter;
    if (farewellDegraded !== undefined) data.farewellDegraded = farewellDegraded;
    if (farewellDraft !== undefined) data.farewellDraft = farewellDraft;
  }
  if (status === null) {
    // Waking a persona does not destroy its farewell letter. The letter is
    // the one artefact of the goodbye, and losing it because the persona
    // was woken up would be the wrong kind of easy.
    data.graduationStatus = null;
    data.presence = "active";
  }
  await db.update(personas).set(data)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}


// ─── Conversation summary helpers ──────────────────────────────────────────

export async function createChatSummary(data: InsertChatSummary) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(chatSummaries).values(data).returning({ id: chatSummaries.id });
  return result.id;
}

export async function getLatestChatSummary(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(chatSummaries)
    .where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)))
    .orderBy(desc(chatSummaries.createdAt)).limit(1);
  return rows[0];
}


// ─── Safety event helpers ──────────────────────────────────────────────────

export async function createSafetyEvent(data: InsertSafetyEvent) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(safetyEvents).values(data).returning({ id: safetyEvents.id });
  return result.id;
}

/**
 * Whether a safety event of this kind was already recorded today.
 *
 * The safety layer's own conditions stay true all day: "more than
 * five messages" is true for the sixth message *and every message
 * after it*, and a long session stays long. So without this, every
 * message of the day recorded another event and carried another copy
 * of the same caring words — and the transparency panel, which shows
 * the newest twenty, filled up with twenty identical rows and pushed
 * the one real record off the end.
 */
export async function hasSafetyEventSince(params: {
  userId: number;
  personaId: number | null;
  type: "crisis" | "usage" | "dependency" | "graduation_trajectory" | "distress";
  since: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: safetyEvents.id })
    .from(safetyEvents)
    .where(and(
      eq(safetyEvents.userId, params.userId),
      eq(safetyEvents.type, params.type),
      gte(safetyEvents.createdAt, params.since),
      ...(params.personaId === null
        ? [isNull(safetyEvents.personaId)]
        : [eq(safetyEvents.personaId, params.personaId)]),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * How many safety events there are in all.
 *
 * The panel shows the newest twenty — so without this it could not say
 * that what it is showing is not everything.
 */
export async function countSafetyEvents(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ c: count() }).from(safetyEvents)
    .where(eq(safetyEvents.userId, userId));
  return rows[0]?.c ?? 0;
}

export async function getSafetyEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(safetyEvents)
    .where(eq(safetyEvents.userId, userId))
    .orderBy(desc(safetyEvents.createdAt)).limit(limit);
}

/**
 * Marks a safety event as handled.
 *
 * It says whether a row was actually changed — see `deleteWechatBinding`.
 */
export async function resolveSafetyEvent(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(safetyEvents).set({ resolvedAt: new Date(), handled: true })
    .where(and(eq(safetyEvents.id, id), eq(safetyEvents.userId, userId)))
    .returning({ id: safetyEvents.id });
  return rows.length > 0;
}

// ─── Graduation trajectory helpers ─────────────────────────────────────────

export async function createGraduationAssessment(data: InsertGraduationAssessment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(graduationAssessments).values(data)
    .returning({ id: graduationAssessments.id });
  return result.id;
}

/**
 * The latest assessment of each of a user's personas.
 *
 * One query, rather than one per persona: the trajectory page asked
 * for the newest assessment of every persona the user had, one round
 * trip at a time.
 */
export async function getLatestGraduationAssessments(
  userId: number,
): Promise<Array<typeof graduationAssessments.$inferSelect>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinctOn([graduationAssessments.personaId])
    .from(graduationAssessments)
    .where(eq(graduationAssessments.userId, userId))
    .orderBy(graduationAssessments.personaId, desc(graduationAssessments.createdAt));
  return rows;
}

export async function getLatestGraduationAssessment(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(graduationAssessments)
    .where(and(
      eq(graduationAssessments.personaId, personaId),
      eq(graduationAssessments.userId, userId),
    ))
    .orderBy(desc(graduationAssessments.createdAt)).limit(1);
  return rows[0];
}

// ─── Channel helpers ───────────────────────────────────────────────────────


export async function getChannelBindingsByUserId(userId: number, channel?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(channelBindings.userId, userId)];
  if (channel) conditions.push(eq(channelBindings.channel, channel));
  return db.select().from(channelBindings).where(and(...conditions));
}

/** The default persona bound to a conversation on a channel. */
export async function getChannelBinding(
  userId: number,
  channel: string,
  targetId: string,
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, userId),
    eq(channelBindings.channel, channel),
    eq(channelBindings.targetId, targetId),
    eq(channelBindings.isActive, true),
  )).limit(1);
  return rows[0];
}

/**
 * Sets the default persona for a conversation on a channel.
 *
 * Replaces any existing active binding for the same conversation.
 */
/**
 * The persona a channel talks to when a conversation has no binding of
 * its own.
 */
export async function getChannelDefaultPersona(userId: number, channel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(channelDefaultPersonas).where(and(
    eq(channelDefaultPersonas.userId, userId),
    eq(channelDefaultPersonas.channel, channel),
  )).limit(1);
  return row;
}

/**
 * Sets the persona a channel talks to.
 *
 * It is an upsert: the choice is made again and again, and it always
 * means "the persona this channel talks to".
 */
export async function setChannelDefaultPersona(params: {
  userId: number;
  channel: string;
  personaId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(channelDefaultPersonas).values({
    userId: params.userId,
    channel: params.channel,
    personaId: params.personaId,
  }).onConflictDoUpdate({
    target: [channelDefaultPersonas.userId, channelDefaultPersonas.channel],
    set: { personaId: params.personaId },
  }).returning();
  return row ?? null;
}

export async function setChannelBindingPersona(params: {
  userId: number;
  channel: string;
  targetId: string;
  personaId: number;
  targetName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, params.channel),
    eq(channelBindings.targetId, params.targetId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.targetName != null ? { targetName: params.targetName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelBindings).values({
    userId: params.userId,
    channel: params.channel,
    targetId: params.targetId,
    targetName: params.targetName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).returning({ id: channelBindings.id });
  return result.id;
}

/**
 * Removes a channel binding.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteChannelBinding(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(channelBindings)
    .where(and(eq(channelBindings.id, id), eq(channelBindings.userId, userId)))
    .returning({ id: channelBindings.id });
  return rows.length > 0;
}

export async function getChannelState(userId: number, channel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);
  return rows[0];
}

export type ChannelStateUpdate = Partial<{
  status: string;
  credentialsEnc: string | null;
  cursor: string | null;
  lastInboundAt: Date | null;
  lastError: string | null;
}>;

export async function upsertChannelState(
  userId: number,
  channel: string,
  data: ChannelStateUpdate,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channelStates.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelStates)
    .values({ userId, channel, ...data })
    .returning({ id: channelStates.id });
  return result.id;
}


// ─── Persona template helpers ──────────────────────────────────────────────

export async function getUserTemplates(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaTemplates)
    .where(eq(personaTemplates.userId, userId))
    .orderBy(desc(personaTemplates.createdAt));
}

export async function createUserTemplate(data: InsertPersonaTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaTemplates).values(data)
    .returning({ id: personaTemplates.id });
  return result.id;
}

/**
 * Updates a template.
 *
 * It says whether a row was actually changed: the update is scoped to
 * the owner, so a row that does not exist — or belongs to somebody
 * else — is silently not updated, and the caller used to report that
 * as a success.
 */
export async function updateUserTemplate(
  id: number,
  userId: number,
  data: Partial<InsertPersonaTemplate>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(personaTemplates).set(data)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)))
    .returning({ id: personaTemplates.id });
  return rows.length > 0;
}

/**
 * Deletes a template.
 *
 * It says whether a row was actually removed, for the same reason.
 */
export async function deleteUserTemplate(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(personaTemplates)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)))
    .returning({ id: personaTemplates.id });
  return rows.length > 0;
}

// ─── Questionnaire helpers ─────────────────────────────────────────────────

export async function createQuestionnaireAnswers(data: InsertPersonaQuestionnaireAnswer) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaQuestionnaireAnswers).values(data)
    .returning({ id: personaQuestionnaireAnswers.id });
  return result.id;
}


/**
 * Appends a correction entry to a persona's log.
 *
 * The log is an array, so the append happens in application code rather than
 * with a SQL expression — the read and the write are close enough together
 * that a lost update is not worth optimising for.
 */
export async function appendPersonaCorrection(
  personaId: number,
  userId: number,
  entry: Record<string, unknown>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.select({ log: personas.correctionLog }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  const existing = Array.isArray(row?.log) ? (row.log as Record<string, unknown>[]) : [];
  const next = [...existing, entry];
  await db.update(personas).set({ correctionLog: next })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  return next;
}

// ─── Research profile helpers ──────────────────────────────────────────────

/**
 * Stores the artefacts of the celebrity research flow.
 */
/**
 * Stores the research artefacts.
 *
 * The row is written by (persona, profile) — so a second distillation
 * of the same persona with the same profile *replaces* the first one.
 *
 * The write used to be a plain insert, so every run added another row
 * and the table grew for the life of the instance, with the newest run
 * and the one before it both sitting there.
 */
export async function createResearchProfile(data: InsertResearchProfile) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db
    .insert(researchProfiles)
    .values(data)
    .onConflictDoUpdate({
      target: [researchProfiles.personaId, researchProfiles.userId, researchProfiles.profile],
      set: {
        notes: data.notes,
        audit: data.audit,
        synthesis: data.synthesis,
        validation: data.validation,
        qualityReport: data.qualityReport,
        status: data.status,
        createdAt: data.createdAt ?? new Date(),
      },
    })
    .returning({ id: researchProfiles.id });
  return result.id;
}


/** The research artefacts of a persona, newest first. */
export async function getResearchProfilesByPersonaId(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researchProfiles)
    .where(and(eq(researchProfiles.personaId, personaId), eq(researchProfiles.userId, userId)))
    .orderBy(desc(researchProfiles.createdAt));
}

// ─── Collected message helpers ────────────────────────────────────────────

export async function createCollectedMessage(data: InsertCollectedMessage) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectedMessages).values(data)
    .returning({ id: collectedMessages.id });
  return result.id;
}

/**
 * Stores a batch of collected messages.
 *
 * One insert with many rows, rather than one insert per message. A
 * chat log of fifty thousand lines was fifty thousand round trips to
 * the database, and the collection sat there for an hour.
 */
/**
 * Writes the collected messages.
 *
 * The whole batch goes in one transaction.
 *
 * The chunks were written one at a time with no transaction, so a
 * failure in the seventh of thirty left fourteen hundred rows committed
 * — and the caller swallowed the failure and reported success, so the
 * job settled as "completed" with a count that did not match what was
 * stored. Now either all of it is there or none of it is.
 */
export async function createCollectedMessages(
  rows: InsertCollectedMessage[],
): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  // Postgres takes at most a thousand parameters in one statement, and
  // a row has five of them.
  const chunkSize = 200;
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      await tx.insert(collectedMessages).values(chunk);
    }
  });
  return rows.length;
}


/** The three fields a collected message's identity is made of. */
export interface CollectedMessageKey {
  source: string | null;
  timestamp: Date | null;
  content: string;
}

/**
 * The keys of the messages that were already collected.
 *
 * Only the three columns the key is made of are read: the whole row of
 * every message ever collected was loaded into the heap — fifty
 * thousand rows of a full chat log — of which three fields were used.
 */
export async function getCollectedMessageKeys(
  personaId: number,
  userId: number,
  source: string,
): Promise<CollectedMessageKey[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    source: collectedMessages.source,
    timestamp: collectedMessages.timestamp,
    content: collectedMessages.content,
  })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
      eq(collectedMessages.source, source),
    ));
}

/**
 * Every collected message of a persona, across all sources.
 *
 * The distillation pipeline reads the whole history, not one source at a
 * time.
 */
/**
 * The sources a persona has collected from.
 *
 * It is a question about the distinct sources, so it is asked of the
 * database — not by reading every collected message and looking at
 * what they say.
 */
export async function getCollectedMessageSources(
  personaId: number,
  userId: number,
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.selectDistinct({ source: collectedMessages.source })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
    ));
  return rows.map((r) => r.source).filter((s): s is string => !!s);
}

/**
 * The collected messages of a persona, oldest first.
 *
 * The ceiling is a real one. A fifty-thousand-line imported chat log
 * was read whole — every time the preview was opened, every time the
 * fidelity tools ran, and every time the distillation started.
 */
export const MAX_COLLECTED_MESSAGES = 20_000;

export async function getCollectedMessagesForPersona(
  personaId: number,
  userId: number,
  options: { limit?: number; source?: string | null; newest?: boolean } = {},
) {
  const db = await getDb();
  if (!db) return [];
  // Ordered by when the message was *said*, not by when it was
  // imported. Two imports of two different conversations used to be
  // laid end to end, and the ruler cut cases across the seam — a case
  // whose context was half of one conversation and half of another.
  const query = db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    ...(options.source ? [eq(collectedMessages.source, options.source)] : []),
  ));
  /**
   * Which end of the history.
   *
   * The limit is applied *after* the order, so an ascending order with
   * a limit gives the *oldest* N. The preview asks for "the last few"
   * and got the first few ever collected — so the user saw "300
   * messages" above messages from three months ago.
   */
  if (options.newest) {
    const newest = await query
      .orderBy(desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`))
      .limit(options.limit ?? MAX_COLLECTED_MESSAGES);
    // And back into the order they were said in.
    return newest.reverse();
  }
  return query
    .orderBy(asc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`))
    .limit(options.limit ?? MAX_COLLECTED_MESSAGES);
}

/**
 * How many messages have been collected for a persona.
 *
 * The preview asks for the last few and says how many there are — and
 * the count used to be the length of the *preview*, so "30 messages"
 * was said about a history of three hundred.
 */
export async function countCollectedMessagesForPersona(
  personaId: number,
  userId: number,
  source?: string | null,
) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    ...(source ? [eq(collectedMessages.source, source)] : []),
  ));
  return result?.c || 0;
}

// ─── Collection source helpers ────────────────────────────────────────────



// ─── Collection job helpers ───────────────────────────────────────────────

export async function createCollectionJob(data: InsertCollectionJob) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionJobs).values(data)
    .returning({ id: collectionJobs.id });
  return result.id;
}

/**
 * Writes a job's state, whatever is already there.
 *
 * The row is written by key, so a write that arrives before the row
 * exists — and a write that arrives twice — both land on the same
 * row. The insert used to lose the unique index on the key, and the
 * error was swallowed: the snapshot was lost, and the job the user saw
 * after a restart was an earlier stage of it.
 */
export async function upsertCollectionJob(
  jobKey: string,
  userId: number,
  data: Omit<InsertCollectionJob, "jobKey" | "userId">,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(collectionJobs)
    .values({ jobKey, userId, ...data })
    .onConflictDoUpdate({
      target: collectionJobs.jobKey,
      set: {
        status: data.status,
        progress: data.progress,
        messageCount: data.messageCount,
        foundCount: data.foundCount,
        truncated: data.truncated,
        error: data.error,
        personaId: data.personaId,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
      },
      // And only the owner's row is written.
      setWhere: sql`${collectionJobs.userId} = ${userId}`,
    });
}

export async function updateCollectionJob(
  id: number,
  userId: number,
  data: Partial<InsertCollectionJob>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(collectionJobs).set(data)
    .where(and(eq(collectionJobs.id, id), eq(collectionJobs.userId, userId)));
}

/** Looks a collection job up by its stable key, for one user. */
export async function getCollectionJobByKey(jobKey: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(collectionJobs)
    .where(and(eq(collectionJobs.jobKey, jobKey), eq(collectionJobs.userId, userId)))
    .limit(1);
  return rows[0];
}

/** A collection job that is still marked as running. */
export interface RunningCollectionJob {
  id: number;
  userId: number;
}

/**
 * The collection jobs that are still marked as running.
 *
 * The reconciliation after a restart used to look at the twenty newest
 * jobs of everybody: so a job that had been running when the process
 * died stayed "running" for ever, and the interface showed a spinner
 * that never ended — which is exactly what the reconciliation exists to
 * prevent.
 */
export async function getRunningCollectionJobs(): Promise<RunningCollectionJob[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: collectionJobs.id,
    userId: collectionJobs.userId,
  })
    .from(collectionJobs)
    .where(eq(collectionJobs.status, "running"));
  return rows.map((row) => ({ id: row.id, userId: row.userId }));
}

/**
 * A user's collection jobs, newest first.
 *
 * The owner is required: without it, the helper hands back every
 * user's collection jobs — their source, their status and their error
 * text.
 */
/**
 * Forgets the collection jobs that are old.
 *
 * The jobs are mirrored into the database so that they survive a
 * restart — and nothing ever deleted them, so the table grew for the
 * life of the instance. The in-memory store keeps the newest twenty;
 * the database now keeps the same.
 */
export async function pruneCollectionJobs(userId: number, keep = 20): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const old = await db
    .select({ id: collectionJobs.id })
    .from(collectionJobs)
    .where(eq(collectionJobs.userId, userId))
    .orderBy(desc(collectionJobs.createdAt))
    .offset(keep);
  if (old.length === 0) return 0;
  await db
    .delete(collectionJobs)
    .where(
      inArray(
        collectionJobs.id,
        old.map((row) => row.id),
      ),
    );
  return old.length;
}

export async function getCollectionJobs(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectionJobs)
    .where(eq(collectionJobs.userId, userId))
    .orderBy(desc(collectionJobs.createdAt))
    .limit(limit);
}

/**
 * One persisted collection job.
 *
 * The job list is read from the database, so a job that survived a
 * restart is in the list — and clicking it returned "not found",
 * because the detail was read from the process's memory. The panel
 * then spun on "loading" for ever.
 */
export async function getCollectionJob(jobKey: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(collectionJobs)
    .where(and(
      eq(collectionJobs.jobKey, jobKey),
      eq(collectionJobs.userId, userId),
    ))
    .limit(1);
  return row;
}

// ─── Reminder helpers ──────────────────────────────────────────────────────

/** Personas that may receive proactive reminders. */
export async function getAllPersonasForReminders() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personas.id,
    userId: personas.userId,
    name: personas.name,
    togetherFrom: personas.togetherFrom,
    togetherTo: personas.togetherTo,
    remindersEnabled: personas.remindersEnabled,
    presence: personas.presence,
    graduationStatus: personas.graduationStatus,
    reachability: personas.reachability,
    // The time zone the reminders are timed in. Without it the scheduler
    // counted the days in the server's calendar, which is not the day the
    // anniversary is.
    timezone: personas.timezone,
  }).from(personas).where(eq(personas.remindersEnabled, true));
}

/**
 * Records a reminder.
 *
 * The unique index on (userId, dedupeKey) is what makes a reminder
 * idempotent: a second attempt to deliver the same reminder is ignored.
 */
export async function recordReminder(data: {
  userId: number;
  personaId: number;
  channel: string;
  kind: string;
  text?: string;
  dedupeKey: string;
  scheduledFor: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const inserted = await db.insert(reminderDeliveries)
    .values({ ...data, deliveredAt: new Date() })
    .onConflictDoNothing();
  return (inserted.rowCount ?? 0) > 0;
}

/**
 * Gives a reminder's slot back.
 *
 * Used when the delivery failed: the slot was claimed before the send,
 * so that two sweeps could not both send, and it has to be released so
 * that the next tick can try again.
 */
export async function forgetReminder(userId: number, dedupeKey: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(reminderDeliveries).where(and(
    eq(reminderDeliveries.userId, userId),
    eq(reminderDeliveries.dedupeKey, dedupeKey),
  ));
}

/** Whether a reminder with this dedupe key has already been delivered. */
export async function hasReminderDelivery(userId: number, dedupeKey: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: reminderDeliveries.id })
    .from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      eq(reminderDeliveries.dedupeKey, dedupeKey),
    ))
    .limit(1);
  return rows.length > 0;
}

/** Reminders that were delivered and have not been dismissed. */
export async function getActiveReminders(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      sql`${reminderDeliveries.dismissedAt} IS NULL`,
    ))
    .orderBy(desc(reminderDeliveries.deliveredAt)).limit(limit);
}

/**
 * Dismisses a reminder.
 *
 * It says whether a row was actually changed — see `deleteWechatBinding`.
 */
export async function dismissReminder(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(reminderDeliveries).set({ dismissedAt: new Date() })
    .where(and(eq(reminderDeliveries.id, id), eq(reminderDeliveries.userId, userId)))
    .returning({ id: reminderDeliveries.id });
  return rows.length > 0;
}

// ─── Memory recall helpers ─────────────────────────────────────────────────

/** Records that a memory was surfaced, so repeats can be damped. */
export async function touchMemoryRecalled(id: number, userId: number, at: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(memories).set({ lastRecalledAt: at })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Message window helpers ────────────────────────────────────────────────

/** Messages for a persona within a time window, oldest first. */
export async function getMessagesSince(
  personaId: number,
  userId: number,
  since: Date,
  limit?: number,
) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
  }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, since),
    ))
    .orderBy(asc(messages.createdAt));
  // The newest messages are the ones that matter when the window is
  // larger than the ceiling.
  return limit === undefined ? query : query.limit(limit);
}

/** The timestamp of the most recent message, used for session-duration checks. */
export async function getLastMessageAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ createdAt: messages.createdAt }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(1);
  return rows[0]?.createdAt;
}


/**
 * Counts the messages the *user* sent since a point in time.
 *
 * The plain message count includes the persona's replies, so "five
 * messages a day" was really about three conversations — the threshold
 * fired at half the rate it was written for.
 */
export async function getUserMessageCountSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  return result?.c || 0;
}

/**
 * The number of messages the user sent on each of the last N days.
 *
 * Only the user's own messages count: a conversation is one turn from
 * them, not two rows in the table.
 */
export async function getDailyUserChatCounts(userId: number, days = 30, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({
    date: day,
    count: count(),
  })
    .from(messages)
    .where(and(
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day);
  return rows;
}

/**
 * When the current conversation session began.
 *
 * A session is a run of messages with no long silence in it. The previous
 * "long session" check measured the gap between the last two messages, so
 * a five-hour conversation never tripped it while a user who came back
 * after three hours away tripped it immediately — the opposite of what the
 * signal is for.
 */
export async function getSessionStartAt(
  personaId: number,
  userId: number,
  maxGapMs = 30 * 60 * 1000,
  lookback = 200,
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt))
    .limit(lookback);
  if (rows.length === 0) return null;

  let oldest = rows[0].createdAt;
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i - 1].createdAt.getTime() - rows[i].createdAt.getTime();
    if (gap > maxGapMs) break;
    oldest = rows[i].createdAt;
  }
  return oldest;
}

// ─── Fidelity evaluation ────────────────────────────────────────────────────

/**
 * Replaces the held-out cases for a persona.
 *
 * They are replaced rather than appended: the cases are cut from the
 * records, so re-cutting after a new import would otherwise leave the
 * old ones behind, scored against a persona that has since changed.
 */
export async function saveEvalCases(
  personaId: number,
  userId: number,
  cases: Array<{
    context: unknown;
    expected: unknown;
    expectedState?: string | null;
    source?: string;
    occurredAt?: Date | null;
  }>,
) {
  const db = await getDb();
  if (!db) return 0;
  if (!cases.length) {
    await db.delete(evalCases).where(and(
      eq(evalCases.personaId, personaId),
      eq(evalCases.userId, userId),
    ));
    return 0;
  }
  // The delete and the insert are one thing, not two: a failure between
  // them would leave the persona with no cases at all, and the ruler
  // would have nothing to measure.
  return withTransaction(async (tx) => {
    await tx.delete(evalCases).where(and(
      eq(evalCases.personaId, personaId),
      eq(evalCases.userId, userId),
    ));
    await tx.insert(evalCases).values(cases.map((c) => ({
      userId,
      personaId,
      contextJson: c.context,
      expectedJson: c.expected,
      expectedState: c.expectedState ?? null,
      source: c.source ?? "collected",
      occurredAt: c.occurredAt ?? null,
    })));
    return cases.length;
  });
}

/** The held-out cases for a persona, oldest first. */
export async function getEvalCases(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(evalCases).where(and(
    eq(evalCases.personaId, personaId),
    eq(evalCases.userId, userId),
  )).orderBy(asc(evalCases.id));
}

/**
 * Records a run of the evaluation.
 *
 * The snapshot matters: a run is only meaningful next to the persona
 * that produced it, and the persona changes.
 */
/**
 * How many runs of the evaluation are kept for a persona.
 *
 * Every run stores a full snapshot of the persona, so the table grew
 * for ever — and nothing ever pruned it, unlike the collector's jobs.
 */
const MAX_EVAL_RUNS_PER_PERSONA = 20;

export async function saveEvalRun(
  personaId: number,
  userId: number,
  metrics: unknown,
  personaSnapshot?: unknown,
) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(evalRuns).values({
    userId,
    personaId,
    metricsJson: metrics,
    personaSnapshot: personaSnapshot ?? null,
  }).returning({ id: evalRuns.id });

  /**
   * The old runs go.
   *
   * They are pruned after the new one is written, so the run that was
   * just made is never the one that is removed.
   */
  const old = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(and(eq(evalRuns.personaId, personaId), eq(evalRuns.userId, userId)))
    .orderBy(desc(evalRuns.id))
    // One more than the limit: the surplus is the tail of this list.
    .limit(MAX_EVAL_RUNS_PER_PERSONA + 1);
  const surplus = old.slice(MAX_EVAL_RUNS_PER_PERSONA);
  if (surplus.length > 0) {
    await db
      .delete(evalRuns)
      .where(
        inArray(
          evalRuns.id,
          surplus.map((row) => row.id),
        ),
      )
      .catch(() => undefined);
  }

  return result.id;
}

/** The most recent run of the evaluation for a persona. */
export async function getLatestEvalRun(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(evalRuns).where(and(
    eq(evalRuns.personaId, personaId),
    eq(evalRuns.userId, userId),
  )).orderBy(desc(evalRuns.id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Stores how this persona behaves over time.
 *
 * The profile is what makes the waiting theirs rather than the app's,
 * so it is kept on the persona next to everything else that describes
 * them.
 */
export async function setPersonaBehaviorProfile(
  personaId: number,
  userId: number,
  profile: unknown,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ behaviorProfile: profile ?? null }).where(and(
    eq(personas.id, personaId),
    eq(personas.userId, userId),
  ));
}

/** How this persona behaves over time, as measured. */
export async function getPersonaBehaviorProfile(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ behaviorProfile: personas.behaviorProfile }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  return rows[0]?.behaviorProfile ?? null;
}

// ─── The way out ────────────────────────────────────────────────────────────

/**
 * Saves a letter the user is taking back to the real person.
 *
 * The text is the user's own words, copied exactly. Nothing here is
 * ever written by the app on their behalf.
 */
export async function createOutboundLetter(data: {
  userId: number;
  personaId: number;
  text: string;
  sourceMessageId?: number | null;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(outboundLetters).values({
    userId: data.userId,
    personaId: data.personaId,
    text: data.text,
    sourceMessageId: data.sourceMessageId ?? null,
    status: data.status ?? "draft",
  }).returning({ id: outboundLetters.id });
  return result.id;
}

/** The letters this user is taking back, newest first. */
export async function getOutboundLetters(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(outboundLetters).where(and(
    eq(outboundLetters.personaId, personaId),
    eq(outboundLetters.userId, userId),
  )).orderBy(desc(outboundLetters.id));
}

/**
 * Moves a letter along: sent, or never mind.
 *
 * Both are recorded rather than deleted, because "I said it" and "I
 * decided not to" are the two endings worth remembering, and neither of
 * them is a failure.
 */
export async function setOutboundLetterStatus(
  id: number,
  userId: number,
  status: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  // The row count comes back so the caller can tell "done" from "there
  // was nothing there". A procedure that answers "yes" to a letter that
  // does not exist is a small lie, and the interface would show it.
  const rows = await db.update(outboundLetters).set({
    status,
    updatedAt: now,
    ...(status === "sent" ? { sentAt: now } : {}),
    ...(status === "dropped" ? { droppedAt: now } : {}),
  }).where(and(eq(outboundLetters.id, id), eq(outboundLetters.userId, userId)))
    .returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/**
 * Records that the letter was pointed out for having waited too long.
 *
 * The reminder is said once. The record is what makes "once" true
 * across sessions — without it the page would say it again every time
 * it was opened, and a reminder that repeats is a nag.
 */
export async function markOutboundLetterStaleNotified(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters)
    .set({ staleNotifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(outboundLetters.id, id), eq(outboundLetters.userId, userId)))
    .returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/** Changes the text of a letter the user is taking back. */
export async function updateOutboundLetterText(
  id: number,
  userId: number,
  text: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters).set({ text, updatedAt: new Date() }).where(and(
    eq(outboundLetters.id, id),
    eq(outboundLetters.userId, userId),
  )).returning({ id: outboundLetters.id });
  return rows.length > 0;
}
