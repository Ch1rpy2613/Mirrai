import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The mining of the discriminative rules.
 *
 * This is the one place where a model is asked to find something in a
 * handful of real sentences — which is exactly the kind of request a model
 * will happily invent an answer for. The tests are therefore mostly about
 * the two rules that keep the invention out: a rule has to quote the
 * record it was read off, and the trigger has to be inside that quote.
 *
 * The last group is about the pipeline: the mining is a bonus, and a run
 * that cannot mine anything still has to end with a finished persona.
 */

const miningInvoke = vi.fn();
const pipelineInvoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const resolveProviderForUser = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const getPersonaById = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => pipelineInvoke(...a),
    invokeWithProvider: (...a: unknown[]) => miningInvoke(...a),
  },
  invokeForUser: (...a: unknown[]) => invokeForUser(...a),
  invokeForUserWithReason: (...a: unknown[]) => invokeForUserWithReason(...a),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

vi.mock("../db", () => ({
  updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  createChatSummary: vi.fn(),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

// The celebrity research flow is a whole pipeline of its own; the mining
// only needs to know whether it runs.
vi.mock("./celebrity", () => ({
  resolveCelebrityProfile: () => ({ profile: null, hasResearchStages: false }),
  runCelebrityResearch: vi.fn().mockResolvedValue(null),
  runQualityCheck: vi.fn().mockResolvedValue(null),
  sanitizeForCopyright: (text: string) => text,
  saveResearchProfile: vi.fn(),
  AGENTIC_PROTOCOL: "",
}));

import { copy } from "@shared/copy";
import { findContrastPairs, mineMicroRules, parseTranscriptMessages } from "./micro-rules";
import { runSkillPipeline } from "./pipeline";

/** The answer a model gives when it has found something. */
const ANSWER = JSON.stringify({
  rules: [
    {
      trigger: ["随便"],
      meaning: "真的生气了",
      rendering: "只说两个字，然后就不再接话",
      evidence: [{ at: "2024-03-01T10:00:00Z", snippet: "她回了『随便』" }],
    },
  ],
});

/** The pairs the miner is handed in most of the tests. */
const PAIRS = [{ a: "随便", b: "随便你" }];

beforeEach(() => {
  miningInvoke.mockReset();
  pipelineInvoke.mockReset();
  invokeForUser.mockReset();
  resolveProviderForUser.mockReset();
  updateSkillJob.mockReset();
  updatePersona.mockReset();
  createSkillJob.mockReset();
  getPersonaById.mockReset();
  runPythonTool.mockReset();
  loadPrompt.mockReset();

  resolveProviderForUser.mockResolvedValue({ name: "Test" });
  invokeForUser.mockImplementation(async (...a: unknown[]) => pipelineInvoke(...a));
  invokeForUserWithReason.mockImplementation(async (...a: unknown[]) => ({ text: await pipelineInvoke(...a) }));
  createSkillJob.mockResolvedValue(7);
  updateSkillJob.mockResolvedValue(undefined);
  updatePersona.mockResolvedValue(undefined);
  getPersonaById.mockResolvedValue(undefined);
  loadPrompt.mockReturnValue("prompt");
  runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
});

describe("finding the smallest contrasts", () => {
  it("finds the pair that differs by one word", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona" },
      { content: "随便你", role: "persona" },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a).toBe("随便");
    expect(pairs[0].b).toBe("随便你");
  });

  it("finds the pair that differs by one character", () => {
    const pairs = findContrastPairs([
      { content: "我走了", role: "persona" },
      { content: "我先走了", role: "persona" },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a).toBe("我走了");
    expect(pairs[0].b).toBe("我先走了");
  });

  it("does not return a message that is identical to another", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona" },
      { content: "随便", role: "persona" },
    ]);

    expect(pairs).toHaveLength(0);
  });

  it("returns nothing for messages that have nothing in common", () => {
    const pairs = findContrastPairs([
      { content: "今天天气不错", role: "persona" },
      { content: "我要去上班了", role: "persona" },
      { content: "晚上吃什么", role: "persona" },
    ]);

    expect(pairs).toHaveLength(0);
  });

  it("does not contrast two speakers with each other", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona" },
      { content: "随便你", role: "user" },
    ]);

    expect(pairs).toHaveLength(0);
  });

  it("does not let one message take part in every pair", () => {
    const pairs = findContrastPairs([
      { content: "嗯", role: "persona" },
      { content: "嗯嗯", role: "persona" },
      { content: "嗯嗯嗯", role: "persona" },
      { content: "嗯嗯嗯嗯", role: "persona" },
    ]);

    const uses = new Map<string, number>();
    for (const pair of pairs) {
      uses.set(pair.a, (uses.get(pair.a) ?? 0) + 1);
      uses.set(pair.b, (uses.get(pair.b) ?? 0) + 1);
    }
    for (const count of uses.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("puts the sharpest distinction first", () => {
    const pairs = findContrastPairs([
      { content: "我先走了", role: "persona" },
      { content: "嗯", role: "persona" },
      { content: "我走了", role: "persona" },
      { content: "嗯嗯", role: "persona" },
    ]);

    // Both pairs differ by one character; the one that is a smaller share
    // of the message is the sharper distinction.
    expect(pairs.map((pair) => pair.a)).toEqual(["我先走了", "嗯"]);
  });

  it("keeps the time the record carried", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona", timestamp: "2024-03-01T10:00:00Z" },
      { content: "随便你", role: "persona", timestamp: "2024-03-01T10:02:00Z" },
    ]);

    expect(pairs[0].at).toBe("2024-03-01T10:00:00Z");
  });

  it("keeps the time of the second message when the first has none", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona" },
      { content: "随便你", role: "persona", timestamp: "2024-03-01T10:02:00Z" },
    ]);

    // The time is whichever of the two carries one.
    expect(pairs[0].at).toBe("2024-03-01T10:02:00Z");
  });

  it("leaves out a message that says nothing", () => {
    const pairs = findContrastPairs([
      { content: "", role: "persona" },
      { content: "   ", role: "persona" },
      { content: "。", role: "persona" },
      { content: "随便", role: "persona" },
      { content: "随便你", role: "persona" },
    ]);

    // An empty line is not a message, and a message that is only
    // punctuation says nothing — there would be no difference to read a
    // rule off.
    expect(pairs).toHaveLength(1);
  });

  it("leaves out a message that is longer than a judgement can be", () => {
    const pairs = findContrastPairs(
      [
        { content: "今天天气真的很好啊", role: "persona" },
        { content: "今天天气真的很好呀", role: "persona" },
      ],
      { maxChars: 5 },
    );

    // A judgement needs a short sentence; a paragraph is read as a
    // story rather than as a distinction.
    expect(pairs).toHaveLength(0);
  });

  it("does not read a difference that is large relative to the message", () => {
    const messages = [
      { content: "嗯", role: "persona" },
      { content: "嗯嗯嗯嗯", role: "persona" },
    ];

    // Three characters is most of the message — that is a different
    // sentence, not a small distinction.
    expect(findContrastPairs(messages)).toHaveLength(0);
    // Unless the reader says a difference that size is still small.
    expect(findContrastPairs(messages, { maxRatio: 0.9 })).toHaveLength(1);
  });

  it("keeps at most the number of pairs it was asked for", () => {
    const pairs = findContrastPairs(
      [
        { content: "我走了", role: "persona" },
        { content: "我先走了", role: "persona" },
        { content: "嗯", role: "persona" },
        { content: "嗯嗯", role: "persona" },
      ],
      { limit: 1 },
    );

    expect(pairs).toHaveLength(1);
  });

  it("ignores the messages of another side when one is named", () => {
    const pairs = findContrastPairs(
      [
        { content: "随便", role: "user" },
        { content: "随便你", role: "user" },
      ],
      { role: "persona" },
    );

    expect(pairs).toHaveLength(0);
  });

  it("leaves out a time that cannot be read", () => {
    const pairs = findContrastPairs([
      { content: "随便", role: "persona", timestamp: new Date("nonsense") },
      { content: "随便你", role: "persona", timestamp: "   " },
    ]);

    // A time nobody can read is no time at all.
    expect(pairs).toHaveLength(1);
    expect(pairs[0].at).toBeUndefined();
  });
});

