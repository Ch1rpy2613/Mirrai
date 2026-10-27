import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * A miniature database for the behavioural tests below.
 *
 * Each helper mirrors the SQL predicate it stands in for: a row is only
 * returned when the caller's user id matches the row's owner. That is what
 * makes the cross-user assertions meaningful — the router is exercised
 * end-to-end, and the filter is simulated rather than assumed.
 */
const store = {
  skillJobs: [
    { id: 7, userId: 1, personaId: 5, pipelineStage: "complete", analysisResult: { private: "A's data" } },
  ],
  scenes: [
    { id: 3, userId: 1, name: "A 的场景", isBuiltin: false },
    { id: 4, userId: null, name: "内置场景", isBuiltin: true },
  ],
  personas: [
    { id: 5, userId: 1, name: "A 的分身" },
  ],
};

const getSkillJobById = vi.fn(async (id: number, userId: number) =>
  store.skillJobs.find((row) => row.id === id && row.userId === userId),
);
const getSceneById = vi.fn(async (id: number, userId: number) =>
  store.scenes.find(
    (row) => row.id === id && (row.isBuiltin || row.userId === userId),
  ),
);
const deleteScene = vi.fn(async (id: number, userId: number) => {
  const index = store.scenes.findIndex(
    (row) => row.id === id && !row.isBuiltin && row.userId === userId,
  );
  if (index === -1) return false;
  store.scenes.splice(index, 1);
  return true;
});
const getPersonaById = vi.fn(async (id: number, userId: number) =>
  store.personas.find((row) => row.id === id && row.userId === userId),
);
const deletePersona = vi.fn(async (id: number, userId: number) => {
  const index = store.personas.findIndex(
    (row) => row.id === id && row.userId === userId,
  );
  if (index === -1) return false;
  store.personas.splice(index, 1);
  return true;
});

