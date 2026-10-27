import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The character card.
 *
 * It is what the user takes out of the app — into another tool, into
 * another model. So the opening lines on it are the persona's own: the
 * card should start the conversation the way the app does.
 */

const getPersonaById = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getScenes = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getScenes: (...a: unknown[]) => getScenes(...a),
}));

const personaDataToCard = vi.fn();

vi.mock("./persona-cards/mapping", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persona-cards/mapping")>();
  return {
    ...actual,
    personaDataToCard: (...a: unknown[]) => personaDataToCard(...a),
  };
});

const writeCardToPng = vi.fn();

vi.mock("./persona-cards/png", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persona-cards/png")>();
  return {
    ...actual,
    writeCardToPng: (...a: unknown[]) => writeCardToPng(...a),
  };
});

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

describe("the character card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小A",
      relationshipDesc: "恋人",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      intimacyLevel: "familiar",
      avatarUrl: null,
      activeSceneId: 7,
      personaData: { personality: "温柔" },
    });
    getMemoriesByPersonaId.mockResolvedValue([]);
    // The built-in scenes are listed first — that is the order the
    // database returns them in.
    getScenes.mockResolvedValue([
      { id: 1, name: "内置场景", starters: ["内置的第一句"], isBuiltin: true },
      { id: 7, name: "我自己的场景", starters: ["我自己的第一句"], isBuiltin: false },
    ]);
    personaDataToCard.mockReturnValue({ name: "小A" });
    writeCardToPng.mockReturnValue(Buffer.from("png"));
  });

  it("opens with the persona's own scene", async () => {
    await appRouter.createCaller(ctxFor(1)).personaCard.export({ personaId: 5 });

    expect(personaDataToCard).toHaveBeenCalled();
    const card = personaDataToCard.mock.calls[0][0];
    expect(card.sceneStarters).toEqual(["我自己的第一句"]);
  });

  it("opens with nothing when the persona has no scene", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小A",
      relationshipDesc: "恋人",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      intimacyLevel: "familiar",
      avatarUrl: null,
      activeSceneId: null,
      personaData: { personality: "温柔" },
    });

    await appRouter.createCaller(ctxFor(1)).personaCard.export({ personaId: 5 });

    const card = personaDataToCard.mock.calls[0][0];
    // Not a built-in scene's lines — the persona has no scene.
    expect(card.sceneStarters).toEqual([]);
  });
});
