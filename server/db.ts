import { eq, desc, and, sql, count, sum, gte, ilike, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
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

export async function deleteUserAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(eq(memories.userId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
  await db.delete(messages).where(eq(messages.userId, id));
  await db.delete(personaFiles).where(eq(personaFiles.userId, id));
  await db.delete(wechatBindings).where(eq(wechatBindings.userId, id));
  await db.delete(llmConfigs).where(eq(llmConfigs.userId, id));
  await db.delete(personas).where(eq(personas.userId, id));
  await db.delete(users).where(eq(users.id, id));
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

export async function deletePersona(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(memories).where(eq(memories.personaId, id));
  await db.delete(emotionSnapshots).where(eq(emotionSnapshots.personaId, id));
  await db.delete(messages).where(eq(messages.personaId, id));
  await db.delete(personaFiles).where(eq(personaFiles.personaId, id));
  await db.delete(wechatBindings).where(eq(wechatBindings.personaId, id));
  await db.delete(skillJobs).where(eq(skillJobs.personaId, id));
  await db.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

// ─── PersonaFile helpers ────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data).returning({ id: personaFiles.id });
  return result.id;
}

export async function getFilesByPersonaId(personaId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaFiles).where(eq(personaFiles.personaId, personaId)).orderBy(desc(personaFiles.createdAt));
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(messages).values(data).returning({ id: messages.id });
  return result.id;
}

export async function getMessagesByPersonaId(personaId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(eq(messages.personaId, personaId)).orderBy(desc(messages.createdAt)).limit(limit);
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
  return result.id;
}

export async function getWechatBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(eq(wechatBindings.userId, userId));
}

export async function getWechatBindingByContactId(contactId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(eq(wechatBindings.wechatContactId, contactId), eq(wechatBindings.isActive, true))).limit(1);
  return result[0];
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

export async function getSkillJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs).where(eq(skillJobs.id, id)).limit(1);
  return result[0];
}

export async function updateSkillJob(id: number, data: Partial<InsertSkillJob>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(skillJobs).set(data).where(eq(skillJobs.id, id));
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
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
  await db.update(llmConfigs).set({ isDefault: true })
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, providerName)));
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

export async function upsertWechatBotState(userId: number, data: Partial<{ status: string; qrCodeUrl: string | null; loggedInUser: string | null; lastError: string | null }>) {
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

// ─── Intimacy helpers ─────────────────────────────────────────────────────

export async function getIntimacyData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const persona = await db.select({ chatCount: personas.chatCount, createdAt: personas.createdAt }).from(personas)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.personaId, personaId));
  const [memCount] = await db.select({ c: count() }).from(memories).where(eq(memories.personaId, personaId));
  const emotionRows = await db.select({ s: emotionSnapshots.emotionalState }).from(emotionSnapshots)
    .where(eq(emotionSnapshots.personaId, personaId)).groupBy(emotionSnapshots.emotionalState);
  const daysSinceCreation = Math.floor((Date.now() - new Date(persona[0].createdAt).getTime()) / 86400000);
  const recentDays = await db.select({ d: sql<string>`DATE(${messages.createdAt})` }).from(messages)
    .where(eq(messages.personaId, personaId)).groupBy(sql`DATE(${messages.createdAt})`).orderBy(desc(sql`DATE(${messages.createdAt})`)).limit(30);
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

export async function getMemoriesByPersonaId(personaId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(memories).where(eq(memories.personaId, personaId)).orderBy(desc(memories.createdAt));
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

export async function getEmotionSnapshots(personaId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(personaId: number, days = 30) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  const since = new Date();
  since.setDate(since.getDate() - days);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)))
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

export async function getSceneById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
  return row || null;
}

export async function createScene(data: InsertScene) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(scenes).values(data).returning();
  return row;
}

export async function deleteScene(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scenes).where(and(eq(scenes.id, id), eq(scenes.isBuiltin, false)));
}

export async function activateScene(personaId: number, sceneId: number | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ activeSceneId: sceneId, updatedAt: new Date() }).where(eq(personas.id, personaId));
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
    .where(eq(memories.personaId, personaId))
    .orderBy(asc(memories.createdAt));
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(eq(emotionSnapshots.personaId, personaId))
    .orderBy(asc(emotionSnapshots.date));
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date));
  return { persona, messages: allMessages, memories: allMemories, emotionSnapshots: allSnapshots, diaryEntries: allDiaries };
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(personaId: number, days: number = 14) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), gte(emotionSnapshots.createdAt, since)));
}

export async function getMessageCountInRange(personaId: number, startDaysAgo: number, endDaysAgo: number) {
  const db = await getDb();
  if (!db) return 0;
  const start = new Date(); start.setDate(start.getDate() - startDaysAgo);
  const end = new Date(); end.setDate(end.getDate() - endDaysAgo);
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      eq(messages.personaId, personaId),
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