vi.mock("./db", () => ({
  getSkillJobById: (id: number, userId: number) => getSkillJobById(id, userId),
  getSceneById: (id: number, userId: number) => getSceneById(id, userId),
  deleteScene: (id: number, userId: number) => deleteScene(id, userId),
  getPersonaById: (id: number, userId: number) => getPersonaById(id, userId),
  deletePersona: (id: number, userId: number) => deletePersona(id, userId),
  // Everything else the routers import has to exist, even if the tests here
  // never call it.
  createPersona: vi.fn().mockResolvedValue(1),
  getPersonasByUserId: vi.fn().mockResolvedValue([]),
  updatePersona: vi.fn(),
  getPersonasWithStats: vi.fn().mockResolvedValue([]),
  getUserStats: vi.fn().mockResolvedValue({}),
  getRecentActivity: vi.fn().mockResolvedValue([]),
  getDailyChatCounts: vi.fn().mockResolvedValue([]),
  createPersonaFile: vi.fn(),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn(),
  getMessagesByPersonaId: vi.fn().mockResolvedValue([]),
  clearMessagesByPersonaId: vi.fn(),
  searchMessages: vi.fn().mockResolvedValue([]),
  createWechatBinding: vi.fn(),
  getWechatBindingsByUserId: vi.fn().mockResolvedValue([]),
  deleteWechatBinding: vi.fn(),
  setWechatBindingPersona: vi.fn(),
  getLlmConfigsByUserId: vi.fn().mockResolvedValue([]),
  upsertLlmConfig: vi.fn(),
  setDefaultLlmConfig: vi.fn(),
  getDefaultLlmConfig: vi.fn().mockResolvedValue(null),
  updateUserProfile: vi.fn(),
  updateUserPassword: vi.fn(),
  deleteUserAccount: vi.fn(),
  getAccountStats: vi.fn().mockResolvedValue({}),
  exportUserData: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn(),
  bumpUserTokenVersion: vi.fn(),
  createMemory: vi.fn(),
  getMemoriesByPersonaId: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
  createEmotionSnapshot: vi.fn(),
  getEmotionSnapshots: vi.fn().mockResolvedValue([]),
  getEmotionReport: vi.fn().mockResolvedValue({}),
  getTodaySnapshot: vi.fn(),
  getIntimacyData: vi.fn().mockResolvedValue({}),
  updateIntimacy: vi.fn(),
  getMessageVolume: vi.fn().mockResolvedValue([]),
  getEmotionTimeline: vi.fn().mockResolvedValue([]),
  getPersonaEngagement: vi.fn().mockResolvedValue([]),
  getHourlyDistribution: vi.fn().mockResolvedValue([]),
  getAnalyticsStats: vi.fn().mockResolvedValue({}),
  createDiaryEntry: vi.fn(),
  getDiaryEntries: vi.fn().mockResolvedValue([]),
  getDiaryByDate: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  getMessagesByDate: vi.fn().mockResolvedValue([]),
  getDiaryDates: vi.fn().mockResolvedValue([]),
  getScenes: vi.fn().mockResolvedValue([]),
  createScene: vi.fn(),
  activateScene: vi.fn(),
  getExportData: vi.fn().mockResolvedValue(null),
  getRecentEmotionTrend: vi.fn().mockResolvedValue([]),
  getMessageCountInRange: vi.fn().mockResolvedValue(0),
  setGraduationStatus: vi.fn(),
  getChannelBindingsByUserId: vi.fn().mockResolvedValue([]),
  getChannelBinding: vi.fn(),
  setChannelBindingPersona: vi.fn(),
  deleteChannelBinding: vi.fn(),
  getChannelState: vi.fn(),
  upsertChannelState: vi.fn(),
  getUserTemplates: vi.fn().mockResolvedValue([]),
  createUserTemplate: vi.fn(),
  updateUserTemplate: vi.fn(),
  deleteUserTemplate: vi.fn(),
  createQuestionnaireAnswers: vi.fn(),
  getActiveReminders: vi.fn().mockResolvedValue([]),
  dismissReminder: vi.fn(),
  appendPersonaCorrection: vi.fn(),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Static analysis ──────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
const db = readFileSync(path.join(ROOT, "server", "db.ts"), "utf-8");

/**
 * A parameter that identifies a row.
 *
 * The list was fixed, and it did not match every shape an id takes:
 * `openId`, `ids`, and any name of the form `xxxId` where the suffix
 * is capitalised. So a helper written as `deleteLetterRow(letterId,
 * userId)` would take a row id, never be caught by "requires a userId
 * on every helper that takes a row identifier", and could ship an
 * unscoped query.
 *
 * So the shape is matched rather than the list: a name that ends in
 * "Id", or that is "id", "ids", "ids" or a key.
 */
const ID_PARAM =
  /\b(id|ids|openId|jobKey|[A-Za-z_]*Id|[A-Za-z_]*Ids)\b/;

interface DbFunction {
  name: string;
  params: string;
  body: string;
}

/**
 * Every exported helper in db.ts, with its body.
 *
 * The scan used to match only `export async function` — so a helper
 * written as `export function` or as `export const x = async () =>`
 * would escape every assertion. There are none like that today, but
 * the point of this test is to catch the *next* one.
 */
function exportedFunctions(src: string): DbFunction[] {
  const out: DbFunction[] = [];
  // The return type is optional and may itself contain braces, so it is
  // matched loosely up to the opening brace of the body.
  const patterns = [
    /export (?:async )?function (\w+)\(([^)]*)\)\s*(?::[^{]+)?\{/g,
    /export const (\w+)\s*=\s*async\s*\(([^)]*)\)\s*(?::[^{]+)?=>\s*\{/g,
  ];
  let match: RegExpExecArray | null;

  for (const pattern of patterns) {
    while ((match = pattern.exec(src)) !== null) {
      let i = match.index + match[0].length - 1;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      const body = src.slice(match.index + match[0].length, i);
      out.push({
        name: match[1],
        params: match[2].split(/\s+/).join(" "),
        body,
      });
    }
  }
  return out;
}

const functions = exportedFunctions(db);

/**
 * True when the function only ever touches the user's own row.
 *
 * `getUserById`, `updateUserProfile` and friends take the user's id — that
 * *is* the owner, so there is nothing to filter on. The distinguishing mark
 * is that they query the `users` table.
 */
function isUserScoped(fn: DbFunction): boolean {
  return /eq\(\s*users\.id\s*,/.test(fn.body) && !/personaId|jobId|sceneId|memoryId/.test(fn.params);
}

/**
 * True when the helper actually binds the row to the caller.
 *
 * Having a `userId` in the signature is not the same as using it. A
 * helper that takes the caller's id and then queries by the row id
 * alone will hand back somebody else's private data, and the signature
 * will look perfectly innocent — so the check has to be on the query,
 * not on the parameters.
 */
function bindsOwnership(fn: DbFunction): boolean {
  // The ordinary case: the query is filtered by the owner.
  if (/eq\(\s*\w+\.userId\s*,/.test(fn.body)) return true;
  /**
   * The same thing, written as raw SQL.
   *
   * `getScenes` asks for the built-in scenes *or* the caller's own:
   * `sql`${scenes.isBuiltin} = true OR ${scenes.userId} = ${userId}``.
   * The owner is bound — the check just could not see it, because it
   * looked for `eq(table.userId, userId)` and that is not what is
   * written there.
   */
  if (/\$\{\w+\.userId\}\s*=\s*\$\{userId\}/.test(fn.body)) return true;
  // A helper that only creates rows owns them by writing the owner in.
  if (
    /\.insert\(/.test(fn.body) &&
    !/\.update\(|\.delete\(|\.select\(/.test(fn.body)
  ) {
    if (/userId\s*[:,]/.test(fn.body)) return true;
    // The whole parameter object is written out, and that object
    // carries the owner.
    const names = (fn.params.match(/(\w+)\s*:/g) ?? []).map((n) =>
      n.replace(/\s*:/, ""),
    );
    return names.some((name) => new RegExp(`\\.\\.\\.${name}\\b`).test(fn.body));
  }
  return false;
}

describe("db helpers enforce ownership", () => {
  it("finds the exported functions", () => {
    expect(functions.length).toBeGreaterThan(50);
  });

  it("filters by the user id, rather than only taking it", () => {
    // The signature is not the guarantee. The query is.
    const unfiltered = functions
      .filter((fn) => ID_PARAM.test(fn.params))
      .filter((fn) => fn.params.includes("userId"))
      .filter((fn) => !isUserScoped(fn))
      .filter((fn) => !bindsOwnership(fn))
      .map((fn) => `${fn.name}(${fn.params})`);

    expect(
      unfiltered,
      "these helpers take a user id but never bind the row to it",
    ).toEqual([]);
  });

  it("requires a userId on every helper that takes a row identifier", () => {
    const unguarded = functions
      .filter((fn) => ID_PARAM.test(fn.params))
      .filter((fn) => !fn.params.includes("userId"))
      .filter((fn) => !isUserScoped(fn))
      // The WeChat login path: a person is looked up by their open id
      // before they have an account here, so there is no owner to
      // check yet — the open id is how the channel says who they are.
      .filter((fn) => fn.name !== "getUserByOpenId")
      .map((fn) => `${fn.name}(${fn.params})`);

    expect(
      unguarded,
      "these helpers take a row identifier but never check who owns the row",
    ).toEqual([]);
  });

  it("leaves only the user-scoped helpers without a userId", () => {
    const withoutUserId = functions
      .filter((fn) => ID_PARAM.test(fn.params))
      .filter((fn) => !fn.params.includes("userId"))
      .map((fn) => fn.name)
      .sort();

    // These operate on the caller's own user row — the id *is* the owner.
    expect(withoutUserId).toEqual([
      "bumpUserTokenVersion",
      "deleteUserAccount",
      "getUserById",
      /**
       * The WeChat login path.
       *
       * A person on WeChat is looked up by their WeChat open id
       * *before* they have an account here — that is what the open id
       * is for. There is no owner to check yet: the open id is how the
       * channel says who they are.
       */
      "getUserByOpenId",
      "updateUserGraduationMode",
      "updateUserLastSignedIn",
      "updateUserPassword",
      "updateUserProfile",
      "updateUserTrajectoryAssessment",
    ]);
  });

  it("filters the plan's named helpers by user", () => {
    const named = [
      "getSkillJobById",
      "deleteScene",
      "activateScene",
      "getSceneById",
      "getFilesByPersonaId",
      "getMessagesByPersonaId",
      "getMemoriesByPersonaId",
      "getEmotionSnapshots",
      "getEmotionReport",
      "getRecentEmotionTrend",
      "getMessageCountInRange",
    ];

    for (const name of named) {
      const fn = functions.find((f) => f.name === name);
      expect(fn, `${name} must exist`).toBeDefined();
      expect(fn!.params, `${name} must take a userId`).toContain("userId");
    }
  });

  it("checks ownership before deleting a persona's rows", () => {
    const fn = functions.find((f) => f.name === "deletePersona");
    expect(fn).toBeDefined();
    // The ownership lookup has to come before the first delete.
    const checkIndex = fn!.body.indexOf("getPersonaById");
    const firstDelete = fn!.body.indexOf("tx.delete");
    expect(checkIndex, "deletePersona must check ownership").toBeGreaterThan(-1);
    expect(checkIndex, "the ownership check must come first").toBeLessThan(firstDelete);
  });

  it("scopes every row delete in deletePersona to the owner", () => {
    const fn = functions.find((f) => f.name === "deletePersona");
    const deletes = Array.from(fn!.body.matchAll(/tx\.delete\((\w+)\)\.where\(([^;]+)\)/g));
    expect(deletes.length).toBeGreaterThan(10);

    const unscoped = deletes
      .filter(([, , where]) => !/userId/.test(where))
      .map(([, table]) => table);
    expect(unscoped, "these deletes are not scoped to the owner").toEqual([]);
  });
});

// ─── Behavioural cross-user isolation ─────────────────────────────────────

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      name: `User ${userId}`,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("a user cannot reach another user's data", () => {
  beforeEach(() => {
    store.skillJobs = [
      { id: 7, userId: 1, personaId: 5, pipelineStage: "complete", analysisResult: { private: "A's data" } },
    ];
    store.scenes = [
      { id: 3, userId: 1, name: "A 的场景", isBuiltin: false },
      { id: 4, userId: null, name: "内置场景", isBuiltin: true },
    ];
    store.personas = [{ id: 5, userId: 1, name: "A 的分身" }];
    vi.clearAllMocks();
  });

  it("hides another user's distillation job (acceptance 0-C)", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const callerB = appRouter.createCaller(ctxFor(2));

    // The owner can read their own job.
    const own = await callerA.skillEngine.getJobStatus({ jobId: 7 });
    expect(own.id).toBe(7);

    // Somebody else cannot.
    await expect(
      callerB.skillEngine.getJobStatus({ jobId: 7 }),
    ).rejects.toThrow(/not found|NOT_FOUND/i);
  });

  it("refuses to delete another user's scene (acceptance 0-C)", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));

    await expect(callerB.scene.delete({ id: 3 })).rejects.toThrow();

    // The scene is still there.
    expect(store.scenes.some((s) => s.id === 3)).toBe(true);
  });

  it("refuses to delete a built-in scene", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    await expect(callerA.scene.delete({ id: 4 })).rejects.toThrow();
    expect(store.scenes.some((s) => s.id === 4)).toBe(true);
  });

  it("lets the owner delete their own scene", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const result = await callerA.scene.delete({ id: 3 });
    expect(result).toEqual({ success: true });
    expect(store.scenes.some((s) => s.id === 3)).toBe(false);
  });

  it("refuses to delete another user's persona (acceptance 0-C)", async () => {
    const callerB = appRouter.createCaller(ctxFor(2));

    await expect(callerB.persona.delete({ id: 5 })).rejects.toThrow();

    // The persona and its rows are untouched.
    expect(store.personas.some((p) => p.id === 5)).toBe(true);
  });

  it("lets the owner delete their own persona", async () => {
    const callerA = appRouter.createCaller(ctxFor(1));
    const result = await callerA.persona.delete({ id: 5 });
    expect(result).toEqual({ success: true });
    expect(store.personas.some((p) => p.id === 5)).toBe(false);
  });
});
