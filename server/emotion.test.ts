import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.fn();

vi.mock("./llm", () => ({
  llmService: { invoke: (...args: unknown[]) => invoke(...args) },
}));

import { inferEmotionalState, isEmotionalState, EMOTIONAL_STATES } from "./_core/emotion";

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isEmotionalState", () => {
  it("accepts every valid state", () => {
    for (const state of EMOTIONAL_STATES) {
      expect(isEmotionalState(state)).toBe(true);
    }
  });

  it("rejects unknown or non-string values", () => {
    expect(isEmotionalState("angry")).toBe(false);
    expect(isEmotionalState("")).toBe(false);
    expect(isEmotionalState(null)).toBe(false);
    expect(isEmotionalState(42)).toBe(false);
  });
});

describe("inferEmotionalState", () => {
  it("uses the state the LLM returns", async () => {
    invoke.mockResolvedValue('{"state":"nostalgic","reason":"提到从前"}');
    const result = await inferEmotionalState({
      userMessage: "你还记得那年吗",
      assistantReply: "记得啊，那天的海很蓝",
      currentState: "warm",
    });
    expect(result.state).toBe("nostalgic");
    expect(result.source).toBe("llm");
    expect(result.reason).toBe("提到从前");
  });

  it("parses a fenced JSON response", async () => {
    invoke.mockResolvedValue('```json\n{"state":"playful"}\n```');
    const result = await inferEmotionalState({
      userMessage: "在干嘛",
      assistantReply: "在等你呀～",
      currentState: "warm",
    });
    expect(result.state).toBe("playful");
    expect(result.source).toBe("llm");
  });

  it("falls back to the heuristic when the LLM returns an invalid state", async () => {
    invoke.mockResolvedValue('{"state":"furious"}');
    const result = await inferEmotionalState({
      userMessage: "哈哈哈哈太好笑了",
      assistantReply: "对呀",
      currentState: "warm",
    });
    expect(result.source).toBe("heuristic");
    expect(result.state).toBe("playful");
  });

  it("falls back to the heuristic when the LLM throws", async () => {
    invoke.mockRejectedValue(new Error("provider down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await inferEmotionalState({
      userMessage: "我好难过",
      assistantReply: "抱抱你",
      currentState: "warm",
    });
    expect(result.source).toBe("heuristic");
    expect(result.state).toBe("melancholy");
  });

  it("falls back to the current state when neither LLM nor heuristic finds a signal", async () => {
    invoke.mockResolvedValue("not json at all");
    const result = await inferEmotionalState({
      userMessage: "嗯",
      assistantReply: "好",
      currentState: "distant",
    });
    expect(result.source).toBe("heuristic");
    expect(result.state).toBe("distant");
  });

  it("always returns a valid emotional state", async () => {
    invoke.mockResolvedValue('{"state":"happy"}');
    const result = await inferEmotionalState({
      userMessage: "今天天气真好",
      assistantReply: "是呀",
      currentState: "warm",
    });
    expect(isEmotionalState(result.state)).toBe(true);
  });
});
