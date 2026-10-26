import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateRequest = vi.fn();
const getUserById = vi.fn();
const userHasMessageWithMediaUrl = vi.fn();

// The mock path is resolved relative to this test file.
vi.mock("./db", () => ({
  getUserById: (...args: unknown[]) => getUserById(...args),
  userHasMessageWithMediaUrl: (...args: unknown[]) => userHasMessageWithMediaUrl(...args),
}));

vi.mock("./_core/auth", () => ({
  authenticateRequest: (...args: unknown[]) => authenticateRequest(...args),
}));

import { isOwnedByUser, uploadsAuthGuard } from "./_core/uploads";

function makeUser(id: number) {
  return {
    id,
    username: `user-${id}`,
    passwordHash: null,
    openId: null,
    name: `User ${id}`,
    email: null,
    loginMethod: "local",
    role: "user",
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function createRequest(path: string): Request {
  return { path } as unknown as Request;
}

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

/** Lets the guard's promise chain settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("isOwnedByUser", () => {
  it("accepts the user's own persona files", () => {
    expect(isOwnedByUser("personas/7/3/photo.png", 7)).toBe(true);
  });

  it("accepts the user's own chat media", () => {
    expect(isOwnedByUser("chat/7/3/voice.mp3", 7)).toBe(true);
  });

  it("accepts the user's own speech", () => {
    expect(isOwnedByUser("tts/7/abcdef0123456789.mp3", 7)).toBe(true);
  });

  it("refuses another user's files", () => {
    expect(isOwnedByUser("personas/8/3/photo.png", 7)).toBe(false);
    expect(isOwnedByUser("chat/8/3/voice.mp3", 7)).toBe(false);
    expect(isOwnedByUser("tts/8/abcdef0123456789.mp3", 7)).toBe(false);
  });

  it("refuses an unknown scope", () => {
    expect(isOwnedByUser("secrets/7/a.txt", 7)).toBe(false);
    expect(isOwnedByUser("anything/else", 7)).toBe(false);
  });

  it("refuses a key with too few segments", () => {
    expect(isOwnedByUser("personas", 7)).toBe(false);
    expect(isOwnedByUser("", 7)).toBe(false);
  });

  it("does not let the path decide who owns a legacy speech file", () => {
    // Files written before speech was scoped per user have no owner in
    // their path, and their names are the hash of the text they were
    // made from — so two people who asked for the same words share one
    // file. The conversation decides whose it is, not the path.
    expect(isOwnedByUser("tts/legacy/abcdef.mp3", 7)).toBe(false);
    expect(isOwnedByUser("tts/legacy/abcdef.mp3", 99)).toBe(false);
  });
});

describe("uploadsAuthGuard", () => {
  beforeEach(() => {
    authenticateRequest.mockReset();
    getUserById.mockReset();
    getUserById.mockResolvedValue(makeUser(7));
    userHasMessageWithMediaUrl.mockReset();
    userHasMessageWithMediaUrl.mockResolvedValue(false);
  });

  it("lets a signed-in owner through", async () => {
    authenticateRequest.mockResolvedValue(makeUser(7));
    const req = createRequest("/personas/7/3/photo.png");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("answers 401 when the request is not authenticated", async () => {
    authenticateRequest.mockRejectedValue(new Error("Invalid session"));
    const req = createRequest("/personas/7/3/photo.png");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  it("answers 404 — not 403 — when the file belongs to somebody else", async () => {
    authenticateRequest.mockResolvedValue(makeUser(9));
    const req = createRequest("/personas/7/3/photo.png");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" });
  });

  it("lets a legacy speech file through to the person whose conversation points at it", async () => {
    authenticateRequest.mockResolvedValue(makeUser(9));
    userHasMessageWithMediaUrl.mockResolvedValue(true);
    const req = createRequest("/tts/legacy/abcdef.mp3");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a legacy speech file to somebody else's conversation", async () => {
    authenticateRequest.mockResolvedValue(makeUser(9));
    userHasMessageWithMediaUrl.mockResolvedValue(false);
    const req = createRequest("/tts/legacy/abcdef.mp3");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("decodes the path before checking the owner", async () => {
    authenticateRequest.mockResolvedValue(makeUser(7));
    const req = createRequest("/personas/7/a%20b.png");
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    uploadsAuthGuard(req, res, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
  });
});
