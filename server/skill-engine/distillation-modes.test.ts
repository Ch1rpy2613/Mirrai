import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The distillation presets.
 *
 * A preset is a promise about a run: this much material, this many photos,
 * this many model calls. The tests below check that the promise is kept —
 * that the pipeline really reads the amount the preset says, and that a
 * caller which does not choose a preset gets exactly the behaviour the app
 * had before the presets existed.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
  invokeForUser: (...a: unknown[]) => invokeForUser(...a),
}));

vi.mock("../db", () => ({
  updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  createChatSummary: vi.fn(),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

// The celebrity research flow is a whole pipeline of its own; the presets
// only need to know whether it runs.
vi.mock("./celebrity", () => ({
  resolveCelebrityProfile: (family: string, profile?: string | null) => ({
    profile: family === "celebrity" ? profile ?? null : null,
    hasResearchStages: family === "celebrity" && profile === "budget-unfriendly",
  }),
  runCelebrityResearch: vi.fn().mockResolvedValue(null),
  runQualityCheck: vi.fn().mockResolvedValue(null),
  sanitizeForCopyright: (text: string) => text,
  saveResearchProfile: vi.fn(),
  AGENTIC_PROTOCOL: "",
}));

import { runSkillPipeline } from "./pipeline";
import {
  DEFAULT_DISTILLATION_MODE,
  DISTILLATION_PRESETS,
  getDistillationPreset,
  isDistillationMode,
} from "@shared/distillation-modes";

/** The persona data the structurer is expected to return. */
const PERSONA_JSON = JSON.stringify({
  personality: "温柔",
  speakingStyle: "简短",
  catchphrases: ["嗯"],
  nickname: "宝",
  attachmentStyle: "安全型",
  loveLanguage: "陪伴",
  conflictStyle: "冷战",
  touchingMoments: "一次旅行",
  memories: "很多回忆",
  summary: "一个温柔的人",
});

const baseInput = {
  personaId: 1,
  userId: 1,
  characterFamily: "relationship" as const,
  name: "小A",
  chatContent: "字".repeat(50_000),
};

/** The material the analysis stage was given. */
function analyzerMaterial(): string {
  const call = invoke.mock.calls.find((c) =>
    JSON.stringify(c[0]).includes("聊天记录/素材"),
  );
  const messages = (call?.[0] as any)?.messages ?? [];
  const user = messages.find((m: any) => m.role === "user");
  const content = String(user?.content ?? "");
  return content.split("聊天记录/素材：\n")[1] ?? "";
}

/** The options the analysis stage was called with. */
function analyzerOptions(): any {
  const call = invoke.mock.calls.find((c) =>
    JSON.stringify(c[0]).includes("聊天记录/素材"),
  );
  return (call?.[0] as any)?.options ?? {};
}

/** How many photos the image stage was given. */
function describedPhotos(): number {
  const call = invoke.mock.calls.find((c) => {
    const content = (c[0] as any)?.messages?.[0]?.content;
    return Array.isArray(content) && content.some((part: any) => part.type === "image_url");
  });
  const content = (call?.[0] as any)?.messages?.[0]?.content ?? [];
  return content.filter((part: any) => part.type === "image_url").length;
}

beforeEach(() => {
  for (const fn of [invoke, invokeForUser, updateSkillJob, updatePersona, createSkillJob, runPythonTool, loadPrompt]) {
    fn.mockReset();
  }
  invokeForUser.mockImplementation(async (...a: unknown[]) => invoke(...a));
  createSkillJob.mockResolvedValue(7);
  updateSkillJob.mockResolvedValue(undefined);
  updatePersona.mockResolvedValue(undefined);
  loadPrompt.mockReturnValue("prompt");
  runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
  invoke.mockResolvedValue(PERSONA_JSON);
});

describe("the preset list", () => {
  it("names every preset once", () => {
    const ids = DISTILLATION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["fast", "standard", "deep", "colleague", "celebrity"]);
  });

  it("only uses families and research profiles the pipeline knows", () => {
    for (const preset of DISTILLATION_PRESETS) {
      expect(["relationship", "colleague", "celebrity"]).toContain(preset.characterFamily);
      expect([null, "budget-friendly", "budget-unfriendly"]).toContain(preset.researchProfile);
      expect(preset.chatSampleLimit).toBeGreaterThan(0);
      expect(preset.maxImages).toBeGreaterThan(0);
      expect(preset.approxCalls).toBeGreaterThan(0);
      expect(preset.analysisTemperature).toBeGreaterThan(0);
      expect(preset.analysisTemperature).toBeLessThan(1);
    }
  });

  it("keeps the standard preset at the values the app always used", () => {
    // The standard preset is what a run without a choice gets, so it has
    // to be exactly what the app did before the presets existed.
    const standard = getDistillationPreset(DEFAULT_DISTILLATION_MODE);
    expect(standard.chatSampleLimit).toBe(10_000);
    expect(standard.maxImages).toBe(6);
    expect(standard.analysisTemperature).toBe(0.3);
    expect(standard.characterFamily).toBe("relationship");
    expect(standard.researchProfile).toBe(null);
  });

  it("falls back to the standard preset for a mode it does not know", () => {
    expect(getDistillationPreset("nonsense").id).toBe("standard");
    expect(getDistillationPreset(null).id).toBe("standard");
    expect(getDistillationPreset(undefined).id).toBe("standard");
    expect(isDistillationMode("nonsense")).toBe(false);
    expect(isDistillationMode("deep")).toBe(true);
  });
});

describe("the pipeline and the presets", () => {
  it("reads the amount of material the preset says", async () => {
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    // The material is fenced now — it is the user's own chat log, and
    // it can say anything — so the fence is around the amount the
    // preset allows.
    const material = analyzerMaterial();
    expect(material).toContain("<<<MATERIAL");
    expect(material).toContain("<<<END MATERIAL>>>");
    const inside = material.split("MATERIAL>>>\n")[1]?.split("\n<<<END MATERIAL>>>")[0] ?? "";
    expect(inside.length).toBe(30_000);
  }, 20_000);

  it("reads the historical amount when no preset is named", async () => {
    await runSkillPipeline({ ...baseInput });
    const material = analyzerMaterial();
    const inside = material.split("MATERIAL>>>\n")[1]?.split("\n<<<END MATERIAL>>>")[0] ?? "";
    expect(inside.length).toBe(10_000);
  }, 20_000);

  it("runs the extraction stages at the preset's temperature", async () => {
    await runSkillPipeline({ ...baseInput, mode: "fast" });
    expect(analyzerOptions().temperature).toBe(0.2);
  }, 20_000);

  it("describes at most as many photos as the preset allows", async () => {
    const imageUrls = Array.from({ length: 12 }, (_, i) => `https://example.test/${i}.png`);
    await runSkillPipeline({ ...baseInput, mode: "deep", imageUrls });
    expect(describedPhotos()).toBe(12);
  }, 20_000);

  it("describes fewer photos in the quick preset", async () => {
    const imageUrls = Array.from({ length: 12 }, (_, i) => `https://example.test/${i}.png`);
    await runSkillPipeline({ ...baseInput, mode: "fast", imageUrls });
    expect(describedPhotos()).toBe(3);
  }, 20_000);

  it("lets the preset decide the family, even when another one was passed", async () => {
    await runSkillPipeline({
      ...baseInput,
      characterFamily: "relationship",
      mode: "colleague",
    });
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({ characterFamily: "colleague" }),
    );
  }, 20_000);

  it("passes the family through when no preset is named", async () => {
    await runSkillPipeline({ ...baseInput, characterFamily: "colleague" });
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({ characterFamily: "colleague" }),
    );
  }, 20_000);

  it("runs the research flow for the public figure preset", async () => {
    await runSkillPipeline({ ...baseInput, mode: "celebrity" });
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({
        characterFamily: "celebrity",
        researchProfile: "budget-unfriendly",
      }),
    );
  }, 20_000);

  it("records the preset on the job row", async () => {
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    expect(createSkillJob).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMeta: expect.objectContaining({ distillationMode: "deep" }),
      }),
    );
  }, 20_000);
});
