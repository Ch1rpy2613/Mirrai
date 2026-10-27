import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A memory's date.
 *
 * It used to be any string at all, up to fifty characters. So
 * "sometime last summer" was stored as a date: the anniversary sweep
 * compares the month and the day, so that anniversary was never
 * announced, and nothing ever said that the date could not be read.
 */

const getPersonaById = vi.fn();
const createMemory = vi.fn();
const updateMemory = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createMemory: (...a: unknown[]) => createMemory(...a),
  updateMemory: (...a: unknown[]) => updateMemory(...a),
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

describe("a memory's date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 1, userId: 1, name: "小A", analysisStatus: "ready" });
    createMemory.mockResolvedValue(7);
    updateMemory.mockResolvedValue({ id: 7 });
  });

  it("takes a whole day", async () => {
    const result = await appRouter
      .createCaller(ctxFor())
      .memory.create({ personaId: 1, title: "第一次见面", date: "2026-02-14" });

    expect(result).toEqual({ id: 7 });
  });

  it("takes a month and a day, for a yearly anniversary", async () => {
    const result = await appRouter
      .createCaller(ctxFor())
      .memory.create({ personaId: 1, title: "在一起", category: "anniversary", date: "02-14" });

    expect(result).toEqual({ id: 7 });
  });

  it("does not take a phrase", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).memory.create({
        personaId: 1,
        title: "夏天",
        date: "sometime last summer",
      }),
    ).rejects.toThrow();

    expect(createMemory).not.toHaveBeenCalled();
  });

  it("does not take a day that does not exist", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).memory.create({
        personaId: 1,
        title: "假的",
        date: "2026-02-30",
      }),
    ).rejects.toThrow();

    expect(createMemory).not.toHaveBeenCalled();
  });

  it("does not take a phrase when the memory is edited", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).memory.update({
        id: 7,
        date: "last year, sometime",
      }),
    ).rejects.toThrow();

    expect(updateMemory).not.toHaveBeenCalled();
  });
});
