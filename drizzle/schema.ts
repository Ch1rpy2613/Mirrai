import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar, jsonb } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["pending", "analyzing", "ready", "error"]);
export const emotionalStateEnum = pgEnum("emotional_state", ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]);
export const fileTypeEnum = pgEnum("file_type", ["chat_txt", "chat_csv", "image", "video", "collected"]);
export const processStatusEnum = pgEnum("process_status", ["uploaded", "processing", "done", "failed"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const channelEnum = pgEnum("channel", ["web", "wechat", "feishu"]);
export const characterFamilyEnum = pgEnum("character_family", ["colleague", "relationship", "celebrity"]);
export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "intake", "collecting", "analyzing_persona", "analyzing_work",
  "building", "merging", "structuring", "correcting", "complete", "error",
  // The celebrity research flow. PostgreSQL cannot remove enum values, so
  // these only ever get added.
  "researching", "auditing", "synthesizing", "validating",
]);
export const botStatusEnum = pgEnum("bot_status", ["stopped", "scanning", "scaned", "need_verifycode", "logged_in", "error"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "voice", "image"]);
export const memoryCategoryEnum = pgEnum("memory_category", ["milestone", "memory", "anniversary", "anchor"]);
export const graduationStatusEnum = pgEnum("graduation_status", ["suggested", "graduated", "declined"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum().default("user").notNull(),
  /**
   * Bumped whenever the user logs out or changes their password. Sessions carry
   * the value they were minted with, so a mismatch invalidates the token —
   * this is what makes a logout actually revoke access.
   */
  tokenVersion: integer("tokenVersion").default(0).notNull(),
  /**
   * The instance-wide default for the graduation mechanism.
   *
   * "suggest" (the historical behaviour) has the app offer a graduation when
   * the thresholds are met; "manual" leaves the decision entirely to the
   * user; "off" switches the mechanism off. A persona may override this.
   */
  graduationMode: varchar("graduationMode", { length: 16 }).default("suggest").notNull(),
  /**
   * The user's own timezone, as an IANA name ("Asia/Shanghai").
   *
   * The app used the server's clock for everything, which meant a persona
   * in another timezone was greeted as if it were the user's own evening.
   */
  timezone: varchar("timezone", { length: 64 }),
  /**
   * The language this person reads.
   *
   * The interface asks for it on every request, but the things the app
   * sends on its own — a reminder at midnight, a reply in a chat window —
   * have to know it without being asked. So it is kept here.
   */
  locale: varchar("locale", { length: 8 }).default("zh").notNull(),
  /**
   * How the user wants to be addressed.
   *
   * The persona is rebuilt from the other person's chat history, so it
   * knows how *they* talk. It has no idea how the user wants to be
   * called — "宝贝" to someone who has just been through a breakup is
   * not a small thing.
   */
  addressStyle: varchar("addressStyle", { length: 64 }),
  /**
   * Whether the app may read the user's own messages to assess their
   * emotional trajectory.
   *
   * The trajectory is the one place where the app sends a month of raw
   * private conversation to the model. It is what lets the app notice a
   * user who is getting better — but it is also the app reading
   * something the user never wrote for anyone else.
   *
   * "auto" runs it when the graduation mechanism is in its suggesting
   * mode, because that is what the mechanism is for. "on" and "off" are
   * the user's own decision.
   */
  trajectoryAssessment: varchar("trajectoryAssessment", { length: 8 }).default("auto").notNull(),
  /**
   * Things the persona should not bring up.
   *
   * "别提我前任" or "别再提那家餐厅". A line the user can draw, which
   * the persona is told about and respects.
   */
  boundaries: text("boundaries"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  avatarUrl: text("avatarUrl"),
  relationshipDesc: varchar("relationshipDesc", { length: 200 }),
  togetherFrom: varchar("togetherFrom", { length: 50 }),
  togetherTo: varchar("togetherTo", { length: 50 }),
  personaData: jsonb("personaData"),
  analysisStatus: analysisStatusEnum().default("pending").notNull(),
  analysisProgress: integer("analysisProgress").default(0).notNull(),
  analysisMessage: text("analysisMessage"),
  emotionalState: emotionalStateEnum().default("warm").notNull(),
  chatCount: integer("chatCount").default(0).notNull(),
  lastChatAt: timestamp("lastChatAt"),
  skillJobId: integer("skillJobId"),
  llmProvider: varchar("llmProvider", { length: 64 }),
  intimacyScore: integer("intimacyScore").default(0).notNull(),
  intimacyLevel: varchar("intimacyLevel", { length: 50 }).default("acquainted").notNull(),
  activeSceneId: integer("activeSceneId"),
  /**
   * Where this persona came from: "upload" (distilled from chat logs),
   * "questionnaire" (filled in by hand) or "card" (imported from a
   * SillyTavern character card).
   */
  source: varchar("source", { length: 32 }).default("upload").notNull(),
  /** Whether proactive reminders may be delivered for this persona. */
  remindersEnabled: boolean("remindersEnabled").default(true).notNull(),
  /**
   * A log of the corrections the user has made to this persona.
   *
   * Keeping it on the persona makes the changes auditable — a correction is
   * something the user decided, not something the model guessed.
   */
  correctionLog: jsonb("correctionLog"),
  graduationStatus: graduationStatusEnum(),
  graduatedAt: timestamp("graduatedAt"),
  farewellLetter: text("farewellLetter"),
  /**
   * When the graduation was first offered.
   *
   * The suggestion has to be made once, not on every turn — the app
   * nagging about a farewell is the opposite of what it promises.
   */
  graduationSuggestedAt: timestamp("graduationSuggestedAt"),
  /** When the user last declined it; a later suggestion may be made again. */
  graduationDeclinedAt: timestamp("graduationDeclinedAt"),
  /**
   * Whether the persona is around right now.
   *
   * This is separate from `graduationStatus`, which records the *ritual*
   * (has the user said goodbye?). Presence records the *company*:
   *
   *   active — the persona is reachable and the app may reach out
   *   quiet  — the user asked for some space; no outreach, no suggestions
   *   asleep — the persona has graduated and must not disturb anyone
   */
  presence: varchar("presence", { length: 16 }).default("active").notNull(),
  /**
   * Where this persona lives, as an IANA timezone name.
   *
   * The persona's time-of-day awareness is computed in *their* timezone,
   * not the server's — which matters for anyone whose partner is abroad.
   */
  timezone: varchar("timezone", { length: 64 }),
  /**
   * Whether the two of them can currently reach each other.
   *
   * It is a state of the *connection*, not of the relationship: the
   * relationship may be perfectly intact and the two of them simply not
   * be in touch. The app had no way to express that, so "we are apart"
   * and "we broke up" were the same thing, and a person who was simply
   * out of touch was treated as though it were over.
   */
  reachability: varchar("reachability", { length: 16 }).default("reachable").notNull(),
  /**
   * Pinned personas sit at the top of the lobby.
   *
   * A person with six personas and one they talk to every day should not
   * have to hunt for it every morning.
   */
  isPinned: boolean("isPinned").default(false).notNull(),
  /**
   * How often the persona may reach out on its own, in hours.
   *
   * Zero means never. It is the default, and it is a real value rather
   * than a missing one: the product's goal is to help the user finish a
   * relationship, so an app that speaks first is something the user has
   * to buy, not something they get by default.
   */
  proactiveFrequencyHours: integer("proactiveFrequencyHours").default(0).notNull(),
  /**
   * This persona's own graduation mode. Null means "inherit the user's
   * instance default", so changing the default still reaches it.
   */
  graduationMode: varchar("graduationMode", { length: 16 }),
  /**
   * The distillation preset this persona was built with — "fast",
   * "standard", "deep", "colleague" or "celebrity". Null means the
   * standard preset, which is what the app used before the presets existed.
   */
  distillationMode: varchar("distillationMode", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Persona = typeof personas.$inferSelect;
export type InsertPersona = typeof personas.$inferInsert;

export const personaFiles = pgTable("persona_files", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  fileType: fileTypeEnum().notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize").notNull(),
  extractedMemory: text("extractedMemory"),
  processStatus: processStatusEnum().default("uploaded").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaFile = typeof personaFiles.$inferSelect;
export type InsertPersonaFile = typeof personaFiles.$inferInsert;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  role: messageRoleEnum().notNull(),
  content: text("content").notNull(),
  messageType: messageTypeEnum().default("text").notNull(),
  mediaUrl: text("mediaUrl"),
  mediaDuration: integer("mediaDuration"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  /**
   * The message this one replies to.
   *
   * Without it, every reply is a reply to "whatever came last", and a
   * conversation that has been going for a while becomes impossible to
   * follow — which is the thing people are in these conversations to do.
   */
  replyToId: integer("replyToId"),
  /**
   * The memories that were injected into this turn, as a JSON array.
   *
   * The retrieval used to be entirely invisible: the persona would
   * bring up something from three months ago and there was no way to
   * know it had been recalled rather than invented. It has to be
   * written down, or the answer to that question disappears the moment
   * the page is reloaded.
   */
  recalledMemoryIds: text("recalledMemoryIds"),
  /**
   * Where this message came from, when it is not an ordinary turn.
   *
   * "letter" — the answer to a letter the user wrote. It landed in the
   * conversation, but without a marker it was just another message, and
   * the connection to the letter was lost the moment it arrived.
   * "proactive" — the persona spoke first.
   */
  origin: varchar("origin", { length: 16 }),
  channel: channelEnum().default("web").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const wechatBindings = pgTable("wechat_bindings", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  /**
   * The Weixin conversation counterpart id (`ilink_user_id`).
   *
   * In the official ClawBot model the bot is a dedicated "微信ClawBot" contact
   * in the account owner's own WeChat, so this is the owner's own id — not a
   * third-party friend. The row records "this WeChat account talks to this
   * persona by default".
   */
  wechatUserId: varchar("wechatUserId", { length: 255 }).notNull(),
  wechatName: varchar("wechatName", { length: 255 }),
  wechatAlias: varchar("wechatAlias", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // One active default persona per (user, WeChat account).
  // Partial: inactive legacy rows may share the same counterpart id.
  userWechatUnique: uniqueIndex("wechat_bindings_user_wechat_idx")
    .on(table.userId, table.wechatUserId)
    .where(sql`${table.isActive} = true`),
}));

export type WechatBinding = typeof wechatBindings.$inferSelect;
export type InsertWechatBinding = typeof wechatBindings.$inferInsert;

export const skillJobs = pgTable("skill_jobs", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  characterFamily: characterFamilyEnum().default("relationship").notNull(),
  /** The research profile used by the celebrity family, e.g. "budget-unfriendly". */
  researchProfile: varchar("researchProfile", { length: 32 }),
  pipelineStage: pipelineStageEnum().default("intake").notNull(),
  stageProgress: integer("stageProgress").default(0).notNull(),
  stageMessage: text("stageMessage"),
  inputMeta: jsonb("inputMeta"),
  analysisResult: jsonb("analysisResult"),
  generatedSkillPath: varchar("generatedSkillPath", { length: 500 }),
  /** How many times this job has been retried after a failure. */
  retryCount: integer("retryCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type SkillJob = typeof skillJobs.$inferSelect;
export type InsertSkillJob = typeof skillJobs.$inferInsert;

export const llmConfigs = pgTable("llm_configs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  providerName: varchar("providerName", { length: 64 }).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  apiKey: varchar("apiKey", { length: 512 }),
  /** Last 4 characters of the API key, so the UI can show which key is set without revealing it. */
  apiKeyHint: varchar("apiKeyHint", { length: 16 }),
  baseUrl: varchar("baseUrl", { length: 512 }),
  model: varchar("model", { length: 128 }),
  systemMessage: text("systemMessage"),
  extraConfig: jsonb("extraConfig"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmConfig = typeof llmConfigs.$inferSelect;
export type InsertLlmConfig = typeof llmConfigs.$inferInsert;

export const wechatBotState = pgTable("wechat_bot_state", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  status: botStatusEnum().default("stopped").notNull(),
  qrCodeUrl: text("qrCodeUrl"),
  loggedInUser: varchar("loggedInUser", { length: 255 }),
  lastError: text("lastError"),
  /**
   * The iLink bot token, encrypted with a key derived from JWT_SECRET.
   * Equivalent to a WeChat login session — never store this in plaintext.
   */
  botTokenEnc: text("botTokenEnc"),
  /** The iLink bot account id (`ilink_bot_id`). */
  accountId: varchar("accountId", { length: 255 }),
  /** API base URL; may be redirected to another IDC host by the backend. */
  baseUrl: text("baseUrl"),
  /** The account owner's Weixin id (`ilink_user_id`). */
  wechatUserId: varchar("wechatUserId", { length: 255 }),
  /** `get_updates_buf` cursor — must persist or messages are lost on restart. */
  syncBuf: text("syncBuf"),
  /** Timestamp of the last inbound message, used for the 24h keep-alive check. */
  lastInboundAt: timestamp("lastInboundAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type WechatBotState = typeof wechatBotState.$inferSelect;
export type InsertWechatBotState = typeof wechatBotState.$inferInsert;

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  category: memoryCategoryEnum().default("memory").notNull(),
  date: varchar("date", { length: 50 }),
  messageId: integer("messageId"),
  /** Retrieval weight — higher means the memory surfaces more readily. */
  importance: integer("importance").default(1).notNull(),
  /** Pinned memories are always injected into the prompt. */
  isPinned: boolean("isPinned").default(false).notNull(),
  /** When the memory was last surfaced, used to damp repeats. */
  lastRecalledAt: timestamp("lastRecalledAt"),
  /** Structured fact key for anchor memories (e.g. `birthday`). */
  factKey: varchar("factKey", { length: 120 }),
  /**
   * Whose memory this is.
   *
   * "them" is about the persona; "me" is about the user. The two are
   * different kinds of thing: one of them is the other person's life,
   * and the other is the user's — and a persona that treats them the
   * same ends up talking about the user's own life as if it were the
   * persona's.
   */
  subject: varchar("subject", { length: 8 }).default("them").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * When the memories were last extracted.
 *
 * The extraction is a fact about a conversation, so it is kept with the
 * conversation rather than in a settings row.
 */
export const memoryExtractions = pgTable("memory_extractions", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  extractedAt: timestamp("extractedAt").defaultNow().notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

export const emotionSnapshots = pgTable("emotion_snapshots", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  emotionalState: varchar("emotionalState", { length: 50 }).notNull(),
  messageCount: integer("messageCount").default(0).notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmotionSnapshot = typeof emotionSnapshots.$inferSelect;
export type InsertEmotionSnapshot = typeof emotionSnapshots.$inferInsert;

export const diaryEntries = pgTable("diary_entries", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights"),
  emotionalArc: jsonb("emotionalArc"),
  quotes: jsonb("quotes"),
  reflection: text("reflection"),
  messageCount: integer("messageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type InsertDiaryEntry = typeof diaryEntries.$inferInsert;

/**
 * The user's own emotional state, recorded by the user.
 *
 * The app modelled the persona and never the person. Everything the user
 * felt was inferred from what they said *to* the persona and stored as the
 * persona's mood — so the analytics page charted the AI's feelings on the
 * user's own dashboard, and a user in the middle of a breakup had nowhere
 * to put how they were actually doing.
 *
 * One row per day. Checking in again replaces the day's entry, so the
 * act of recording is cheap and repeatable.
 */
export const userMoods = pgTable(
  "user_moods",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    /** The day, as "YYYY-MM-DD" in the user's own time zone. */
    date: varchar("date", { length: 10 }).notNull(),
    mood: varchar("mood", { length: 16 }).notNull(),
    /** A word or two, if the user felt like writing one. */
    note: text("note"),
    /** "manual" when the user recorded it, "inferred" when the app did. */
    source: varchar("source", { length: 16 }).default("manual").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("user_moods_user_date_idx").on(table.userId, table.date),
  }),
);

export type UserMood = typeof userMoods.$inferSelect;
export type InsertUserMood = typeof userMoods.$inferInsert;

/**
 * What actually happened in the relationship.
 *
 * The app simulated a conversation and remembered the other person's
 * milestones, but it had no place to record reality: that the two of them
 * fought last week, that they got back together, that they broke up, that
 * they are simply out of touch. Without that, the persona's sense of the
 * relationship was frozen at whatever the distillation pipeline decided on
 * the day it ran.
 *
 * The events are the user's own record. The app does not guess them.
 */
export const relationshipEvents = pgTable(
  "relationship_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    personaId: integer("personaId").notNull().references(() => personas.id),
    /**
     * What kind of event it is: "together", "apart", "reunion",
     * "breakup", "conflict", "reconciliation", "news", "meetup",
     * "triggered".
     */
    kind: varchar("kind", { length: 24 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    detail: text("detail"),
    /** When it happened, which is not necessarily when it was recorded. */
    happenedAt: timestamp("happenedAt").defaultNow().notNull(),
    recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  },
  (table) => ({
    personaTimeIdx: index("relationship_events_persona_time_idx").on(
      table.personaId,
      table.happenedAt,
    ),
  }),
);

export type RelationshipEvent = typeof relationshipEvents.$inferSelect;
export type InsertRelationshipEvent = typeof relationshipEvents.$inferInsert;

/**
 * A letter the user wrote to the persona.
 *
 * The app had exactly one way to say something: talk to it, and get an
 * answer. But the things people most want to say to somebody they cannot
 * reach are the things they cannot say *to* them — and the reply is
 * sometimes the problem. Writing a letter that is never delivered, and
 * one that is, are two different acts, and both are missing here.
 *
 * A delivered letter is answered late. Instant replies are the one thing
 * that gives the game away, and a person who has waited a day for
 * someone to answer them would not get an answer in three seconds.
 */
export const letters = pgTable(
  "letters",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    personaId: integer("personaId").notNull().references(() => personas.id),
    body: text("body").notNull(),
    /**
     * "letter" — something written to the persona.
     * "todo"   — 「等 TA 回来再说」: a note to yourself, kept for the
     *   moment the two of you are in touch again.
     */
    kind: varchar("kind", { length: 16 }).default("letter").notNull(),
    /** How the user was feeling when they wrote it. */
    mood: varchar("mood", { length: 16 }),
    /**
     * "private" — kept, never answered.
     * "waiting" — delivered, the reply is not due yet.
     * "answered" — the persona has replied.
     */
    status: varchar("status", { length: 16 }).default("private").notNull(),
    /** When the reply is due. */
    replyAt: timestamp("replyAt"),
    repliedAt: timestamp("repliedAt"),
    replyText: text("replyText"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    personaTimeIdx: index("letters_persona_time_idx").on(table.personaId, table.createdAt),
    dueIdx: index("letters_reply_due_idx").on(table.status, table.replyAt),
  }),
);

export type Letter = typeof letters.$inferSelect;
export type InsertLetter = typeof letters.$inferInsert;

export const scenes = pgTable("scenes", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 10 }),
  systemPromptOverlay: text("systemPromptOverlay"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  starters: jsonb("starters"),
  isBuiltin: boolean("isBuiltin").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // A built-in scene is identified by its name, and the seeding routine
  // fills in whatever is missing by name — so two rows with the same name
  // would be indistinguishable. Custom scenes are not covered: the user
  // may name them whatever they like.
  builtinNameUnique: uniqueIndex("scenes_builtin_name_idx")
    .on(table.name).where(sql`${table.isBuiltin} = true`),
}));

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;

/**
 * Applied-schema bookkeeping for `scripts/migrate.mjs`.
 *
 * The project ships hand-written idempotent SQL files rather than a Drizzle
 * journal (`drizzle/meta/` is gitignored, so `drizzle-kit migrate` cannot work
 * on a fresh clone). This table records which of those files have run.
 */
export const schemaMigrations = pgTable("schema_migrations", {
  version: varchar("version", { length: 64 }).primaryKey(),
  appliedAt: timestamp("appliedAt").defaultNow().notNull(),
});

export type SchemaMigration = typeof schemaMigrations.$inferSelect;

// ─── Conversation context compaction ────────────────────────────────────────

/**
 * Rolling summaries of conversations that fell out of the context window.
 *
 * Without these the oldest turns are simply dropped, and the persona forgets
 * everything that happened before the last few dozen messages.
 */
export const chatSummaries = pgTable("chat_summaries", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  summary: text("summary").notNull(),
  fromMessageId: integer("fromMessageId"),
  toMessageId: integer("toMessageId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatSummary = typeof chatSummaries.$inferSelect;
export type InsertChatSummary = typeof chatSummaries.$inferInsert;

// ─── Channels ───────────────────────────────────────────────────────────────

/**
 * A conversation channel the user can talk to a persona through.
 *
 * The WeChat ClawBot channel keeps its own tables for one more release; these
 * are the channel-neutral ones that new channels use.
 */
export const channelBindings = pgTable("channel_bindings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Channel identifier, e.g. "wechat" or "feishu". */
  channel: varchar("channel", { length: 32 }).notNull(),
  /** The conversation on the channel — a chat id, not a user id. */
  targetId: varchar("targetId", { length: 255 }).notNull(),
  targetName: varchar("targetName", { length: 255 }),
  personaId: integer("personaId").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // One active default persona per (user, channel, conversation).
  channelTargetUnique: uniqueIndex("channel_bindings_user_channel_target_idx")
    .on(table.userId, table.channel, table.targetId)
    .where(sql`${table.isActive} = true`),
}));

export type ChannelBinding = typeof channelBindings.$inferSelect;
export type InsertChannelBinding = typeof channelBindings.$inferInsert;

/**
 * Per-user channel state: connection status and encrypted credentials.
 */
export const channelStates = pgTable("channel_states", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  channel: varchar("channel", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("stopped").notNull(),
  /** Credentials, encrypted with a key derived from JWT_SECRET. */
  credentialsEnc: text("credentialsEnc"),
  /** Channel-specific cursor, e.g. the iLink long-poll position. */
  cursor: text("cursor"),
  lastInboundAt: timestamp("lastInboundAt"),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  userChannelUnique: uniqueIndex("channel_states_user_channel_idx")
    .on(table.userId, table.channel),
}));

export type ChannelState = typeof channelStates.$inferSelect;
export type InsertChannelState = typeof channelStates.$inferInsert;

// ─── Persona templates ─────────────────────────────────────────────────────

/**
 * Reusable persona templates.
 *
 * A template is a generalised persona a user can start from. Built-in
 * templates ship as JSON files; these rows hold the user's own.
 */
export const personaTemplates = pgTable("persona_templates", {
  id: serial("id").primaryKey(),
  /** Null for a template that belongs to the installation rather than a user. */
  userId: integer("userId"),
  templateId: varchar("templateId", { length: 100 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  family: varchar("family", { length: 32 }).notNull(),
  description: text("description"),
  tags: jsonb("tags"),
  personaData: jsonb("personaData").notNull(),
  scenePack: jsonb("scenePack"),
  author: varchar("author", { length: 100 }),
  license: varchar("license", { length: 64 }),
  schemaVersion: integer("schemaVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaTemplateRow = typeof personaTemplates.$inferSelect;
export type InsertPersonaTemplate = typeof personaTemplates.$inferInsert;

// ─── Multi-source collection ───────────────────────────────────────────────

/**
 * A platform a chat history can be collected from.
 *
 * The credentials live in `config`, encrypted — they are API tokens for
 * someone else's account.
 */
export const collectionSources = pgTable("collection_sources", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Which platform: "feishu", "dingtalk", "slack", "email", "wechat_export". */
  source: varchar("source", { length: 32 }).notNull(),
  label: varchar("label", { length: 100 }),
  /** The result of the last authorisation check. */
  authState: jsonb("authState"),
  /** Encrypted credentials. */
  config: jsonb("config"),
  status: varchar("status", { length: 32 }).default("stopped").notNull(),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CollectionSource = typeof collectionSources.$inferSelect;
export type InsertCollectionSource = typeof collectionSources.$inferInsert;

/**
 * One collection run.
 *
 * The Python collectors are long-running, so a run is tracked rather than
 * waited on.
 */
export const collectionJobs = pgTable("collection_jobs", {
  id: serial("id").primaryKey(),
  /**
   * The job's own identifier.
   *
   * The job runner uses a UUID, which has to survive a restart — the client
   * polls by it. The serial id stays an internal sequence.
   */
  jobKey: varchar("jobKey", { length: 64 }).notNull(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId"),
  source: varchar("source", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  progress: integer("progress").default(0).notNull(),
  messageCount: integer("messageCount").default(0).notNull(),
  error: text("error"),
  /** Where the raw collector output was written. */
  rawPath: text("rawPath"),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  jobKeyUnique: uniqueIndex("collection_jobs_job_key_idx").on(table.jobKey),
}));

export type CollectionJob = typeof collectionJobs.$inferSelect;
export type InsertCollectionJob = typeof collectionJobs.$inferInsert;

/**
 * Messages collected from another platform.
 *
 * Kept separate from the chat history so a collection can be reviewed before
 * it is imported.
 */
export const collectedMessages = pgTable("collected_messages", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CollectedMessage = typeof collectedMessages.$inferSelect;
export type InsertCollectedMessage = typeof collectedMessages.$inferInsert;

// ─── Celebrity research ────────────────────────────────────────────────────

/**
 * The artefacts of the celebrity research flow.
 *
 * One row per persona and profile, holding what each of the four stages
 * produced.
 */
export const researchProfiles = pgTable("research_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The research profile, e.g. "budget-unfriendly". */
  profile: varchar("profile", { length: 32 }).notNull(),
  /** Stage 1: the structured research notes. */
  notes: jsonb("notes"),
  /** Stage 2: the audit verdict and the gaps it found. */
  audit: jsonb("audit"),
  /** Stage 3: the mental models and known-answer questions. */
  synthesis: jsonb("synthesis"),
  /** Stage 4: the validation result. */
  validation: jsonb("validation"),
  /** The code-level quality gate's report. */
  qualityReport: jsonb("qualityReport"),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ResearchProfile = typeof researchProfiles.$inferSelect;
export type InsertResearchProfile = typeof researchProfiles.$inferInsert;

// ─── Questionnaire answers ─────────────────────────────────────────────────

/**
 * The raw answers from the guided questionnaire.
 *
 * Kept so the user can revisit and edit what they wrote, and so the answers
 * can be re-run through the distillation pipeline later.
 */
export const personaQuestionnaireAnswers = pgTable("persona_questionnaire_answers", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  answers: jsonb("answers").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaQuestionnaireAnswer = typeof personaQuestionnaireAnswers.$inferSelect;
export type InsertPersonaQuestionnaireAnswer = typeof personaQuestionnaireAnswers.$inferInsert;

// ─── Proactive reminders ───────────────────────────────────────────────────

/**
 * A reminder that was (or was about to be) delivered.
 *
 * The row is what stops the same reminder going out twice — "today is your
 * anniversary" should arrive once, not once per scheduler tick.
 */
export const reminderDeliveries = pgTable("reminder_deliveries", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The channel it was delivered on: "wechat", "feishu" or "web". */
  channel: varchar("channel", { length: 32 }).notNull(),
  /** What kind of reminder it was. */
  kind: varchar("kind", { length: 32 }).notNull(),
  /** The text that was delivered, so the web client can show it too. */
  text: text("text"),
  /** A stable key for this reminder on this day, used to deduplicate. */
  dedupeKey: varchar("dedupeKey", { length: 200 }).notNull(),
  scheduledFor: timestamp("scheduledFor").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  dismissedAt: timestamp("dismissedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  dedupeUnique: uniqueIndex("reminder_deliveries_dedupe_idx")
    .on(table.userId, table.dedupeKey),
}));

export type ReminderDelivery = typeof reminderDeliveries.$inferSelect;
export type InsertReminderDelivery = typeof reminderDeliveries.$inferInsert;

// ─── Emotional safety ───────────────────────────────────────────────────────

export const safetyEventTypeEnum = pgEnum("safety_event_type", [
  "crisis", "usage", "dependency", "graduation_trajectory",
]);

export const safetyEventSeverityEnum = pgEnum("safety_event_severity", ["info", "warning", "critical"]);

/**
 * Records of safety interventions.
 *
 * These never leave the machine — the product's privacy promise is that user
 * data is not shipped anywhere.
 */
export const safetyEvents = pgTable("safety_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId"),
  type: safetyEventTypeEnum().notNull(),
  severity: safetyEventSeverityEnum().default("info").notNull(),
  /** Short, non-identifying note about what triggered the event. */
  excerpt: text("excerpt"),
  handled: boolean("handled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type InsertSafetyEvent = typeof safetyEvents.$inferInsert;

/**
 * Weekly emotional-trajectory assessments, used to notice that a user is
 * moving towards closure even before the hard graduation thresholds are met.
 */
export const graduationAssessments = pgTable("graduation_assessments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  windowStart: timestamp("windowStart").notNull(),
  windowEnd: timestamp("windowEnd").notNull(),
  trajectory: varchar("trajectory", { length: 32 }).notNull(),
  regretRatio: integer("regretRatio").default(0).notNull(),
  gratitudeRatio: integer("gratitudeRatio").default(0).notNull(),
  assessment: jsonb("assessment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GraduationAssessment = typeof graduationAssessments.$inferSelect;
export type InsertGraduationAssessment = typeof graduationAssessments.$inferInsert;
