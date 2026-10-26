import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Running the ruler.
 *
 * The ruler has to survive the real world: a provider that times out on
 * one line, a persona with no rules, a case the model answers with
 * nothing. A measurement that stops at the first bad answer is not a
 * measurement — it is a coin toss.
 */
const invokeWithProvider = vi.fn();
const buildPromptForPersona = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => ({
    name: "test",
    isConfigured: () => true,
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
  }),
}));

vi.mock("../chat/prompt", () => ({
  buildPromptForPersona: (...a: unknown[]) => buildPromptForPersona(...a),
}));

import { runEval } from "./run";
import type { EvalCaseData } from "./dataset";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: {
    personality: "温柔",
    speakingStyle: "短句",
    microRules: [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷",
        confidence: 1,
        source: "manual",
        verified: true,
        evidence: [],
      },
    ],
  },
} as any;

function cases(): EvalCaseData[] {
  return [
    {
      context: [
        { role: "user", content: "在吗", timestamp: null },
        { role: "assistant", content: "在的", timestamp: null },
      ],
      expected: { role: "assistant", content: "嗯嗯", timestamp: null },
      expectedState: null,
    },
    {
      context: [
        { role: "user", content: "今天好累", timestamp: null },
        { role: "assistant", content: "怎么了", timestamp: null },
      ],
      expected: { role: "assistant", content: "早点睡", timestamp: null },
      expectedState: null,
    },
  ];
}

beforeEach(() => {
  invokeWithProvider.mockReset();
  buildPromptForPersona.mockReset();
  buildPromptForPersona.mockResolvedValue("【系统】");
  invokeWithProvider.mockResolvedValue("嗯嗯");
});

describe("running the cases", () => {
  it("scores what the persona said", async () => {
    const metrics = await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯", "怎么了", "早点睡"],
    });
    expect(metrics.cases).toBe(2);
    expect(metrics.overlap).toBeGreaterThan(0);
  });

  it("prompts the persona the way the conversation does", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });
    expect(buildPromptForPersona).toHaveBeenCalled();
    const context = buildPromptForPersona.mock.calls[0][0] as any;
    expect(context.persona).toBe(persona);
  });

  it("keeps the persona's rules by default", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });
    const context = buildPromptForPersona.mock.calls[0][0] as any;
    // Undefined means "the persona's own rules"; null means "off".
    expect(context.microRules).toBeUndefined();
  });

  it("switches the rules off for the control run", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      variant: "withoutRules",
    });
    const context = buildPromptForPersona.mock.calls[0][0] as any;
    expect(context.microRules).toBeNull();
    expect(context.imperfectionProfile).toBeNull();
  });

  it("does not stop at the first line the provider fails on", async () => {
    invokeWithProvider
      .mockRejectedValueOnce(new Error("provider exploded"))
      .mockResolvedValue("早点睡");

    const metrics = await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });
    // The failed case is skipped; the other one is still scored.
    expect(metrics.cases).toBe(1);
  });

  it("skips a case the model answered with nothing", async () => {
    invokeWithProvider.mockResolvedValueOnce("   ").mockResolvedValue("早点睡");
    const metrics = await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });
    expect(metrics.cases).toBe(1);
  });

  it("reports how far it got", async () => {
    const progress: number[] = [];
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      onProgress: (done) => progress.push(done),
    });
    expect(progress).toEqual([1, 2]);
  });

  it("says so when there is no provider at all", async () => {
    const module = await import("../llm/user-provider");
    vi.spyOn(module, "resolveProviderForUser").mockResolvedValueOnce(undefined as any);
    await expect(
      runEval({ persona, userId: 1, cases: cases(), trainingTexts: ["嗯嗯"] }),
    ).rejects.toThrow(/provider/i);
  });

  it("skips a case the provider answered with something that is not a line", async () => {
    invokeWithProvider
      .mockResolvedValueOnce({ text: "早点睡" } as any)
      .mockResolvedValue("早点睡");

    const metrics = await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });

    // A provider that answers with something else has misbehaved, and
    // the case is skipped rather than scored against nonsense.
    expect(metrics.cases).toBe(1);
  });

  it("reports progress even for the case it had to skip", async () => {
    const progress: number[] = [];
    invokeWithProvider.mockResolvedValueOnce("   ").mockResolvedValue("早点睡");

    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      onProgress: (done) => progress.push(done),
    });

    expect(progress).toEqual([1, 2]);
  });

  it("shows the persona the conversation the way the chat does", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });

    const request = invokeWithProvider.mock.calls[0][1] as any;
    expect(request.messages[0]).toEqual({ role: "system", content: "【系统】" });
    expect(request.messages[1]).toEqual({ role: "user", content: "在吗" });
    expect(request.messages[2]).toEqual({ role: "assistant", content: "在的" });
    // The line that was held out must not be in the conversation, or the
    // persona could copy it back.
    expect(request.messages.some((m: any) => m.content === "嗯嗯")).toBe(false);
  });

  it("asks for a short line by default", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
    });

    const request = invokeWithProvider.mock.calls[0][1] as any;
    expect(request.options.maxTokens).toBe(200);
    expect(request.options.temperature).toBe(0.7);
  });

  it("takes the size and the temperature it was given", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      maxTokens: 50,
      temperature: 0.1,
    });

    const request = invokeWithProvider.mock.calls[0][1] as any;
    expect(request.options.maxTokens).toBe(50);
    expect(request.options.temperature).toBe(0.1);
  });

  it("passes the language it was given to the prompt", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      locale: "en",
    });

    const context = buildPromptForPersona.mock.calls[0][0] as any;
    expect(context.locale).toBe("en");
  });

  it("measures the rules-only run the same way as the default one", async () => {
    await runEval({
      persona,
      userId: 1,
      cases: cases(),
      trainingTexts: ["嗯嗯"],
      variant: "withRulesOnly",
    });

    const context = buildPromptForPersona.mock.calls[0][0] as any;
    // The rules stay on; the per-state imperfection goes off. An arm
    // called "rules only" that also carried the imperfection would
    // measure the same persona twice and call it a comparison.
    expect(context.microRules).toBeUndefined();
    expect(context.imperfectionProfile).toBeNull();
  });
});
