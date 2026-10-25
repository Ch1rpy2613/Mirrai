import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * What the database helpers actually do.
 *
 * The two structural tests that guard this file's neighbours —
 * `db-isolation.test.ts`, which insists that every helper with an id
 * filters by user, and `db-delete-coverage.test.ts`, which insists that
 * deleting an account leaves nothing behind — are about the *shape* of
 * the code. They cannot tell whether `getWaitingNotes` returns the notes
 * that are waiting rather than the ones that were answered, or whether
 * `getMessagesBefore` hands them back oldest-first.
 *
 * So this file is about behaviour: the rows that come back, the order they
 * come back in, and the conditions they were fetched under.
 *
 * The database is a fake that records the query it was asked to run. The
 * conditions are checked by turning Drizzle's expression into the SQL it
 * would send, so "filters by user" is a claim about the actual statement
 * rather than about the shape of a function call.
 */

const dialect = new PgDialect();

/** What the fake database should answer. */
interface Registry {
  /** The rows a select returns, by table name. */
  select: Record<string, any[]>;
  /** The rows a write returns when it asks for them, by table name. */
  returning: Record<string, any[]>;
}

/** The rows the fake is about to answer with. */
let registry: Registry = { select: {}, returning: {} };

/** Every query the fake was asked to run, in order. */
interface QueryLog {
  /** The table the query was against. */
  table: string;
  /** The method that started it. */
  operation: "select" | "insert" | "update" | "delete";
  /** The conditions it was filtered by. */
  where: any[];
  /** The order it was asked for. */
  orderBy: any[];
  /** The limit it was given. */
  limit?: number;
  /** The values it was writing. */
  values?: any;
  /** Whether it asked for the written rows back. */
  returned: boolean;
}

let queries: QueryLog[] = [];

/** One step of a query. */
class FakeQuery {
  private log: QueryLog;

  constructor(operation: QueryLog["operation"]) {
    this.log = {
      table: "",
      operation,
      where: [],
      orderBy: [],
      returned: false,
    };
    queries.push(this.log);
  }

  select(..._args: any[]) {
    return this;
  }

  from(table: any) {
    this.log.table = getTableName(table);
    return this;
  }

  /**
   * The table a write is against.
   *
   * A write does not call `from` — it is given the table when the write
   * starts — so the name has to be recorded there.
   */
  setTable(table: any) {
    this.log.table = getTableName(table);
    return this;
  }

  where(condition: any) {
    this.log.where.push(condition);
    return this;
  }

  orderBy(expression: any) {
    this.log.orderBy.push(expression);
    return this;
  }

  groupBy(_expression: any) {
    return this;
  }

  limit(count: number) {
    this.log.limit = count;
    return this;
  }

  offset(_count: number) {
    return this;
  }

  set(values: any) {
    this.log.values = values;
    return this;
  }

  values(values: any) {
    this.log.values = values;
    return this;
  }

  returning(_fields?: any) {
    this.log.returned = true;
    return this;
  }

  onConflictDoNothing() {
    return this;
  }

  onConflictDoUpdate(config: any) {
    this.log.values = { ...(this.log.values ?? {}), __conflict: config };
    return this;
  }

  /** The rows the fake answers with. */
  private rows(): any[] {
    if (this.log.operation === "select") {
      return registry.select[this.log.table] ?? [];
    }
    if (this.log.returned) {
      return registry.returning[this.log.table] ?? [];
    }
    return [];
  }

  then(resolve: (value: any) => any, reject: (reason: any) => any) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

/** The fake database the module under test gets. */
const fakeDb = {
  select: () => new FakeQuery("select"),
  insert: (table: any) => new FakeQuery("insert").setTable(table),
  update: (table: any) => new FakeQuery("update").setTable(table),
  delete: (table: any) => new FakeQuery("delete").setTable(table),
  transaction: async (callback: (tx: any) => Promise<any>) => callback(fakeDb),
};

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => fakeDb,
}));

// The module reads the connection string before it will try to connect.
process.env.DATABASE_URL = "postgres://test/test";

import * as db from "./db";

