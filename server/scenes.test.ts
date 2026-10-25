import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

/**
 * The scene mode.
 *
 * Two things are checked here: that the built-in scenes reach an
 * installation that already has some of them, and that the two fields a
 * scene carries — its mood and its opening lines — actually reach the
 * conversation.
 */

const getMessagesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const retrieveMemories = vi.fn();
const createScene = vi.fn();

const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
getUserTimezone.mockResolvedValue(null);
    getUserById.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);

vi.mock("./db", () => ({
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createScene: (...a: unknown[]) => createScene(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
}));

vi.mock("./chat/retrieval", () => ({
  retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  formatMemoriesForPrompt: () => "",
  formatAnchorsForPrompt: () => "",
}));

import { composeMessages } from "./chat/service";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// The database module is mocked for the conversation pipeline, so the
// seeding routine is read from the real module.
let seedBuiltinScenes: typeof import("./db")["seedBuiltinScenes"];
let BUILTIN_SCENES: typeof import("./db")["BUILTIN_SCENES"];

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  seedBuiltinScenes = actual.seedBuiltinScenes;
  BUILTIN_SCENES = actual.BUILTIN_SCENES;
});

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  relationshipDesc: "恋人",
  togetherFrom: null,
  togetherTo: null,
  personaData: null,
  analysisStatus: "ready",
  analysisProgress: 100,
  analysisMessage: null,
  emotionalState: "warm",
  chatCount: 10,
  lastChatAt: null,
  skillJobId: null,
  llmProvider: null,
  intimacyScore: 0,
  intimacyLevel: "acquainted",
  activeSceneId: 3,
  source: "upload",
  remindersEnabled: true,
  correctionLog: null,
  graduationStatus: null,
  graduatedAt: null,
  farewellLetter: null,
  graduationMode: null,
  distillationMode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

beforeEach(() => {
  for (const fn of [getMessagesByPersonaId, getSceneById, getLatestChatSummary, retrieveMemories, createScene]) {
    fn.mockReset();
  }
  getMessagesByPersonaId.mockResolvedValue([]);
  getLatestChatSummary.mockResolvedValue(null);
  retrieveMemories.mockResolvedValue([]);
  createScene.mockResolvedValue({ id: 9 });
});

describe("the built-in scenes", () => {
  it("gives every scene a name of its own", () => {
    const names = BUILTIN_SCENES.map((scene) => scene.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(11);
  });

  it("gives every scene a mood and a set of opening lines", () => {
    for (const scene of BUILTIN_SCENES) {
      expect(scene.emotionalState, scene.name).toBeTruthy();
      expect(Array.isArray(scene.starters), scene.name).toBe(true);
      expect((scene.starters as string[]).length, scene.name).toBeGreaterThan(0);
      expect(scene.systemPromptOverlay, scene.name).toBeTruthy();
    }
  });

  it("fills in the scenes an installation is missing", async () => {
    // The database already has one of the built-in scenes — the old
    // routine stopped there, so a new scene never reached an existing
    // installation.
    const inserted: any[] = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: async () => [{ name: BUILTIN_SCENES[0].name }],
        }),
      }),
      insert: () => ({
        values: (rows: any[]) => ({
          onConflictDoNothing: async () => { inserted.push(...rows); },
        }),
      }),
    };

    await seedBuiltinScenes(fakeDb as any);

    const names = inserted.map((row) => row.name);
    expect(names).not.toContain(BUILTIN_SCENES[0].name);
    expect(names).toEqual(
      BUILTIN_SCENES.filter((scene) => scene.name !== BUILTIN_SCENES[0].name).map((scene) => scene.name),
    );
  });

  it("inserts nothing when every scene is already there", async () => {
    const insert = vi.fn(() => ({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    }));
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: async () => BUILTIN_SCENES.map((scene) => ({ name: scene.name })),
        }),
      }),
      insert,
    };

    await seedBuiltinScenes(fakeDb as any);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("the scene in the prompt", () => {
  it("carries the scene's setting and the scene's mood", async () => {
    getSceneById.mockResolvedValue({
      id: 3,
      userId: null,
      name: "深夜聊天",
      description: null,
      icon: "🌙",
      systemPromptOverlay: "现在是深夜，周围很安静。",
      emotionalState: "nostalgic",
      starters: ["睡不着吗？"],
      isBuiltin: true,
      createdAt: new Date(),
    });

    const { messages } = await composeMessages({
      persona,
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    const prompt = messages[0].content as string;
    expect(prompt).toContain("【当前场景】");
    expect(prompt).toContain("现在是深夜，周围很安静。");
    // The scene's mood overrides the persona's own for the length of the
    // scene — the persona's state machine keeps running in the database.
    expect(prompt).toContain("【当前情感状态】");
    expect(prompt).toContain("思念模式");
    expect(prompt).not.toContain("温柔模式");
  });

  it("falls back to the persona's own mood when there is no scene", async () => {
    getSceneById.mockResolvedValue(null);

    const { messages } = await composeMessages({
      persona: { ...persona, activeSceneId: null },
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    const prompt = messages[0].content as string;
    expect(prompt).not.toContain("【当前场景】");
    expect(prompt).toContain("温柔模式");
  });
});

describe("a scene of the user's own", () => {
  function makeCtx(userId = 1): TrpcContext {
    return {
      user: {
        id: userId,
        username: "test-user",
        passwordHash: null,
        openId: "test-open-id",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "local",
        role: "user",
        tokenVersion: 0,
        graduationMode: "suggest",
        timezone: null,
    locale: "zh",
        addressStyle: null,
        boundaries: null,
        trajectoryAssessment: "auto",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      locale: "zh",
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
  }

  it("is stored with the mood and the opening lines it was given", async () => {
    const caller = appRouter.createCaller(makeCtx());

    await caller.scene.create({
      name: "一起做饭",
      icon: "🍳",
      description: "在厨房里忙活",
      systemPromptOverlay: "你们在厨房里一起做饭。",
      emotionalState: "playful",
      starters: ["今天做什么？"],
    });

    expect(createScene).toHaveBeenCalledWith({
      name: "一起做饭",
      icon: "🍳",
      description: "在厨房里忙活",
      systemPromptOverlay: "你们在厨房里一起做饭。",
      emotionalState: "playful",
      starters: ["今天做什么？"],
      userId: 1,
      isBuiltin: false,
    });
  });

  it("refuses a mood the persona's state machine does not know", async () => {
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.scene.create({ name: "奇怪的状态", emotionalState: "elated" as any }),
    ).rejects.toThrow();
    expect(createScene).not.toHaveBeenCalled();
  });

  it("refuses a name it cannot store", async () => {
    const caller = appRouter.createCaller(makeCtx());

    await expect(caller.scene.create({ name: "" })).rejects.toThrow();
    await expect(caller.scene.create({ name: "x".repeat(101) })).rejects.toThrow();
    expect(createScene).not.toHaveBeenCalled();
  });
});
