import { describe, expect, it, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const createCollectedMessage = vi.fn();
const createCollectedMessages = vi.fn();
const getCollectedMessages = vi.fn();
const getCollectedMessageKeys = vi.fn();

/** The rows the fake drizzle client hands back for a select. */
const dbState = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  /** The values the upsert's conflict clause would write. */
  conflictSet: undefined as Record<string, unknown> | undefined,
}));

const client = vi.hoisted(() => ({
  select: () => ({
    from: () => ({
      where: async () => dbState.rows,
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      dbState.updated.push(values);
      return { where: async () => undefined };
    },
  }),
  insert: () => ({
    values: (values: Record<string, unknown>) => {
      dbState.inserted.push(values);
      return {
        // The insert is an upsert now, so it carries the conflict
        // clause with it.
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          dbState.conflictSet = config.set;
          return {
            then: (resolve: (value: unknown) => unknown) => resolve(undefined),
          };
        },
        then: (resolve: (value: unknown) => unknown) => resolve(undefined),
      };
    },
  }),
}));

const getChannelState = vi.fn();
const getCollectionJob = vi.fn();

vi.mock("../db", () => ({
  getChannelState: (...a: unknown[]) => getChannelState(...a),
  createCollectedMessage: (...a: unknown[]) => createCollectedMessage(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  getCollectedMessages: (...a: unknown[]) => getCollectedMessages(...a),
  getCollectedMessageKeys: (...a: unknown[]) => getCollectedMessageKeys(...a),
  getCollectionJob: (...a: unknown[]) => getCollectionJob(...a),
  getDb: async () => client,
}));

import { collectionSources as collectionSourcesTable } from "../../drizzle/schema";
import {
  getPersistedCollectorJob,
  importCollectedMessages,
  loadCollectionSource,
  saveCollectionSource,
  saveConnectorSource,
  toTranscript,
} from "./db-store";

describe("importCollectedMessages", () => {
  beforeEach(() => {
    createCollectedMessage.mockReset();
    createCollectedMessages.mockReset();
    getCollectedMessages.mockReset();
    getCollectedMessageKeys.mockReset();
    createCollectedMessage.mockResolvedValue(1);
    createCollectedMessages.mockResolvedValue(0);
    getCollectedMessageKeys.mockResolvedValue([]);
    getCollectedMessageKeys.mockResolvedValue([]);
  });

  it("imports every message when the persona has none yet", async () => {
    const added = await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [
        { role: "user", content: "在吗" },
        { role: "assistant", content: "在的" },
      ],
    });

    expect(added).toBe(2);
    // One statement, not one per message: a chat log of fifty thousand
    // lines was fifty thousand round trips to the database.
    expect(createCollectedMessages).toHaveBeenCalledTimes(1);
    expect(createCollectedMessages.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not import the same message twice", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      {
        id: 1,
        userId: 2,
        personaId: 1,
        source: "feishu",
        role: "user",
        content: "在吗",
        timestamp: new Date("2024-05-20T10:00:00Z"),
        createdAt: new Date(),
      },
    ]);

    const added = await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [
        { role: "user", content: "在吗", timestamp: "2024-05-20T10:00:00.000Z" },
        { role: "assistant", content: "在的" },
      ],
    });

    // Only the new one was added.
    expect(added).toBe(1);
    expect(createCollectedMessages).toHaveBeenCalledTimes(1);
    expect(createCollectedMessages.mock.calls[0][0][0].content).toBe("在的");
  });

  it("keeps the repeated messages that have no timestamp", async () => {
    // Three "嗯" in a row is what a chat log is full of.
    //
    // The timestamp is what keeps two messages of the same minute
    // apart — but a message without one contributed nothing to the
    // key, so every message of the same text collapsed into one.
    getCollectedMessageKeys.mockResolvedValue([]);

    await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
      ],
    });

    expect(createCollectedMessages).toHaveBeenCalledTimes(1);
    expect(createCollectedMessages.mock.calls[0][0]).toHaveLength(3);
  });

  it("does not add the repeated messages again when they are collected twice", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      { source: "feishu", timestamp: null, content: "嗯" },
      { source: "feishu", timestamp: null, content: "嗯" },
      { source: "feishu", timestamp: null, content: "嗯" },
    ]);

    await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
        { role: "assistant", content: "嗯" },
      ],
    });

    expect(createCollectedMessages).not.toHaveBeenCalled();
  });

  it("treats a message with no timestamp as its own entry", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      {
        id: 1,
        userId: 2,
        personaId: 1,
        source: "feishu",
        role: "user",
        content: "在吗",
        timestamp: null,
        createdAt: new Date(),
      },
    ]);

    const added = await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [{ role: "user", content: "在吗" }],
    });

    expect(added).toBe(0);
    expect(createCollectedMessages).not.toHaveBeenCalled();
  });

  it("keys the idempotency on the source, not on the content alone", async () => {
    // The very same sentence, at the very same moment, coming from another
    // platform is another message.
    getCollectedMessageKeys.mockResolvedValue([
      {
        id: 1,
        userId: 2,
        personaId: 1,
        source: "slack",
        role: "user",
        content: "在吗",
        timestamp: new Date("2024-05-20T10:00:00Z"),
        createdAt: new Date(),
      },
    ]);

    const added = await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [{ role: "user", content: "在吗", timestamp: "2024-05-20T10:00:00.000Z" }],
    });

    expect(added).toBe(1);
    expect(createCollectedMessages).toHaveBeenCalledTimes(1);
  });

  it("does not import the same source and timestamp twice", async () => {
    getCollectedMessageKeys.mockResolvedValue([
      {
        id: 1,
        userId: 2,
        personaId: 1,
        source: "feishu",
        role: "user",
        content: "在吗",
        timestamp: new Date("2024-05-20T10:00:00Z"),
        createdAt: new Date(),
      },
    ]);

    const added = await importCollectedMessages({
      personaId: 1,
      userId: 2,
      source: "feishu",
      messages: [{ role: "user", content: "在吗", timestamp: "2024-05-20T10:00:00.000Z" }],
    });

    expect(added).toBe(0);
    expect(createCollectedMessages).not.toHaveBeenCalled();
  });
});