/** The SQL a condition would send, with its parameters. */
function sqlOf(condition: any): { sql: string; params: any[] } {
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
}

/** Every condition of the last query, as SQL. */
function whereOf(index = queries.length - 1): Array<{ sql: string; params: any[] }> {
  return queries[index].where.map(sqlOf);
}

/** The order of the last query, as SQL. */
function orderOf(index = queries.length - 1): Array<{ sql: string; params: any[] }> {
  return queries[index].orderBy.map(sqlOf);
}

/** The last query that ran. */
function last(): QueryLog {
  return queries[queries.length - 1];
}

beforeEach(() => {
  registry = { select: {}, returning: {} };
  queries = [];
});

describe("the letters", () => {
  it("lists a persona's letters newest first", async () => {
    registry.select.letters = [{ id: 1 }, { id: 2 }];
    const rows = await db.getLetters(7, 3);

    expect(rows).toHaveLength(2);
    expect(whereOf()[0].sql).toContain('"letters"."personaId"');
    expect(whereOf()[0].params).toContain(7);
    expect(whereOf()[0].sql).toContain('"letters"."userId"');
    expect(whereOf()[0].params).toContain(3);
    expect(orderOf()[0].sql).toContain('"letters"."createdAt" desc');
    expect(last().limit).toBe(50);
  });

  it("lists only the notes that are waiting", async () => {
    registry.select.letters = [{ id: 1, kind: "todo" }];
    const rows = await db.getWaitingNotes(7, 3);

    expect(rows).toHaveLength(1);
    // The kind is what separates a note for later from a letter that was
    // written and handed over.
    const conditions = whereOf().map((c) => c.sql).join(" ");
    expect(conditions).toContain('"letters"."kind"');
    expect(whereOf().flatMap((c) => c.params)).toContain("todo");
    expect(orderOf()[0].sql).toContain('"letters"."createdAt" desc');
  });

  it("says whether a letter was deleted", async () => {
    registry.returning.letters = [{ id: 5 }];
    expect(await db.deleteLetter(5, 3)).toBe(true);

    registry.returning.letters = [];
    expect(await db.deleteLetter(5, 3)).toBe(false);
  });

  it("pushes a letter's reply further out", async () => {
    registry.returning.letters = [{ id: 5, replyAt: new Date("2026-02-01") }];
    const replyAt = new Date("2026-02-01");
    const row = await db.deferLetter(5, 3, replyAt);

    expect(row?.replyAt).toEqual(replyAt);
    expect(last().values).toEqual({ replyAt });
  });
});

describe("the user's own mood", () => {
  it("records the note as nothing when there is none", async () => {
    registry.returning.user_moods = [{ id: 1 }];
    await db.upsertUserMood({ userId: 3, date: "2026-01-02", mood: "okay" });

    const written = last().values;
    expect(written.mood).toBe("okay");
    expect(written.note).toBeNull();
    // The source says who wrote it down, and "manual" is the person.
    expect(written.source).toBe("manual");
  });

  it("keeps the note when there is one", async () => {
    registry.returning.user_moods = [{ id: 1 }];
    await db.upsertUserMood({
      userId: 3,
      date: "2026-01-02",
      mood: "down",
      note: "今天有点累",
      source: "chat",
    });

    expect(last().values.note).toBe("今天有点累");
    expect(last().values.source).toBe("chat");
  });

  it("lists the moods oldest first, so the trend reads left to right", async () => {
    registry.select.user_moods = [{ date: "2026-01-01" }];
    await db.getUserMoods(3, 7);

    expect(orderOf()[0].sql).toContain('"user_moods"."date" asc');
  });

  it("remembers the language the user chose", async () => {
    await db.setUserLocale(3, "en");
    expect(last().values).toEqual({ locale: "en" });
    expect(whereOf()[0].params).toContain(3);
  });
});

