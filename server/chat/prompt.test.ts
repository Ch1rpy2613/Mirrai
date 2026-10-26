import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The one prompt.
 *
 * The conversation and the "show me the system prompt" button used to
 * build their prompts separately, so the button showed something the
 * conversation never used. They are now the same builder — and this test
 * is what says so.
 */
const retrieveMemories = vi.fn();
const getLatestChatSummary = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();

vi.mock("../db", () => ({
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
}));

// The retrieval is the part that reaches into the database; the
// formatters are the part that turns a memory into a line of prompt, and
// they are worth keeping real.
vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

import { buildPromptForPersona } from "./prompt";
import { buildSystemPrompt } from "../_core/persona-utils";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: { personality: "温柔", speakingStyle: "慢慢说" },
} as any;

describe("the prompt the persona is given", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveMemories.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    getUserById.mockResolvedValue({ name: "小李", timezone: "Asia/Shanghai" });
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
  });

  it("is the same prompt the preview shows", async () => {
    const built = await buildPromptForPersona({ persona, userId: 1 });
    const preview = buildSystemPrompt(persona, {});

    // The preview button and the conversation must not drift apart. The
    // sections that depend on the database are the difference; the
    // persona's own instructions must be identical.
    for (const marker of ["【性格特质】", "【说话方式】", "【对话原则】", "【底线】"]) {
      expect(built).toContain(marker);
      expect(preview).toContain(marker);
    }
  });

  it("puts the persona's own instructions in it", async () => {
    const built = await buildPromptForPersona({ persona, userId: 1 });
    expect(built).toContain("温柔");
    expect(built).toContain("小A");
  });

  it("writes in the language it is asked for", async () => {
    const chinese = await buildPromptForPersona({ persona, userId: 1, locale: "zh" });
    const english = await buildPromptForPersona({ persona, userId: 1, locale: "en" });

    expect(chinese).toContain("【底线】");
    expect(english).toContain("Lines that do not move");
    expect(english).toContain("【How to talk】");
    // The persona's own words stay in the language they were written in.
    expect(english).toContain("温柔");
  });

  it("includes the anchors and the memories it was given", async () => {
    retrieveMemories.mockResolvedValue([
      { id: 1, title: "她的生日", description: "11月3日", category: "anchor", subject: "them" },
      { id: 2, title: "第一次见面", description: "图书馆门口", category: "memory", subject: "them" },
    ]);

    const built = await buildPromptForPersona({ persona, userId: 1 });

    expect(built).toContain("她的生日");
    expect(built).toContain("第一次见面");
  });

  it("carries the persona's rules and imperfection", async () => {
    // The evaluation harness measures the persona with and without its
    // rules, and it does that by switching them off *here*. So the
    // switch has to reach the prompt builder — a switch that stopped
    // at the boundary would silently measure the same persona twice.
    const withRules = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
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
          imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }],
        },
      },
      userId: 1,
    });
    expect(withRules).toContain("随便你");

    const withoutRules = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
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
      },
      userId: 1,
      microRules: null,
      imperfectionProfile: null,
    });
    expect(withoutRules).not.toContain("随便你");
  });

  it("carries the scene it is in", async () => {
    const built = await buildPromptForPersona({
      persona,
      userId: 1,
      sceneOverlay: "你们在一家旧书店里。",
    });
    expect(built).toContain("【当前场景】");
    expect(built).toContain("你们在一家旧书店里。");
  });
});
