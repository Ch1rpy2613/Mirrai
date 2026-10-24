import { eq, desc, and, or, sql, count, sum, gte, ilike, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes,
  chatSummaries, safetyEvents, graduationAssessments,
  channelBindings, channelStates, personaTemplates, personaQuestionnaireAnswers,
  reminderDeliveries, researchProfiles, collectedMessages, collectionSources,
  collectionJobs,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
  InsertChatSummary, InsertSafetyEvent, InsertGraduationAssessment,
  InsertChannelBinding, InsertPersonaTemplate, InsertPersonaQuestionnaireAnswer,
  InsertResearchProfile, InsertCollectedMessage, InsertCollectionSource,
  InsertCollectionJob,
} from "../drizzle/schema";

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

export async function createUser(data: { username: string; passwordHash: string; name: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
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

export async function updateUserProfile(id: number, data: { name?: string; email?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, id));
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
    await tx.delete(channelStates).where(eq(channelStates.userId, id));
    await tx.delete(chatSummaries).where(eq(chatSummaries.userId, id));
    await tx.delete(collectedMessages).where(eq(collectedMessages.userId, id));
    await tx.delete(collectionJobs).where(eq(collectionJobs.userId, id));
    await tx.delete(collectionSources).where(eq(collectionSources.userId, id));
    await tx.delete(diaryEntries).where(eq(diaryEntries.userId, id));
    await tx.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
    await tx.delete(graduationAssessments).where(eq(graduationAssessments.userId, id));
    await tx.delete(llmConfigs).where(eq(llmConfigs.userId, id));
    await tx.delete(memories).where(eq(memories.userId, id));
    await tx.delete(messages).where(eq(messages.userId, id));
    await tx.delete(personaFiles).where(eq(personaFiles.userId, id));
    await tx.delete(personaQuestionnaireAnswers).where(eq(personaQuestionnaireAnswers.userId, id));
    await tx.delete(personaTemplates).where(eq(personaTemplates.userId, id));
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, id));
    await tx.delete(researchProfiles).where(eq(researchProfiles.userId, id));
    await tx.delete(safetyEvents).where(eq(safetyEvents.userId, id));
    await tx.delete(scenes).where(eq(scenes.userId, id));
    await tx.delete(skillJobs).where(eq(skillJobs.userId, id));
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
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(messages.createdAt);
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

export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  const result = [];
  for (const p of list) {
    const [lastMsgRow] = await db.select({ content: messages.content, createdAt: messages.createdAt })
      .from(messages).where(eq(messages.personaId, p.id)).orderBy(desc(messages.createdAt)).limit(1);
    const [fileCountRow] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.personaId, p.id));
    const [bindingRow] = await db.select({ c: count() }).from(wechatBindings)
      .where(and(eq(wechatBindings.personaId, p.id), eq(wechatBindings.isActive, true)));
    result.push({
      ...p,
      lastMessage: lastMsgRow ? { content: (lastMsgRow.content || "").slice(0, 60), createdAt: lastMsgRow.createdAt } : null,
      fileCount: fileCountRow?.c || 0,
      wechatBound: (bindingRow?.c || 0) > 0,
    });
  }
  return result;
}

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const today = new Date(); today.setHours(0, 0, 0, 0);
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
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.personaId, id), eq(chatSummaries.userId, userId)));
    await tx.delete(collectedMessages).where(and(eq(collectedMessages.personaId, id), eq(collectedMessages.userId, userId)));
    await tx.delete(collectionJobs).where(and(eq(collectionJobs.personaId, id), eq(collectionJobs.userId, userId)));
    await tx.delete(diaryEntries).where(and(eq(diaryEntries.personaId, id), eq(diaryEntries.userId, userId)));
    await tx.delete(emotionSnapshots).where(and(eq(emotionSnapshots.personaId, id), eq(emotionSnapshots.userId, userId)));
    await tx.delete(graduationAssessments).where(and(eq(graduationAssessments.personaId, id), eq(graduationAssessments.userId, userId)));
    await tx.delete(memories).where(and(eq(memories.personaId, id), eq(memories.userId, userId)));
    await tx.delete(messages).where(and(eq(messages.personaId, id), eq(messages.userId, userId)));
    await tx.delete(personaFiles).where(and(eq(personaFiles.personaId, id), eq(personaFiles.userId, userId)));
    await tx.delete(personaQuestionnaireAnswers).where(and(eq(personaQuestionnaireAnswers.personaId, id), eq(personaQuestionnaireAnswers.userId, userId)));
    await tx.delete(reminderDeliveries).where(and(eq(reminderDeliveries.personaId, id), eq(reminderDeliveries.userId, userId)));
    await tx.delete(researchProfiles).where(and(eq(researchProfiles.personaId, id), eq(researchProfiles.userId, userId)));
    await tx.delete(safetyEvents).where(and(eq(safetyEvents.personaId, id), eq(safetyEvents.userId, userId)));
    await tx.delete(skillJobs).where(and(eq(skillJobs.personaId, id), eq(skillJobs.userId, userId)));
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