describe("a single message", () => {
  it("is only returned to the user who wrote it", async () => {
    registry.select.messages = [{ id: 4, content: "在吗" }];
    const row = await db.getMessageById(4, 3);

    expect(row?.content).toBe("在吗");
    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });

  it("is nothing when there is no such message", async () => {
    registry.select.messages = [];
    expect(await db.getMessageById(4, 3)).toBeNull();
  });

  it("hands back the messages before it oldest first", async () => {
    registry.select.messages = [{ id: 9 }, { id: 8 }, { id: 7 }];
    const rows = await db.getMessagesBefore(1, 3, 10);

    // The query asks for the newest of them, and the helper reverses them,
    // so a conversation that is loaded in pages reads in order.
    expect(orderOf()[0].sql).toContain('"messages"."id" desc');
    expect(rows.map((r: any) => r.id)).toEqual([7, 8, 9]);
  });

  it("says whether there is more of the conversation to load", async () => {
    registry.select.messages = [{ id: 1 }];
    expect(await db.hasOlderMessages(1, 3, 10)).toBe(true);

    registry.select.messages = [];
    expect(await db.hasOlderMessages(1, 3, 10)).toBe(false);
  });

  it("finds the message before a given one", async () => {
    registry.select.messages = [
      { id: 1, content: "第一句" },
      { id: 2, content: "第二句" },
      { id: 3, content: "第三句" },
    ];
    const row = await db.getPreviousMessage(1, 3, 3);

    expect(row?.content).toBe("第二句");
    expect(orderOf()[0].sql).toContain('"messages"."createdAt" asc');
  });

  it("has no previous message for the first one", async () => {
    registry.select.messages = [{ id: 1, content: "第一句" }];
    expect(await db.getPreviousMessage(1, 3, 1)).toBeNull();
  });

  it("edits only what the user wrote", async () => {
    registry.returning.messages = [{ id: 4 }];
    expect(await db.updateUserMessage(4, 3, "改过的")).toBe(true);

    // The role is part of the condition: the persona's own words are not
    // the user's to edit.
    const conditions = whereOf().map((c) => c.sql).join(" ");
    expect(conditions).toContain('"messages"."role"');
    expect(whereOf().flatMap((c) => c.params)).toContain("user");
    expect(last().values).toEqual({ content: "改过的" });
  });

  it("says whether a message was edited", async () => {
    registry.returning.messages = [];
    expect(await db.updateUserMessage(4, 3, "改过的")).toBe(false);
  });

  it("says whether a message was deleted", async () => {
    registry.returning.messages = [{ id: 4 }];
    expect(await db.deleteMessage(4, 3)).toBe(true);

    registry.returning.messages = [];
    expect(await db.deleteMessage(4, 3)).toBe(false);
  });

  it("deletes a message and everything after it", async () => {
    registry.select.messages = [{ id: 4, createdAt: new Date("2026-01-02T00:00:00Z") }];
    registry.returning.messages = [{ id: 4 }, { id: 5 }, { id: 6 }];

    const deleted = await db.deleteMessagesFrom(4, 3);

    expect(deleted).toBe(3);
    // The deletion is by time, not by id: the messages after it are the
    // ones that came later.
    expect(whereOf(queries.length - 1).flatMap((c) => c.params)).toContain(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("deletes nothing when the message to delete is not there", async () => {
    registry.select.messages = [];
    expect(await db.deleteMessagesFrom(4, 3)).toBe(0);
  });
});

describe("searching everything", () => {
  it("looks in the messages, the memories and the diary", async () => {
    const now = new Date("2026-01-02T00:00:00Z");
    registry.select.messages = [{ id: 1, kind: "message", createdAt: now, content: "电影" }];
    registry.select.memories = [{ id: 2, kind: "memory", createdAt: new Date("2026-01-01"), title: "那只猫" }];
    registry.select.diary_entries = [{ id: 3, kind: "diary", createdAt: new Date("2025-12-01"), content: "下雨" }];

    const rows = await db.searchAllMessages(3, "猫");

    // The three sources are one result list.
    expect(rows.map((r: any) => r.kind)).toEqual(["message", "memory", "diary"]);
    // The newest first.
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(rows[2].createdAt.getTime());
  });

  it("escapes the wildcards, so a percent sign is a percent sign", async () => {
    registry.select.messages = [];
    registry.select.memories = [];
    registry.select.diary_entries = [];

    await db.searchAllMessages(3, "50%");

    // The pattern is a parameter, so the value cannot become a wildcard.
    const patterns = queries
      .flatMap((q) => q.where)
      .map(sqlOf)
      .flatMap((q) => q.params)
      .filter((p: any) => typeof p === "string" && p.includes("%"));
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(String(pattern)).toContain("\\%");
    }
  });

  it("never returns more than the limit", async () => {
    const now = new Date("2026-01-02T00:00:00Z");
    registry.select.messages = [
      { id: 1, kind: "message", createdAt: now },
      { id: 2, kind: "message", createdAt: now },
      { id: 3, kind: "message", createdAt: now },
    ];
    registry.select.memories = [];
    registry.select.diary_entries = [];

    const rows = await db.searchAllMessages(3, "猫", 2);
    expect(rows).toHaveLength(2);
  });
});

describe("the memories", () => {
  it("counts them", async () => {
    registry.select.memories = [{ c: 4 }];
    expect(await db.countMemories(1, 3)).toBe(4);
  });

  it("counts none when there are none", async () => {
    registry.select.memories = [];
    expect(await db.countMemories(1, 3)).toBe(0);
  });

  it("remembers when the last extraction was", async () => {
    const at = new Date("2026-01-02T00:00:00Z");
    registry.select.memories = [{ at }];
    expect(await db.getLastMemoryExtractionAt(1, 3)).toEqual(at);
  });

  it("has no last extraction for a persona that never had one", async () => {
    registry.select.memories = [];
    expect(await db.getLastMemoryExtractionAt(1, 3)).toBeNull();
  });

  it("writes down that an extraction happened", async () => {
    await db.markMemoryExtracted(1, 3);
    expect(last().operation).toBe("insert");
    expect(last().values.personaId).toBe(1);
  });

  it("looks the titles up by id", async () => {
    registry.select.memories = [
      { id: 1, title: "第一次见面" },
      { id: 2, title: "养的那只猫" },
    ];
    const titles = await db.getMemoryTitles([1, 2, 1]);

    expect(titles.get(1)).toBe("第一次见面");
    expect(titles.get(2)).toBe("养的那只猫");
  });

  it("asks for nothing when there are no ids", async () => {
    const titles = await db.getMemoryTitles([]);
    expect(titles.size).toBe(0);
    // No query was run at all.
    expect(queries).toHaveLength(0);
  });

  it("edits a memory and says whether there was one", async () => {
    registry.returning.memories = [{ id: 1, title: "改过的" }];
    const row = await db.updateMemory(1, 3, { title: "改过的" });

    expect(row?.title).toBe("改过的");
    expect(last().values).toEqual({ title: "改过的" });
    expect(whereOf().flatMap((c) => c.params)).toContain(3);

    registry.returning.memories = [];
    expect(await db.updateMemory(1, 3, { title: "改过的" })).toBeNull();
  });
});

describe("the persona's state", () => {
  it("puts the persona on hold", async () => {
    await db.setPersonaPresence(1, 3, "quiet");
    expect(last().values.presence).toBe("quiet");
    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });

  it("lists the conversation summaries, newest first", async () => {
    registry.select.chat_summaries = [{ id: 1 }];
    await db.getChatSummaries(1, 3, 5);

    expect(orderOf()[0].sql).toContain('"chat_summaries"."createdAt" desc');
    expect(last().limit).toBe(5);
  });
});

describe("the safety record", () => {
  it("lists the events newest first", async () => {
    registry.select.safety_events = [{ id: 1 }];
    await db.getSafetyEvents(3, 10);

    expect(orderOf()[0].sql).toContain('"safety_events"."createdAt" desc');
    expect(last().limit).toBe(10);
  });

  it("marks an event as handled", async () => {
    await db.resolveSafetyEvent(5, 3);

    expect(last().values.handled).toBe(true);
    expect(last().values.resolvedAt).toBeInstanceOf(Date);
    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });
});

describe("the channels", () => {
  it("binds a channel and says which row it was", async () => {
    registry.returning.channel_bindings = [{ id: 12 }];
    const id = await db.createChannelBinding({
      userId: 3,
      channel: "feishu",
      channelUserId: "u_1",
    } as any);

    expect(id).toBe(12);
  });

  it("lists the users with a state for a channel, without repeats", async () => {
    registry.select.channel_states = [{ userId: 3 }, { userId: 3 }, { userId: 4 }];
    const users = await db.getChannelStateUsers("feishu");

    expect(users).toEqual([3, 4]);
  });
});

describe("the questionnaire", () => {
  it("lists the answers newest first", async () => {
    registry.select.persona_questionnaire_answers = [{ id: 1 }];
    await db.getQuestionnaireAnswers(1, 3);

    expect(orderOf()[0].sql).toContain('"persona_questionnaire_answers"."createdAt" desc');
  });
});

describe("the research profiles", () => {
  it("creates one and says which row it was", async () => {
    registry.returning.research_profiles = [{ id: 21 }];
    const id = await db.createResearchProfile({ personaId: 1, userId: 3 } as any);

    expect(id).toBe(21);
  });

  it("lists a persona's profiles newest first", async () => {
    registry.select.research_profiles = [{ id: 21 }];
    await db.getResearchProfilesByPersonaId(1, 3);

    expect(orderOf()[0].sql).toContain('"research_profiles"."createdAt" desc');
  });
});

describe("the collected material", () => {
  it("lists the messages in the order they were collected", async () => {
    registry.select.collected_messages = [{ id: 1 }];
    await db.getCollectedMessagesForPersona(1, 3);

    expect(orderOf()[0].sql).toContain('"collected_messages"."createdAt" asc');
  });

  it("lists the sources newest first", async () => {
    registry.select.collection_sources = [{ id: 1 }];
    await db.getCollectionSources(3);

    expect(orderOf()[0].sql).toContain('"collection_sources"."createdAt" desc');
  });

  it("writes a source and says which row it was", async () => {
    registry.returning.collection_sources = [{ id: 31 }];
    const id = await db.upsertCollectionSource({
      userId: 3,
      source: "feishu",
      status: "pending",
    } as any);

    expect(id).toBe(31);
  });
});

describe("the collection jobs", () => {
  it("creates a job and says which row it was", async () => {
    registry.returning.collection_jobs = [{ id: 41 }];
    const id = await db.createCollectionJob({
      userId: 3,
      source: "feishu",
      jobKey: "feishu:u_1",
      status: "pending",
    } as any);

    expect(id).toBe(41);
    expect(last().values.jobKey).toBe("feishu:u_1");
  });

  it("updates a job", async () => {
    await db.updateCollectionJob(41, 3, { status: "done" } as any);
    expect(last().operation).toBe("update");
    expect(last().values.status).toBe("done");
    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });

  it("finds a job by its key", async () => {
    registry.select.collection_jobs = [{ id: 41, jobKey: "feishu:u_1" }];
    const job = await db.getCollectionJobByKey("feishu:u_1", 3);

    expect(job?.id).toBe(41);
    expect(whereOf().flatMap((c) => c.params)).toContain("feishu:u_1");
  });

  it("lists the jobs of a user", async () => {
    registry.select.collection_jobs = [{ id: 41 }];
    await db.getCollectionJobs(3);

    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });
});

describe("retrying a failed query", () => {
  it("tries again when the connection dropped", async () => {
    let attempts = 0;
    const result = await db.withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error("econnreset");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("gives up on a failure that is not about the connection", async () => {
    let attempts = 0;
    await expect(
      db.withRetry(async () => {
        attempts++;
        throw new Error("a syntax error");
      }),
    ).rejects.toThrow("a syntax error");
    expect(attempts).toBe(1);
  });

  it("gives up after the retries are used up", async () => {
    let attempts = 0;
    await expect(
      db.withRetry(async () => {
        attempts++;
        throw new Error("econnrefused");
      }, 1),
    ).rejects.toThrow("econnrefused");
    expect(attempts).toBe(2);
  });
});
