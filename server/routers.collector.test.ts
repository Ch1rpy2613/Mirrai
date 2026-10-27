import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Stopping a collection.
 *
 * A collection can run for half an hour — the DingTalk one drives a
 * browser — and there was no way to stop it. The function that stops it
 * was written and exported; nothing called it.
 */

const getCollectorJob = vi.fn();
const cancelCollectorJob = vi.fn();
const enqueueCollectorJob = vi.fn();
const getPersonaById = vi.fn();

vi.mock("./collectors", () => ({
  getCollectorJob: (...a: unknown[]) => getCollectorJob(...a),
  cancelCollectorJob: (...a: unknown[]) => cancelCollectorJob(...a),
  enqueueCollectorJob: (...a: unknown[]) => enqueueCollectorJob(...a),
  getCollector: vi.fn(),
  listCollectorJobs: vi.fn(),
  COLLECTOR_SOURCES: [],
  CollectorQueueFullError: class extends Error {},
}));

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaFileById: vi.fn(),
  getCollectedMessageSources: vi.fn(),
  getCollectedMessagesForPersona: vi.fn(),
  countCollectedMessagesForPersona: vi.fn(),
  getPersistedCollectorJob: vi.fn(),
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

describe("starting a collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueCollectorJob.mockResolvedValue({ jobId: "job-2" });
    getPersonaById.mockResolvedValue({ id: 1, name: "小A" });
  });

  it("passes the browser profile on, so the source can collect at all", async () => {
    /**
     * The DingTalk source reads the message history by driving a
     * browser, and the browser's login *is* the credential — so the
     * profile has to be named.
     *
     * There was nowhere to name it: the procedure did not accept one,
     * so the source could be authorised and could never collect.
     */
    await appRouter
      .createCaller(ctxFor(1))
      .collector.start({
        source: "dingtalk",
        personaId: 1,
        chromeProfile: "/Users/me/Library/Application Support/Google/Chrome/Default",
      });

    const job = enqueueCollectorJob.mock.calls[0][0] as any;
    expect(job.input.options.chrome_profile).toBe(
      "/Users/me/Library/Application Support/Google/Chrome/Default",
    );
  });

  it("refuses a browser profile that is not a path", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .collector.start({ source: "dingtalk", personaId: 1, chromeProfile: "   " }),
    ).rejects.toThrow();
    expect(enqueueCollectorJob).not.toHaveBeenCalled();
  });
});

describe("stopping a collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectorJob.mockReturnValue({ id: "job-1", userId: "1", status: "running" });
    cancelCollectorJob.mockReturnValue(true);
  });

  it("stops the caller's own collection", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .collector.cancel({ jobId: "job-1" });

    expect(result).toEqual({ success: true });
    expect(cancelCollectorJob).toHaveBeenCalledWith("job-1");
  });

  it("does not stop somebody else's collection", async () => {
    // The job id is the only thing the caller sends, and it is enough
    // to stop somebody else's collection.
    getCollectorJob.mockReturnValue({ id: "job-1", userId: "2", status: "running" });

    await expect(
      appRouter.createCaller(ctxFor(1)).collector.cancel({ jobId: "job-1" }),
    ).rejects.toThrow();
    expect(cancelCollectorJob).not.toHaveBeenCalled();
  });

  it("does not stop a job that is not there", async () => {
    getCollectorJob.mockReturnValue(undefined);

    await expect(
      appRouter.createCaller(ctxFor(1)).collector.cancel({ jobId: "job-1" }),
    ).rejects.toThrow();
    expect(cancelCollectorJob).not.toHaveBeenCalled();
  });

  it("says so when the collection had already finished", async () => {
    cancelCollectorJob.mockReturnValue(false);

    await expect(
      appRouter.createCaller(ctxFor(1)).collector.cancel({ jobId: "job-1" }),
    ).rejects.toThrow();
  });
});
