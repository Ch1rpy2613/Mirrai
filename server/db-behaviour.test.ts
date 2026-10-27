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
  /** The columns a `DISTINCT ON` asked for. */
  distinctOn?: any[];
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

  /**
   * A `DISTINCT ON`.
   *
   * The columns it was given are recorded, because "one row per
   * persona" and "every row" are told apart by exactly this.
   */
  distinctOn(columns: any[]) {
    this.log.distinctOn = columns;
    return this;
  }

  from(table: any) {
    this.log.table = getTableName(table);
    return this;
  }

  /**
   * A join.
   *
   * The table the query is read from stays the one it started at — the
   * join is a second table, and the conditions that follow are still
   * the ones of the query.
   */
  innerJoin(_table: any, _condition: any) {
    return this;
  }

  leftJoin(_table: any, _condition: any) {
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

  orderBy(...expressions: any[]) {
    this.log.orderBy.push(...expressions);
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
    let rows: any[];
    if (this.log.operation === "select") {
      rows = registry.select[this.log.table] ?? [];
    } else if (this.log.returned) {
      rows = registry.returning[this.log.table] ?? [];
    } else {
      rows = [];
    }
    // The limit is honoured, so a query that asks for one row is given
    // one row.
    if (this.log.limit !== undefined) rows = rows.slice(0, this.log.limit);
    return rows;
  }

  then(resolve: (value: any) => any, reject: (reason: any) => any) {
    return Promise.resolve(this.rows()).then(resolve, reject);
  }
}

/** How many transactions were opened. */
let transactions = 0;

