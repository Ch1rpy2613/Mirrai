import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The celebrity research flow, end to end.
 *
 * The plan asks for four observable stages — `researching`, `auditing`,
 * `synthesizing`, `validating` — and for the research profile to be recorded
 * on the job. Both used to be unreachable: the profile never reached the
 * router, so the flow never started.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const updateSkillJob = vi.fn();
const createSkillJob = vi.fn();
const updatePersona = vi.fn();
const getFilesByPersonaId = vi.fn();
const loadPrompt = vi.fn();
const runPythonTool = vi.fn();
const runQualityCheck = vi.fn();
const saveResearchProfile = vi.fn();
const updateResearchProfile = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const getLatestChatSummary = vi.fn();
const createChatSummary = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();
const touchMemoryRecalled = vi.fn();
const createSafetyEvent = vi.fn();
const getLastMessageAt = vi.fn();
const getMessageCountSince = vi.fn();
const getDailyChatCounts = vi.fn();
const createGraduationAssessment = vi.fn();
const getMessagesSince = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
  invokeForUser: (...a: unknown[]) => invokeForUser(...a),
  invokeForUserWithReason: (...a: unknown[]) => invokeForUserWithReason(...a),
}));

vi.mock("../db", () => ({
    getSkillJobById: vi.fn().mockResolvedValue(undefined),
updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getMessageCountSince: (...a: unknown[]) => getMessageCountSince(...a),
  getDailyChatCounts: (...a: unknown[]) => getDailyChatCounts(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
}));

// The mock factories are hoisted above the module body, so the holder has
// to be hoisted with them.
const registryHolder = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("./prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompts")>();
  // Captured while the skill-engine directory still points at the
  // repository, so the registry is the real one.
  registryHolder.value = actual.loadRegistry();
  return {
    ...actual,
    // The registry is real — it decides which stages a profile unlocks.
    loadPrompt: (...a: unknown[]) => loadPrompt(...a),
    loadRegistry: () => registryHolder.value,
  };
});

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./celebrity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./celebrity")>();
  return {
    ...actual,
    runQualityCheck: (...a: unknown[]) => runQualityCheck(...a),
    saveResearchProfile: (...a: unknown[]) => saveResearchProfile(...a),
    updateResearchProfile: (...a: unknown[]) => updateResearchProfile(...a),
  };
});

import { runSkillPipeline } from "./pipeline";
import { ENV } from "../_core/env";

describe("the celebrity research flow", () => {
  let skillDir: string;
  let originalSkillEngineDir: string;

  afterEach(() => {
    if (originalSkillEngineDir) ENV.skillEngineDir = originalSkillEngineDir;
    if (skillDir) rmSync(skillDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const fn of [
      invoke,
      updateSkillJob,
      createSkillJob,
      updatePersona,
      getFilesByPersonaId,
      loadPrompt,
      runPythonTool,
      runQualityCheck,
      saveResearchProfile,
      updateResearchProfile,
      getLatestGraduationAssessment,
      getLatestChatSummary,
      createChatSummary,
      getMessagesByPersonaId,
      getMemoriesByPersonaId,
      getSceneById,
      getTodaySnapshot,
      createEmotionSnapshot,
      getIntimacyData,
      updateIntimacy,
      getRecentEmotionTrend,
      getMessageCountInRange,
      setGraduationStatus,
      touchMemoryRecalled,
      createSafetyEvent,
      getLastMessageAt,
      getMessageCountSince,
      getDailyChatCounts,
      createGraduationAssessment,
      getMessagesSince,
      invokeForUser,
    ]) {
      fn.mockReset();
    }

    skillDir = mkdtempSync(path.join(os.tmpdir(), "mirrai-celebrity-"));
    // The pipeline writes its skill package under the skill-engine
    // directory. Point that at a temporary one so a test run does not leave
    // generated output in the repository.
    originalSkillEngineDir = ENV.skillEngineDir;
    ENV.skillEngineDir = skillDir;

    invokeForUser.mockImplementation(async (...a: unknown[]) => invoke(...a));
    invokeForUserWithReason.mockImplementation(async (...a: unknown[]) => ({ text: await invoke(...a) }));
    createSkillJob.mockResolvedValue(7);
    updateSkillJob.mockResolvedValue(undefined);
    updatePersona.mockResolvedValue(undefined);
    getFilesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(undefined);
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getTodaySnapshot.mockResolvedValue(undefined);
    getIntimacyData.mockResolvedValue({
      chatCount: 1, totalMessages: 2, memoryCount: 0,
      emotionVariety: 0, daysSinceCreation: 1, consecutiveDays: 1,
    });
    getRecentEmotionTrend.mockResolvedValue([]);
    getMessageCountInRange.mockResolvedValue(0);
    getLatestGraduationAssessment.mockResolvedValue(undefined);
    getLastMessageAt.mockResolvedValue(new Date());
    getMessageCountSince.mockResolvedValue(1);
    getDailyChatCounts.mockResolvedValue([]);
    getMessagesSince.mockResolvedValue([]);
    loadPrompt.mockReturnValue("prompt");
    runPythonTool.mockResolvedValue({ stdout: "{}", stderr: "" });
    runQualityCheck.mockResolvedValue({ ok: true, checks: [], issues: [] });
    saveResearchProfile.mockResolvedValue(3);
    updateResearchProfile.mockResolvedValue(undefined);
    // The research stages ask the model for structured JSON; the shape is
    // repaired by the normalisers, so a minimal object is enough.
    invoke.mockResolvedValue("{}");
  });

  it("runs the four research stages and records the profile on the job", async () => {
    await runSkillPipeline({
      personaId: 1,
      userId: 1,
      characterFamily: "celebrity",
      name: "某人",
      chatContent: "一些素材",
      researchProfile: "budget-unfriendly",
    });

    // The profile is stored on the job row, so the UI can show which
    // research profile a run used.
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({ researchProfile: "budget-unfriendly" }),
    );

    // The four research stages, in order, are written to the job.
    const stages = updateSkillJob.mock.calls
      .map((call) => (call[2] as any)?.pipelineStage)
      .filter(Boolean);

    const researchStages = stages.filter((s: string) =>
      ["researching", "auditing", "synthesizing", "validating"].includes(s),
    );
    expect(researchStages).toEqual([
      "researching",
      "auditing",
      "synthesizing",
      "validating",
    ]);

    // And the run finishes.
    expect(stages).toContain("complete");
  }, 30_000);

  it("does not run the research flow without a research profile", async () => {
    await runSkillPipeline({
      personaId: 1,
      userId: 1,
      characterFamily: "celebrity",
      name: "某人",
      chatContent: "一些素材",
    });

    const stages = updateSkillJob.mock.calls
      .map((call) => (call[2] as any)?.pipelineStage)
      .filter(Boolean);

    expect(stages).not.toContain("researching");
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({ researchProfile: null }),
    );
  }, 30_000);

  it("does not run the research flow for a non-celebrity family", async () => {
    await runSkillPipeline({
      personaId: 1,
      userId: 1,
      characterFamily: "relationship",
      name: "某人",
      chatContent: "一些素材",
      researchProfile: "budget-unfriendly",
    });

    const stages = updateSkillJob.mock.calls
      .map((call) => (call[2] as any)?.pipelineStage)
      .filter(Boolean);

    expect(stages).not.toContain("researching");
  }, 30_000);
});