describe("collection sources", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.inserted = [];
    dbState.updated = [];
    dbState.conflictSet = undefined;
    getChannelState.mockReset();
    getChannelState.mockResolvedValue(null);
  });

  it("stores the credentials encrypted", async () => {
    await saveCollectionSource({
      userId: 7,
      source: "feishu",
      credentials: { app_id: "cli_x", app_secret: "super-secret" },
      authState: { ok: true },
    });

    expect(dbState.inserted).toHaveLength(1);
    const stored = dbState.inserted[0].config as { encrypted?: string };
    expect(typeof stored.encrypted).toBe("string");
    expect(stored.encrypted?.startsWith("v1:")).toBe(true);
    // The plaintext token must not be anywhere in the stored row.
    expect(JSON.stringify(dbState.inserted[0])).not.toContain("super-secret");
  });

  it("reads the credentials back, decrypted", async () => {
    await saveCollectionSource({
      userId: 7,
      source: "feishu",
      credentials: { app_id: "cli_x", app_secret: "super-secret" },
    });
    const stored = dbState.inserted[0].config as { encrypted?: string };
    dbState.rows = [
      {
        id: 1,
        userId: 7,
        source: "feishu",
        label: "飞书",
        authState: { ok: true },
        config: stored,
        status: "stopped",
        lastSyncedAt: null,
      },
    ];

    const loaded = await loadCollectionSource(7, "feishu");

    expect(loaded?.source).toBe("feishu");
    expect(loaded?.credentials).toEqual({ app_id: "cli_x", app_secret: "super-secret" });
    expect(loaded?.authState).toEqual({ ok: true });
  });

  it("reads the channel's own copy of the Feishu credentials", async () => {
    /**
     * One secret, two vocabularies.
     *
     * The channel calls the credentials `appId` and `appSecret`; the
     * collector reads them as `app_id` and `app_secret`. So the
     * channel's copy was handed over unchanged, the collector found
     * nothing in it, and a user who had only ever set up the channel
     * could never run the Feishu collector — "no Feishu credentials
     * found", with the secret sitting right there.
     */
    const { encryptSecret } = await import("../_core/crypto");
    getChannelState.mockResolvedValue({
      userId: 7,
      channel: "feishu",
      credentialsEnc: await encryptSecret(JSON.stringify({
        appId: "cli_x",
        appSecret: "super-secret",
      })),
    });
    dbState.rows = [
      {
        id: 1,
        userId: 7,
        source: "feishu",
        label: "飞书",
        authState: null,
        config: null,
        status: "stopped",
        lastSyncedAt: null,
      },
    ];

    const loaded = await loadCollectionSource(7, "feishu");

    expect(loaded?.credentials?.app_id).toBe("cli_x");
    expect(loaded?.credentials?.app_secret).toBe("super-secret");
  });

  it("does not wipe the stored credentials when the upsert hits a conflict", async () => {
    /**
     * The row is not there when the source is read — so the write goes
     * down the insert path. But another press of the button got there
     * first, and the upsert's conflict clause decides what is kept.
     *
     * It used to write the *new* values over the old ones — so the
     * call that arrived second, carrying no credentials, wiped the
     * credentials the first call had just stored.
     */
    dbState.rows = [];
    await saveCollectionSource({
      userId: 7,
      source: "feishu",
      credentials: { app_id: "cli_x", app_secret: "super-secret" },
    });

    const set = dbState.conflictSet;
    expect(set).toBeTruthy();

    /**
     * The clause is turned into the SQL it would send, so the claim
     * is about the statement and not about the shape of a call.
     */
    const dialect = new PgDialect();
    const table = collectionSourcesTable;
    const built = dialect.buildUpdateSet(
      table,
      Object.fromEntries(
        Object.entries(set!).map(([key, value]) => [key, value as any]),
      ) as any,
    );
    const sqlText = dialect.sqlToQuery(built as any).sql;

    // The stored credentials are kept when the new ones are empty.
    expect(sqlText).toContain("coalesce");
    expect(sqlText).toContain("excluded");
    expect(sqlText).toContain(getTableName(table));
  });

  it("stores the auth state of a connector and its encrypted credentials", async () => {
    await saveConnectorSource({
      userId: 7,
      connector: {
        id: "slack",
        label: "Slack",
        tool: "slack_auto_collector.py",
        args: () => [],
        checkAuth: async () => ({ ok: false, message: "缺少 bot_token" }),
        collect: async () => ({ messages: [], meta: { total: 0, source: "slack" } }),
        exportCredentials: async () => "v1:fake:blob",
      },
    });

    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0].authState).toEqual({ ok: false, message: "缺少 bot_token" });
    expect(dbState.inserted[0].config).toEqual({ encrypted: "v1:fake:blob" });
  });
});

