import { describe, expect, it } from "vitest";
import { buildSystemPrompt, getTimeOfDay } from "./_core/persona-utils";

/**
 * What the persona is told.
 *
 * Two things used to be wrong here, and both of them were about the
 * relationship rather than the persona. The end date was stored and never
 * read, so a persona whose relationship had finished still spoke as if the
 * two of them were together. And the time of day came from the server's
 * clock, so a persona who lived in another timezone was told it was the
 * user's evening.
 */
function persona(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前女友",
    togetherFrom: "2021-06-15",
    togetherTo: null,
    emotionalState: "warm",
    personaData: { personality: "温柔", speakingStyle: "口语" },
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("speaks as if the relationship is still going on", () => {
    const prompt = buildSystemPrompt(persona(), { now: new Date("2026-06-01T12:00:00Z") });
    expect(prompt).toContain("你们已经认识");
    expect(prompt).toContain("就像你们平时一样自然");
  });

  it("knows the relationship has ended when there is an end date", () => {
    const prompt = buildSystemPrompt(
      persona({ togetherTo: "2024-01-01" }),
      { now: new Date("2026-06-01T12:00:00Z") },
    );
    expect(prompt).toContain("你们已经分开了");
    expect(prompt).toContain("曾经认识");
    // The old wording would have said the two of them were still together.
    expect(prompt).not.toContain("就像你们平时一样自然");
  });

  it("uses the persona's own clock", () => {
    const now = new Date("2026-06-01T20:00:00Z");
    // Four in the morning in Shanghai, four in the afternoon in New York.
    const shanghai = buildSystemPrompt(persona({ timezone: "Asia/Shanghai" }), { now });
    const newYork = buildSystemPrompt(persona({ timezone: "America/New_York" }), { now });
    expect(shanghai).toContain("深夜");
    expect(newYork).toContain("下午");
  });

  it("prefers an explicit time zone over the persona's own", () => {
    const now = new Date("2026-06-01T20:00:00Z");
    const prompt = buildSystemPrompt(
      persona({ timezone: "America/New_York" }),
      { now, timeZone: "Asia/Shanghai" },
    );
    expect(prompt).toContain("深夜");
  });

  it("keeps the anchor and memory sections in place", () => {
    const prompt = buildSystemPrompt(persona(), {
      now: new Date("2026-06-01T12:00:00Z"),
      anchorSection: "【锚点记忆】\nTA 喜欢在下雨天睡觉",
      memorySection: "【相关记忆】\n去年一起看的电影",
      summarySection: "【以往对话摘要】\n聊了很多",
    });
    expect(prompt).toContain("TA 喜欢在下雨天睡觉");
    expect(prompt).toContain("去年一起看的电影");
    expect(prompt).toContain("聊了很多");
  });
});

describe("getTimeOfDay", () => {
  it("uses the given time zone", () => {
    const now = new Date("2026-06-01T20:00:00Z");
    expect(getTimeOfDay(now, "Asia/Shanghai").label).toBe("深夜");
    expect(getTimeOfDay(now, "UTC").label).toBe("傍晚");
  });

  it("falls back to the local time", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(getTimeOfDay(now).label).toBe(getTimeOfDay(now, null).label);
  });
});
