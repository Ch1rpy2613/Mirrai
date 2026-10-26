import { describe, expect, it, vi, beforeEach } from "vitest";

const createCollectedMessage = vi.fn();
const getCollectedMessages = vi.fn();
const getCollectedMessageKeys = vi.fn();

/** The rows the fake drizzle client hands back for a select. */
const dbState = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
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
      return { then: (resolve: (value: unknown) => unknown) => resolve(undefined) };
    },
  }),
}));

vi.mock("../db", () => ({
  createCollectedMessage: (...a: unknown[]) => createCollectedMessage(...a),
  getCollectedMessages: (...a: unknown[]) => getCollectedMessages(...a),
  getCollectedMessageKeys: (...a: unknown[]) => getCollectedMessageKeys(...a),
  getDb: async () => client,
}));

import {
  importCollectedMessages,
  loadCollectionSource,
  saveCollectionSource,
  saveConnectorSource,
  toTranscript,
} from "./db-store";

describe("importCollectedMessages", () => {
  beforeEach(() => {
    createCollectedMessage.mockReset();
    getCollectedMessages.mockReset();
    getCollectedMessageKeys.mockReset();
    createCollectedMessage.mockResolvedValue(1);
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
    expect(createCollectedMessage).toHaveBeenCalledTimes(2);
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
    expect(createCollectedMessage).toHaveBeenCalledTimes(1);
    expect(createCollectedMessage.mock.calls[0][0].content).toBe("在的");
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
    expect(createCollectedMessage).not.toHaveBeenCalled();
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
    expect(createCollectedMessage).toHaveBeenCalledTimes(1);
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
    expect(createCollectedMessage).not.toHaveBeenCalled();
  });
});

describe("collection sources", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.inserted = [];
    dbState.updated = [];
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

describe("toTranscript", () => {
  it("renders the two sides the way the pipeline expects", () => {
    const text = toTranscript([
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的" },
    ]);
    expect(text).toBe("我：在吗\nTA：在的");
  });

  it("handles an empty list", () => {
    expect(toTranscript([])).toBe("");
  });
});