describe("reading a transcript", () => {
  it("tells the two sides apart", () => {
    const messages = parseTranscriptMessages("我：今天怎么样\nTA：还好", { personaName: "小A" });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("persona");
  });

  it("knows the persona by her name", () => {
    const messages = parseTranscriptMessages("小A：随便\n我：随便你", { personaName: "小A" });

    expect(messages[0].role).toBe("persona");
    expect(messages[1].role).toBe("user");
  });

  it("reads the time the export wrote", () => {
    const messages = parseTranscriptMessages("[2024-03-01 10:00] 小A：随便");

    expect(messages[0].timestamp).toBe("2024-03-01 10:00");
    expect(messages[0].content).toBe("随便");
  });

  it("reads the date the export wrote", () => {
    const messages = parseTranscriptMessages("2024-03-01 小A：随便");

    expect(messages[0].timestamp).toBe("2024-03-01");
    expect(messages[0].content).toBe("随便");
  });

  it("reads the clock the export wrote", () => {
    const messages = parseTranscriptMessages("10:00 小A：随便");

    expect(messages[0].timestamp).toBe("10:00");
    expect(messages[0].content).toBe("随便");
  });

  it("leaves a note that is not a time in the text", () => {
    const messages = parseTranscriptMessages("[备注一下] 小A：随便");

    // The bracket holds no time, so it is not one — and the line is
    // read whole, because the note is part of what was written.
    expect(messages[0].timestamp).toBeNull();
    expect(messages[0].content).toBe("[备注一下] 小A：随便");
  });

  it("reads a transcript that names nobody", () => {
    const messages = parseTranscriptMessages("随便\n随便你");

    // Nobody is named, so every line is a message of the same unnamed
    // side — and the miner may still contrast them.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("");
    expect(messages[1].content).toBe("随便你");
  });

  it("keeps a wrapped line with the message above it", () => {
    const messages = parseTranscriptMessages("小A：随便\n她今天心情不好");

    // A line without a speaker continues the message above it, which is
    // how a wrapped sentence arrives.
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("随便 她今天心情不好");
  });

  it("keeps a line that comes before any speaker as its own message", () => {
    const messages = parseTranscriptMessages("她今天心情不好\n小A：随便", { personaName: "小A" });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("");
    expect(messages[0].content).toBe("她今天心情不好");
    expect(messages[1].role).toBe("persona");
  });

  it("drops a speaker that says nothing", () => {
    const messages = parseTranscriptMessages("小A：\n小A：随便");

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("随便");
  });

  it("does not take a comment for a speaker", () => {
    const messages = parseTranscriptMessages("小A：// 这是一条备注");

    // The line names somebody, but what follows it is a comment, so the
    // transcript names nobody at all and the line is read whole.
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("");
    expect(messages[0].content).toBe("小A：// 这是一条备注");
  });

  it("reads nothing from a transcript that says nothing", () => {
    expect(parseTranscriptMessages("")).toEqual([]);
    expect(parseTranscriptMessages("   \n  ")).toEqual([]);
  });
});

