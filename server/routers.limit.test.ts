import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A limit is a whole number.
 *
 * It was not checked for being one: so "limit: 2.5" reached Postgres
 * as "LIMIT 2.5", and the database refused the query — a 500, for a
 * request that was simply asking for two and a half messages.
 */

const getPersonaById = vi.fn();
const getHistory = vi.fn();
const getMessagesByPersonaId = vi.fn();
const countMessages = vi.fn();
const getMemoryTitles = vi.fn();
const getFileSummaryTitles = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getHistory: (...a: unknown[]) => getHistory(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  countMessages: (...a: unknown[]) => countMessages(...a),
  getMemoryTitles: (...a: unknown[]) => getMemoryTitles(...a),
  getFileSummaryTitles: (...a: unknown[]) => getFileSummaryTitles(...a),
}));

import { appRouter } from "./routers";

function ctxFor(): TrpcContext {
  return {
    user: { id: 1, name: "Sample", tokenVersion: 0, locale: "zh" },
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("a limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 1, userId: 1, name: "小A", analysisStatus: "ready" });
    getHistory.mockResolvedValue({ messages: [], total: 0 });
    getMessagesByPersonaId.mockResolvedValue([]);
    countMessages.mockResolvedValue(0);
    getMemoryTitles.mockResolvedValue(new Map());
    getFileSummaryTitles.mockResolvedValue(new Map());
  });

  it("is a whole number", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).chat.getHistory({ personaId: 1, limit: 2.5 }),
    ).rejects.toThrow();

    // The query was never sent.
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("takes a whole number", async () => {
    await appRouter.createCaller(ctxFor()).chat.getHistory({ personaId: 1, limit: 25 });
    expect(getMessagesByPersonaId).toHaveBeenCalledWith(1, 1, 25);
  });
});