/** The fake database the module under test gets. */
const fakeDb = {
  select: () => new FakeQuery("select"),
  selectDistinct: () => new FakeQuery("select"),
  selectDistinctOn: (on: any[]) => new FakeQuery("select").distinctOn(on),
  insert: (table: any) => new FakeQuery("insert").setTable(table),
  update: (table: any) => new FakeQuery("update").setTable(table),
  delete: (table: any) => new FakeQuery("delete").setTable(table),
  transaction: async (callback: (tx: any) => Promise<any>) => {
    transactions++;
    return callback(fakeDb);
  },
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
  transactions = 0;
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
    // The limit was fifty — so the fifty-first letter simply
    // disappeared from the box while it was still in the export.
    expect(last().limit).toBe(200);
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
    // The row the database would answer with.
    registry.select.messages = [{ id: 2, content: "第二句" }];
    const row = await db.getPreviousMessage(1, 3, 3);

    expect(row?.content).toBe("第二句");
    // The row before the one asked for, newest first — and only one row
    // of them: the whole history used to be read to find one message.
    expect(orderOf()[0].sql).toContain('"messages"."createdAt" desc');
    expect(last().limit).toBe(1);
    const conditions = whereOf().map((c) => c.sql).join(" ");
    expect(conditions).toContain('"createdAt" <');
    expect(conditions).toContain('SELECT "createdAt" FROM "messages"');
  });

  it("has no previous message for the first one", async () => {
    // There is nothing older than the first message, so the database
    // answers with no rows.
    registry.select.messages = [];
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

    const deleted = await db.deleteMessagesFrom(4, 2, 3);

    expect(deleted).toBe(3);
    // The cut is inside one persona: the ids of the persona and the owner
    // are part of the condition, so another conversation's history is
    // never touched.
    const conditions = whereOf(queries.length - 1);
    expect(conditions.flatMap((c) => c.params)).toContain(2);
    expect(conditions.flatMap((c) => c.params)).toContain(3);
  });

  it("deletes nothing when the message to delete is not there", async () => {
    registry.select.messages = [];
    expect(await db.deleteMessagesFrom(4, 2, 3)).toBe(0);
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
    const titles = await db.getMemoryTitles([1, 2, 1], 3);

    expect(titles.get(1)).toBe("第一次见面");
    expect(titles.get(2)).toBe("养的那只猫");
  });

  it("asks for nothing when there are no ids", async () => {
    const titles = await db.getMemoryTitles([], 3);
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

describe("the user's own day", () => {
  it("counts the day from the user's midnight, not the server's", async () => {
    /**
     * The shift used to be the difference between the user's offset
     * *now* and the server's offset *now* — and the offset of a zone is
     * not the same all year. So on the day the clocks changed, the
     * first hour of the user's day was counted as the day before.
     *
     * The twenty-ninth of March 2026 is the day the clocks go forward
     * in London: the day is twenty-three hours long, and its midnight
     * is in Greenwich, not in British Summer Time.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00.000Z"));
    try {
      registry.select.personas = [];
      registry.select.messages = [];
      registry.select.users = [];

      await db.getUserStats(3, "Europe/London");

      /**
       * The messages of the day are the ones written since the user's
       * midnight — which is the instant the condition carries.
       */
      const index = queries.findIndex((q) => q.table === "messages");
      expect(index).toBeGreaterThanOrEqual(0);
      const conditions = whereOf(index).map((c) => c.sql).join(" ");
      expect(conditions).toContain('"messages"."createdAt" >=');
      const params = whereOf(index).flatMap((c) => c.params);
      // The driver writes the instant as it is.
      expect(params).toContain("2026-03-29T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the charts of the analytics page", () => {
  /**
   * They are one answer, so they are one calendar.
   *
   * The page says "the last thirty days" and draws four charts side by
   * side. The daily-messages chart drew exactly thirty bars in the
   * reader's own calendar; the moods chart drew thirty-one, starting a
   * day earlier; and the emotion timeline and the per-persona list were
   * in the *server's* calendar — so a reader on the other side of the
   * world saw a day the reader's calendar had already closed.
   */
  it("reads the emotion timeline by the reader's own day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    try {
      registry.select.emotion_snapshots = [];
      await db.getEmotionTimeline(3, 30, "Asia/Shanghai");

      const conditions = whereOf().map((c) => c.sql).join(" ");
      /**
       * The rows of this chart are filed under the reader's day — the
       * `date` column is their day key — so the window has to be a day
       * key in the same calendar. It was the instant the row was
       * written, against the server's clock.
       */
      expect(conditions).toContain('"emotion_snapshots"."date" >=');
      expect(conditions).not.toContain('"emotion_snapshots"."createdAt"');
      const params = whereOf().flatMap((c) => c.params);
      // The reader's day is the fourteenth of March in Shanghai, so
      // thirty days ending today open on the thirteenth of February.
      expect(params).toContain("2026-02-13");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the per-persona list at the reader's own midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    try {
      registry.select.messages = [];
      await db.getPersonaEngagement(3, 30, "Asia/Shanghai");

      const index = queries.findIndex((q) => q.table === "messages");
      expect(index).toBeGreaterThanOrEqual(0);
      const conditions = whereOf(index).map((c) => c.sql).join(" ");
      expect(conditions).toContain('"messages"."createdAt" >=');
      const params = whereOf(index).flatMap((c) => c.params);
      /**
       * The reader's midnight, twenty-nine days back. The thirteenth of
       * February at midnight in Shanghai is the twelfth at four in the
       * afternoon in Greenwich — and the server's clock, which is what
       * it used to be, was four hours off that.
       */
      expect(params).toContain("2026-02-12T16:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the moods chart the same number of days as the chart beside it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    try {
      registry.select.user_moods = [];
      await db.getUserMoods(3, 30, "Asia/Shanghai");

      const params = whereOf().flatMap((c) => c.params);
      // Thirty days, ending today. It opened on the twelfth of
      // February — thirty-one days.
      expect(params).toContain("2026-02-13");
      expect(params).not.toContain("2026-02-12");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the emotion snapshot", () => {
  it("brings the day's row up to date instead of adding a second one", async () => {
    // The row was written by a read and then a write — so two requests
    // that looked at the same day together both wrote one, and the day
    // had two snapshots. The reader took one of them and the other
    // stayed for ever.
    registry.returning.emotion_snapshots = [{ id: 1 }];
    await db.createEmotionSnapshot({
      personaId: 1,
      userId: 3,
      emotionalState: "warm",
      messageCount: 4,
      date: "2026-01-15",
    });

    // The write carries the day's key, so the second writer updates.
    const conflict = (last().values as any)?.__conflict;
    expect(conflict).toBeDefined();
    expect(conflict.target).toHaveLength(3);
    expect(conflict.set.emotionalState).toBe("warm");
    expect(conflict.set.messageCount).toBe(4);
  });
});

describe("putting a turn back", () => {
  it("does it in one transaction, so it is all of it or none of it", async () => {
    // The rows were inserted one at a time, outside a transaction — so a
    // failure halfway through left the user's own question back and the
    // persona's answer missing.
    await db.restoreMessages(
      [
        {
          role: "user",
          content: "在吗",
          emotionalState: "warm",
          messageType: "text",
          mediaUrl: null,
          replyToId: null,
          channel: "web",
          origin: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          role: "assistant",
          content: "在的",
          emotionalState: "warm",
          messageType: null,
          mediaUrl: null,
          replyToId: null,
          channel: "web",
          origin: null,
          createdAt: new Date("2026-01-01T00:01:00Z"),
        },
      ],
      1,
      3,
    );

    expect(transactions).toBe(1);
    expect(queries.filter((q) => q.operation === "insert")).toHaveLength(2);
  });
});

describe("the reminders waiting in the hall", () => {
  it("lists only the ones that were delivered on the web", async () => {
    registry.select.reminder_deliveries = [{ id: 1 }];
    await db.getActiveReminders(3);

    const conditions = whereOf();
    const channel = conditions.find((c) => c.sql.includes('"channel"'));
    expect(channel).toBeDefined();
    expect(channel!.params).toContain("web");
  });

  it("still belongs to the user who was reminded", async () => {
    registry.select.reminder_deliveries = [{ id: 1 }];
    await db.getActiveReminders(3);

    expect(whereOf().flatMap((c) => c.params)).toContain(3);
  });

  it("does not list the ones that were dismissed", async () => {
    registry.select.reminder_deliveries = [{ id: 1 }];
    await db.getActiveReminders(3);

    expect(whereOf().some((c) => c.sql.includes('"dismissedAt" IS NULL'))).toBe(true);
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
  it("lists the messages in the order they were said", async () => {
    registry.select.collected_messages = [{ id: 1 }];
    await db.getCollectedMessagesForPersona(1, 3);

    // By when they were *said*, not by when they were imported. Two
    // imports of two different conversations used to be laid end to end,
    // and the ruler cut cases across the seam — a case whose context was
    // half of one conversation and half of another. The import time is
    // the fallback for a record that carries no time of its own.
    const sql = orderOf()[0].sql;
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('"collected_messages"."timestamp"');
    expect(sql).toContain('"collected_messages"."createdAt"');
    expect(sql).toContain("asc");
  });

});

describe("the lobby", () => {
  it("asks for one message per persona, not for the whole history", async () => {
    registry.select.personas = [{ id: 5, userId: 3, updatedAt: new Date() }];
    registry.select.messages = [{ personaId: 5, content: "在吗", createdAt: new Date() }];
    registry.select.persona_files = [];
    registry.select.wechat_bindings = [];

    await db.getPersonasWithStats(3);

    /**
     * The newest message of each persona.
     *
     * It used to be a `selectDistinct` over (personaId, content,
     * createdAt) — a plain `SELECT DISTINCT`, and a plain `DISTINCT`
     * over three columns that differ on every row removes nothing. So
     * the query returned **every message the user has ever sent**, with
     * the full text of each one — on the first screen of the app, on
     * every visit.
     */
    const messageQuery = queries.findIndex((q) => q.table === "messages");
    expect(messageQuery).toBeGreaterThanOrEqual(0);
    expect(queries[messageQuery].distinctOn).toBeTruthy();
    const on = queries[messageQuery].distinctOn!.map((c: any) => c.name);
    expect(on).toContain("personaId");
    /**
     * And Postgres insists that the ordering starts with the
     * distinct-on columns — so the newest message is the one that
     * survives.
     */
    const orders = queries[messageQuery].orderBy;
    expect(orders.length).toBe(2);
    expect((orders[0] as any).name).toBe("personaId");
    expect(sqlOf(orders[1]).sql).toContain('"messages"."createdAt" desc');
  });
});

describe("writing to a persona", () => {
  it("says whether a row was actually written", async () => {
    registry.returning.personas = [{ id: 5 }];
    expect(await db.updatePersona(5, 3, { name: "小B" })).toBe(true);
  });

  it("says no when the row is not there, or is not the caller's", async () => {
    /**
     * The write is scoped to the persona *and* to its owner — so a
     * caller who guessed somebody else's id, or who held a stale id
     * for a persona deleted in another tab, wrote nothing.
     *
     * But the function said nothing about it either, and the procedure
     * answered "saved".
     */
    registry.returning.personas = [];
    expect(await db.updatePersona(999999, 3, { name: "小B" })).toBe(false);
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