export async function getFilesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaFiles)
    .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
    .orderBy(desc(personaFiles.createdAt));
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(messages).values(data).returning({ id: messages.id });
  return result.id;
}

export async function getMessagesByPersonaId(personaId: number, userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function clearMessagesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(messages).where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${query}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
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

export async function deleteWechatBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(wechatBindings).where(and(eq(wechatBindings.id, id), eq(wechatBindings.userId, userId)));
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

export async function setDefaultLlmConfig(userId: number, providerName: string) {
  await withTransaction(async (tx) => {
    await tx.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
    await tx.update(llmConfigs).set({ isDefault: true })
      .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, providerName)));
  });
}

export async function getDefaultLlmConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  return rows[0] ?? null;
}

// ─── Daily Activity helpers ────────────────────────────────────────────────

export async function getDailyChatCounts(userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await db.select({
    date: sql<string>`DATE(${messages.createdAt})`,
    count: count(),
  })
    .from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`);
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
  const recentDays = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(desc(sql`DATE(${messages.createdAt})`)).limit(30);
  let consecutiveDays = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < recentDays.length; i++) {
    const expected = new Date(today); expected.setDate(expected.getDate() - i);
    if (recentDays[i].d === expected.toISOString().slice(0, 10)) consecutiveDays++;
    else break;
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

export async function getMemoriesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Pinned first, then by weight, then newest. The retrieval scorer does
  // its own ranking, but a low-weight memory should not be invisible to it
  // just because it is old — the candidate list is capped, so the order
  // decides what gets scored at all.
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.isPinned), desc(memories.importance), desc(memories.createdAt))
    .limit(200);
}

export async function deleteMemory(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Emotion Snapshot helpers ─────────────────────────────────────────────

export async function createEmotionSnapshot(data: InsertEmotionSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(emotionSnapshots).values(data).returning({ id: emotionSnapshots.id });
  return result.id;
}

export async function getEmotionSnapshots(personaId: number, userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(personaId: number, userId: number, days = 30) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  const since = new Date();
  since.setDate(since.getDate() - days);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ))
    .groupBy(emotionSnapshots.emotionalState);
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  return { snapshots, distribution, totalDays: snapshots.length, totalMessages };
}

export async function getTodaySnapshot(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId), eq(emotionSnapshots.date, today)))
    .limit(1);
  return rows[0];
}

// ─── Analytics helpers ────────────────────────────────────────────────────

export async function getMessageVolume(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({ date: sql<string>`DATE(${messages.createdAt})`, count: count() })
    .from(messages).where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
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

export async function getHourlyDistribution(userId: number, days: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.select({
    hour: sql<number>`EXTRACT(HOUR FROM ${messages.createdAt})::int`,
    count: count(),
  }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`EXTRACT(HOUR FROM ${messages.createdAt})`);
}

export async function getAnalyticsStats(userId: number, days: number) {
  const db = await getDb();
  if (!db) return { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };
  const since = new Date(); since.setDate(since.getDate() - days);
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)));
  const activeDaysRows = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(sql`DATE(${messages.createdAt})`).orderBy(sql`DATE(${messages.createdAt})`);
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
  return { totalMessages: msgCount?.c || 0, activeDays, longestStreak, avgPerDay: activeDays > 0 ? Math.round((msgCount?.c || 0) / activeDays) : 0 };
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

export async function deleteDiaryEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(diaryEntries).where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)));
}

export async function getMessagesByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), sql`DATE(${messages.createdAt}) = ${date}`))
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

const BUILTIN_SCENES: InsertScene[] = [
  { name: "一起看电影", icon: "🎬", description: "窝在沙发上一起看电影，分享感受", systemPromptOverlay: "你们正在一起看电影，气氛温馨浪漫。你会评论剧情、分享感受，偶尔靠近对方。", emotionalState: "warm", starters: ["今天想看什么类型的电影？", "我准备好爆米花了~", "上次那部电影你还记得吗？"], isBuiltin: true },
  { name: "深夜聊天", icon: "🌙", description: "夜深人静，说些白天不会说的话", systemPromptOverlay: "现在是深夜，周围很安静。你的语气更加柔软、私密，愿意分享内心深处的想法和感受。", emotionalState: "nostalgic", starters: ["睡不着吗？", "夜深了，在想什么呢...", "这个时间特别想你"], isBuiltin: true },
  { name: "吵架和好", icon: "💔", description: "经历小摩擦后的和解", systemPromptOverlay: "你们之间刚发生了一点小矛盾，你有些委屈但也想和好。语气带着一点赌气但又舍不得真的生气。", emotionalState: "melancholy", starters: ["你还在生气吗...", "我不是故意的", "我们别吵了好不好"], isBuiltin: true },
  { name: "一起旅行", icon: "✈️", description: "想象一起去远方旅行", systemPromptOverlay: "你们正在一起旅行，心情愉快兴奋。你会描述看到的风景、分享旅途趣事，充满期待和快乐。", emotionalState: "happy", starters: ["下一站想去哪里？", "快看那边的风景！", "旅途中最开心的就是有你在身边"], isBuiltin: true },
  { name: "纪念日", icon: "🎂", description: "庆祝你们的特别日子", systemPromptOverlay: "今天是你们的纪念日，你特别开心和感动。你会回忆过去的美好时光，表达珍惜和感恩。", emotionalState: "happy", starters: ["今天是我们的特别日子呢", "还记得我们第一次见面吗？", "谢谢你一直在我身边"], isBuiltin: true },
];

async function seedBuiltinScenes(db: ReturnType<typeof drizzle>) {
  const existing = await db.select({ id: scenes.id }).from(scenes).where(eq(scenes.isBuiltin, true)).limit(1);
  if (existing.length > 0) return;
  for (const s of BUILTIN_SCENES) {
    await db.insert(scenes).values(s);
  }
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

export async function getExportData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [persona] = await db.select().from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt));
  const allMemories = await db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(asc(memories.createdAt));
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .orderBy(asc(emotionSnapshots.date));
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date));
  return { persona, messages: allMessages, memories: allMemories, emotionSnapshots: allSnapshots, diaryEntries: allDiaries };
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(personaId: number, userId: number, days: number = 14) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.createdAt, since),
    ));
}

export async function getMessageCountInRange(
  personaId: number,
  userId: number,
  startDaysAgo: number,
  endDaysAgo: number,
) {
  const db = await getDb();
  if (!db) return 0;
  const start = new Date(); start.setDate(start.getDate() - startDaysAgo);
  const end = new Date(); end.setDate(end.getDate() - endDaysAgo);
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
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const data: Record<string, any> = { graduationStatus: status, updatedAt: new Date() };
  if (status === "graduated") {
    data.graduatedAt = new Date();
    if (farewellLetter) data.farewellLetter = farewellLetter;
  }
  if (status === null) {
    data.graduatedAt = null;
    data.farewellLetter = null;
    data.graduationStatus = null;
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

export async function getChatSummaries(personaId: number, userId: number, limit = 3) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chatSummaries)
    .where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)))
    .orderBy(desc(chatSummaries.createdAt)).limit(limit);
}

// ─── Safety event helpers ──────────────────────────────────────────────────

export async function createSafetyEvent(data: InsertSafetyEvent) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(safetyEvents).values(data).returning({ id: safetyEvents.id });
  return result.id;
}

export async function getSafetyEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(safetyEvents)
    .where(eq(safetyEvents.userId, userId))
    .orderBy(desc(safetyEvents.createdAt)).limit(limit);
}

export async function resolveSafetyEvent(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(safetyEvents).set({ resolvedAt: new Date(), handled: true })
    .where(and(eq(safetyEvents.id, id), eq(safetyEvents.userId, userId)));
}

// ─── Graduation trajectory helpers ─────────────────────────────────────────

export async function createGraduationAssessment(data: InsertGraduationAssessment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(graduationAssessments).values(data)
    .returning({ id: graduationAssessments.id });
  return result.id;
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

export async function createChannelBinding(data: InsertChannelBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(channelBindings).values(data).returning({ id: channelBindings.id });
  return result.id;
}

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

export async function deleteChannelBinding(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(channelBindings)
    .where(and(eq(channelBindings.id, id), eq(channelBindings.userId, userId)));
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

/** Lists the users that have state for a channel, used to restore on boot. */
export async function getChannelStateUsers(channel: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: channelStates.userId })
    .from(channelStates)
    .where(eq(channelStates.channel, channel));
  return Array.from(new Set(rows.map((r) => r.userId)));
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

export async function updateUserTemplate(
  id: number,
  userId: number,
  data: Partial<InsertPersonaTemplate>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(personaTemplates).set(data)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)));
}

export async function deleteUserTemplate(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(personaTemplates)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)));
}

// ─── Questionnaire helpers ─────────────────────────────────────────────────

export async function createQuestionnaireAnswers(data: InsertPersonaQuestionnaireAnswer) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaQuestionnaireAnswers).values(data)
    .returning({ id: personaQuestionnaireAnswers.id });
  return result.id;
}

export async function getQuestionnaireAnswers(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaQuestionnaireAnswers)
    .where(and(
      eq(personaQuestionnaireAnswers.personaId, personaId),
      eq(personaQuestionnaireAnswers.userId, userId),
    ))
    .orderBy(desc(personaQuestionnaireAnswers.createdAt));
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
export async function createResearchProfile(data: InsertResearchProfile) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(researchProfiles).values(data)
    .returning({ id: researchProfiles.id });
  return result.id;
}

/** Updates the research artefacts of an existing row. */
export async function updateResearchProfile(
  id: number,
  userId: number,
  data: Partial<InsertResearchProfile>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(researchProfiles).set(data)
    .where(and(eq(researchProfiles.id, id), eq(researchProfiles.userId, userId)));
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
 * The messages already collected for a persona from a source.
 *
 * Used to make an import idempotent: re-running a collection must not
 * duplicate the messages.
 */
export async function getCollectedMessages(
  personaId: number,
  userId: number,
  source: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectedMessages).where(and(
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
export async function getCollectedMessagesForPersona(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
  )).orderBy(asc(collectedMessages.createdAt));
}

// ─── Collection source helpers ────────────────────────────────────────────

export async function getCollectionSources(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectionSources)
    .where(eq(collectionSources.userId, userId))
    .orderBy(desc(collectionSources.createdAt));
}

export async function upsertCollectionSource(data: InsertCollectionSource) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionSources).values(data)
    .returning({ id: collectionSources.id });
  return result.id;
}

// ─── Collection job helpers ───────────────────────────────────────────────

export async function createCollectionJob(data: InsertCollectionJob) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionJobs).values(data)
    .returning({ id: collectionJobs.id });
  return result.id;
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

export async function getCollectionJobs(userId?: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(collectionJobs);
  const rows = userId !== undefined
    ? await query.where(eq(collectionJobs.userId, userId))
        .orderBy(desc(collectionJobs.createdAt)).limit(limit)
    : await query.orderBy(desc(collectionJobs.createdAt)).limit(limit);
  return rows;
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
    remindersEnabled: personas.remindersEnabled,
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

export async function dismissReminder(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(reminderDeliveries).set({ dismissedAt: new Date() })
    .where(and(eq(reminderDeliveries.id, id), eq(reminderDeliveries.userId, userId)));
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
export async function getMessagesSince(personaId: number, userId: number, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
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

/** Counts a user's messages since a point in time. */
export async function getMessageCountSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)));
  return result?.c || 0;
}