describe("mining the rules", () => {
  it("keeps a rule that quotes its record", async () => {
    miningInvoke.mockResolvedValue(ANSWER);

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toHaveLength(1);
    expect(rules[0].trigger).toEqual(["随便"]);
    expect(rules[0].meaning).toBe("真的生气了");
    expect(rules[0].rendering).toBe("只说两个字，然后就不再接话");
    expect(rules[0].source).toBe("auto");
    expect(rules[0].verified).toBe(false);
    expect(rules[0].evidence[0].snippet).toBe("她回了『随便』");
  });

  it("drops a rule whose trigger is not in the evidence it quotes", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["冷战"],
            meaning: "真的生气了",
            rendering: "一整天不回消息",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toHaveLength(0);
  });

  it("drops a rule that cannot source itself", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toHaveLength(0);
  });

  it("survives an answer that is not JSON at all", async () => {
    miningInvoke.mockResolvedValue("抱歉，我没法完成这个任务。");

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toEqual([]);
  });

  it("survives an answer that is wrapped in a code fence", async () => {
    miningInvoke.mockResolvedValue(`\`\`\`json\n${ANSWER}\n\`\`\``);

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toHaveLength(1);
  });

  it("survives a model that cannot be reached", async () => {
    miningInvoke.mockRejectedValue(new Error("the provider exploded"));

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toEqual([]);
  });

  it("asks the model with the mining prompt and the contrasts", async () => {
    miningInvoke.mockResolvedValue(ANSWER);

    await mineMicroRules({ pairs: PAIRS, userId: 7, providerName: "OpenAI" });

    expect(resolveProviderForUser).toHaveBeenCalledWith({
      userId: 7,
      providerName: "OpenAI",
    });
    const call = miningInvoke.mock.calls[0][1] as any;
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toBe(copy("zh", "prompts.microRuleMining"));
    expect(call.messages[1].content).toContain("随便");
    expect(call.messages[1].content).toContain('"a"');
  });

  it("writes the prompts in the language it was given", async () => {
    miningInvoke.mockResolvedValue(ANSWER);

    await mineMicroRules({ pairs: PAIRS, userId: 1, locale: "en" });

    const call = miningInvoke.mock.calls[0][1] as any;
    expect(call.messages[0].content).toBe(copy("en", "prompts.microRuleMining"));
  });

  it("does not call the model when there is nothing to read", async () => {
    const rules = await mineMicroRules({ pairs: [], userId: 1 });

    expect(rules).toEqual([]);
    expect(miningInvoke).not.toHaveBeenCalled();
  });

  it("mines nothing when there is no provider to mine with", async () => {
    resolveProviderForUser.mockResolvedValue(null);

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // The rules are a bonus: without a provider the persona simply has
    // none, and the model is never asked.
    expect(rules).toEqual([]);
    expect(miningInvoke).not.toHaveBeenCalled();
  });

  it("survives a provider that cannot be found", async () => {
    resolveProviderForUser.mockRejectedValue(new Error("the registry is empty"));

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toEqual([]);
    expect(miningInvoke).not.toHaveBeenCalled();
  });

  it("survives a model that answered with nothing", async () => {
    miningInvoke.mockResolvedValue(undefined);

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toEqual([]);
  });

  it("says what it is doing while it mines", async () => {
    miningInvoke.mockResolvedValue(ANSWER);
    const onProgress = vi.fn();

    await mineMicroRules({ pairs: PAIRS, userId: 1, onProgress });

    expect(onProgress).toHaveBeenCalledWith(copy("zh", "labels.microRules.mining"));
  });

  it("finds the contrasts itself when it was not given them", async () => {
    miningInvoke.mockResolvedValue(ANSWER);

    const rules = await mineMicroRules({
      messages: [
        { content: "随便", role: "persona" },
        { content: "随便你", role: "persona" },
      ],
      userId: 1,
    });

    expect(rules).toHaveLength(1);
    const call = miningInvoke.mock.calls[0][1] as any;
    expect(call.messages[1].content).toContain("随便");
  });

  it("reads a rule the model wrote as a bare list", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify([
        {
          trigger: ["随便"],
          meaning: "真的生气了",
          rendering: "只说两个字",
          evidence: [{ snippet: "她回了『随便』" }],
        },
      ]),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // The model may answer with a list instead of an object around it.
    expect(rules).toHaveLength(1);
  });

  it("drops a rule that cannot be obeyed", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: [],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
          {
            trigger: ["随便"],
            meaning: "",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "   ",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // A rule without a trigger, without a meaning or without a rendering
    // is not a rule: there is nothing to obey.
    expect(rules).toEqual([]);
  });

  it("reads a trigger the model wrote as one string", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: "随便、随便你",
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules[0].trigger).toEqual(["随便", "随便你"]);
  });

  it("leaves out the things in a trigger list that are not text", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: [123, "随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules[0].trigger).toEqual(["随便"]);
  });

  it("drops a rule whose evidence is not a list", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: "她回了『随便』",
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toEqual([]);
  });

  it("leaves out the evidence that is not a message", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [
              "她回了『随便』",
              { at: "2024-03-01T10:00:00Z" },
              { snippet: "她回了『随便』" },
            ],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // Only the entry that quotes a message is evidence; the rest is
    // what the model made up around it.
    expect(rules[0].evidence).toHaveLength(1);
    expect(rules[0].evidence[0].snippet).toBe("她回了『随便』");
  });

  it("leaves out a time that is not a time", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』", at: 12345 }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // A number is not a time, so the evidence is kept without one.
    expect(rules[0].evidence[0].at).toBeUndefined();
  });

  it("leaves out the things in the list that are not rules", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          "随便",
          null,
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules).toHaveLength(1);
  });

  it("takes the time of the record when the model leaves it out", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "随便" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({
      pairs: [{ a: "随便", b: "随便你", at: "2024-03-01T10:00:00Z" }],
      userId: 1,
    });

    // The model usually leaves the time out, but the pair it quoted is
    // right there.
    expect(rules[0].evidence[0].at).toBe("2024-03-01T10:00:00Z");
  });

  it("gives every rule its own number", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["冷战"],
            meaning: "在生气",
            rendering: "一整天不回消息",
            evidence: [{ snippet: "她回了『随便』" }],
          },
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            evidence: [{ snippet: "她回了『随便』" }],
          },
          {
            trigger: ["嗯嗯"],
            meaning: "心情好",
            rendering: "连发三条",
            evidence: [{ snippet: "她说了『嗯嗯』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // The ids come from what the rules say, so the same rule mined
    // twice gets the same id — and the two copies are one rule, not
    // two. The rule that could not be grounded does not take one.
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(2);
    for (const rule of rules) {
      expect(rule.id).toMatch(/^auto-[0-9a-z]+$/);
    }
  });

  it("does not believe the model about how sure it is", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            confidence: "很快",
            evidence: [{ snippet: "她回了『随便』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    // A number the model invented about its own certainty is worth
    // little; every candidate starts at the same moderate confidence.
    expect(rules[0].confidence).toBe(0.6);
  });

  it("keeps the confidence inside the scale", async () => {
    miningInvoke.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说两个字",
            confidence: 7,
            evidence: [{ snippet: "她回了『随便』" }],
          },
          {
            trigger: ["嗯嗯"],
            meaning: "心情好",
            rendering: "连发三条",
            confidence: -3,
            evidence: [{ snippet: "她说了『嗯嗯』" }],
          },
        ],
      }),
    );

    const rules = await mineMicroRules({ pairs: PAIRS, userId: 1 });

    expect(rules.map((rule) => rule.confidence)).toEqual([1, 0]);
  });
});

