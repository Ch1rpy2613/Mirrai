import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The pipeline runs a sequence of model calls. A model call can fail for
 * reasons that have nothing to do with the material — a timeout, a rate
 * limit, a provider that was briefly unavailable — so a failed run is
 * retried before the persona is marked as broken.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const getFilesByPersonaId = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();
const createChatSummary = vi.fn();
const updateSkillJobStage = vi.fn();

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
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

import { runSkillPipeline, pipelineRetryPolicy } from "./pipeline";

const input = {
  personaId: 1,
  userId: 1,
  characterFamily: "relationship" as const,
  name: "小A",
  chatContent: "我们昨天见面了。",
};

describe("the distillation pipeline", () => {
  const originalDelays = [...pipelineRetryPolicy.delaysMs];

  beforeEach(() => {
    // The real backoff exists to get past a rate limit; a test does not
    // want to wait for it.
    pipelineRetryPolicy.delaysMs = [0, 0];

    for (const fn of [
      invoke,
      updateSkillJob,
      updatePersona,
      createSkillJob,
      getFilesByPersonaId,
      runPythonTool,
      loadPrompt,
      createChatSummary,
      updateSkillJobStage,
      invokeForUser,
    ]) {
      fn.mockReset();
    }

    invokeForUser.mockImplementation(async (...a: unknown[]) => invoke(...a));
  invokeForUserWithReason.mockImplementation(async (...a: unknown[]) => ({ text: await invoke(...a) }));
    createSkillJob.mockResolvedValue(7);
    updateSkillJob.mockResolvedValue(undefined);
    updatePersona.mockResolvedValue(undefined);
    getFilesByPersonaId.mockResolvedValue([]);
    loadPrompt.mockReturnValue("prompt");
    runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
    // The analyzer succeeds; the builder fails, so the run breaks after the
    // first model call.
    invoke.mockResolvedValueOnce("{}").mockRejectedValue(new Error("provider exploded"));
  });

  afterEach(() => {
    pipelineRetryPolicy.delaysMs = [...originalDelays];
  });

  it("retries a failed run instead of giving up on the first error", async () => {
    await runSkillPipeline(input);

    // Two attempts: the first fails at the builder, the second fails at the
    // analyzer (the mock's first response is consumed).
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(3);
  }, 20_000);

  it("records the retry count on the job", async () => {
    await runSkillPipeline(input);

    const retryWrites = updateSkillJob.mock.calls.filter(
      (call) => (call[2] as any)?.retryCount !== undefined,
    );
    expect(retryWrites.length).toBeGreaterThan(0);
    // The final count is the number of attempts that were made.
    const last = retryWrites[retryWrites.length - 1][2] as any;
    expect(last.retryCount).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("marks the persona as failed only after the last attempt", async () => {
    await runSkillPipeline(input);

    const failureUpdates = updatePersona.mock.calls.filter(
      (call) => (call[2] as any)?.analysisStatus === "error",
    );
    expect(failureUpdates).toHaveLength(1);
  }, 20_000);

  it("does not mark the job as failed while it is still retrying", async () => {
    await runSkillPipeline(input);

    const errorStages = updateSkillJob.mock.calls.filter(
      (call) => (call[2] as any)?.pipelineStage === "error",
    );
    // The job only reaches "error" once the retries are exhausted.
    expect(errorStages).toHaveLength(1);
  }, 20_000);
});