describe("a persisted collection job", () => {
  beforeEach(() => {
    getCollectionJob.mockReset();
  });

  it("says the same things as the list does", async () => {
    /**
     * The truncation flag was missing here — so a job that had been
     * cut short lost its warning as soon as the server restarted: the
     * detail panel said the collection was complete when it was not,
     * and the list beside it said otherwise.
     */
    getCollectionJob.mockResolvedValue({
      jobKey: "feishu:u_1",
      source: "feishu",
      status: "done",
      progress: 100,
      messageCount: 120,
      foundCount: 400,
      truncated: true,
      error: undefined,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:05:00Z"),
    });

    const job = await getPersistedCollectorJob("feishu:u_1", 3);

    expect(job?.truncated).toBe(true);
    expect(job?.foundCount).toBe(400);
    expect(job?.messageCount).toBe(120);
  });
});

describe("toTranscript", () => {
  it("renders the two sides the way the pipeline expects", () => {
    const text = toTranscript([
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的" },
    ]);
    // The label is one the rule miner knows — in both languages. It used
    // to be "TA：" in Chinese and "Them: " in English, and the miner
    // knew only the first — so an English user's transcript had its
    // persona's side unreadable and the miner read the user's own
    // habits as the persona's rules.
    expect(text).toBe("我：在吗\n分身：在的");
    expect(toTranscript([
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的" },
    ], "en")).toBe("Me: 在吗\nPersona: 在的");
  });

  it("handles an empty list", () => {
    expect(toTranscript([])).toBe("");
  });
});