describe("the pipeline and the mining", () => {
  /** The persona the structurer writes. */
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

  /** The records the miner reads. */
  const RECORDS = "小A：随便\n小A：随便你";

  const input = {
    personaId: 1,
    userId: 1,
    characterFamily: "relationship" as const,
    name: "小A",
    chatContent: RECORDS,
  };

  /** The persona data the run wrote. */
  function writtenPersona(): any {
    const writes = updatePersona.mock.calls
      .map((call) => call[2] as any)
      .filter((update) => update?.personaData);
    return writes[writes.length - 1]?.personaData;
  }

  it("writes the mined rules into the persona", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);

    await runSkillPipeline(input);

    expect(writtenPersona()?.microRules).toHaveLength(1);
    expect(writtenPersona()?.microRules[0].source).toBe("auto");
  });

  it("finishes the run with no rules when the mining fails", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockRejectedValue(new Error("the provider exploded"));

    await runSkillPipeline(input);

    expect(writtenPersona()?.microRules).toEqual([]);
    const finished = updatePersona.mock.calls
      .map((call) => call[2] as any)
      .filter((update) => update?.analysisStatus === "ready");
    expect(finished).toHaveLength(1);
  });

  it("mines more pairs in the deep preset than in the quick one", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);
    const records = Array.from({ length: 40 }, (_, i) => `小A：嗯${"啊".repeat(i % 3)}`).join("\n");

    await runSkillPipeline({ ...input, chatContent: records, mode: "fast" });
    const fastPairs = miningInvoke.mock.calls[0][1] as any;

    await runSkillPipeline({ ...input, chatContent: records, mode: "deep" });
    const deepPairs = miningInvoke.mock.calls[1][1] as any;

    expect(deepPairs.messages[1].content.length).toBeGreaterThan(
      fastPairs.messages[1].content.length,
    );
  });

  it("does not mine at all when the caller does not want it", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);

    await runSkillPipeline({ ...input, mineRules: false });

    // The mining is an extra model call, and a caller that does not
    // want it says so.
    expect(miningInvoke).not.toHaveBeenCalled();
    expect(writtenPersona()?.microRules).toEqual([]);
  });

  it("finishes the run when the records hold no contrast", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);

    await runSkillPipeline({
      ...input,
      chatContent: "小A：今天天气不错\n小A：我要去上班了",
    });

    // Nothing to contrast means nothing to ask the model about — and
    // the persona is written either way.
    expect(miningInvoke).not.toHaveBeenCalled();
    expect(writtenPersona()?.microRules).toEqual([]);
    const finished = updatePersona.mock.calls
      .map((call) => call[2] as any)
      .filter((update) => update?.analysisStatus === "ready");
    expect(finished).toHaveLength(1);
  });

  it("offers the whole transcript when it does not say who is who", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);

    await runSkillPipeline({ ...input, chatContent: "随便\n随便你" });

    // The records do not say whose the words are, so the whole
    // transcript is offered and the model is left to quote what it can
    // source.
    const call = miningInvoke.mock.calls[0][1] as any;
    expect(call.messages[1].content).toContain("随便");
  });

  it("reads only the persona's own words when the records say whose they are", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);

    await runSkillPipeline({
      ...input,
      chatContent: "我：随便\n我：随便你\n小A：嗯\n小A：嗯嗯",
    });

    // The rules are about how she discriminates, so a contrast between
    // the two sides says nothing about her — the user's own words are
    // not read.
    const call = miningInvoke.mock.calls[0][1] as any;
    expect(call.messages[1].content).toContain("嗯嗯");
    expect(call.messages[1].content).not.toContain("随便");
  });

  it("keeps the rules the user confirmed when the run repeats", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);
    getPersonaById.mockResolvedValue({
      personaData: {
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
    });

    await runSkillPipeline(input);

    // The distillation rebuilds the persona from the records; what the
    // user worked out by hand is not the model's to overwrite.
    const ids = (writtenPersona()?.microRules ?? []).map((rule: any) => rule.id);
    expect(ids).toContain("r1");
  });

  it("finishes the run when the persona cannot be read", async () => {
    pipelineInvoke.mockResolvedValue(PERSONA_JSON);
    miningInvoke.mockResolvedValue(ANSWER);
    getPersonaById.mockRejectedValue(new Error("the database is down"));

    await runSkillPipeline(input);

    // A persona that cannot be read is a persona whose own decisions
    // are unknown: the run still finishes, it just carries nothing over.
    const finished = updatePersona.mock.calls
      .map((call) => call[2] as any)
      .filter((update) => update?.analysisStatus === "ready");
    expect(finished).toHaveLength(1);
    const ids = (writtenPersona()?.microRules ?? []).map((rule: any) => rule.id);
    expect(ids).not.toContain("r1");
  });
});

/**
 * The mining has to finish.
 *
 * The candidate cap was per *speaker*, and the search compares every
 * pair of the candidates of one speaker — so the work was the sum over
 * the speakers of the square of their share. A group chat has one
 * speaker per person, and fifty speakers meant four million edit
 * distances on the event loop: the server stopped answering requests
 * in the middle of a distillation.
 */
describe("the mining and the number of speakers", () => {
  it("finishes on a chat with fifty speakers", () => {
    const messages: any[] = [];
    for (let speaker = 0; speaker < 50; speaker++) {
      for (let line = 0; line < 400; line++) {
        messages.push({
          role: `speaker-${speaker}`,
          content: `消息 ${speaker}-${line} 一点不一样的话`,
          timestamp: null,
        });
      }
    }

    const started = Date.now();
    const pairs = findContrastPairs(messages, { role: undefined, limit: 24 });
    const elapsed = Date.now() - started;

    expect(Array.isArray(pairs)).toBe(true);
    // The work is bounded, so it is quick.
    expect(elapsed).toBeLessThan(5000);
  });
});
