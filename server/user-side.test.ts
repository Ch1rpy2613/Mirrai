import { describe, expect, it } from "vitest";
import {
  buildRelationshipSection,
  buildUserContextBlock,
  isUserMood,
  resolveRelationshipPhase,
  USER_MOODS,
} from "@shared/user-side";
import { buildSystemPrompt } from "./_core/persona-utils";

/**
 * The user's side of the relationship.
 *
 * The app was built to rebuild a person: their tone, their habits, their
 * history. It was never built to know the person who is talking to that
 * rebuild. Every table scoped by `userId` was a permission key, not a
 * description of a human being.
 */
describe("the user's own moods", () => {
  it("knows the six states", () => {
    expect(USER_MOODS).toHaveLength(6);
    expect(isUserMood("great")).toBe(true);
    expect(isUserMood("numb")).toBe(true);
    expect(isUserMood("warm")).toBe(false);
    expect(isUserMood(null)).toBe(false);
  });
});

describe("buildUserContextBlock", () => {
  it("says nothing when there is nothing to say", () => {
    expect(buildUserContextBlock({})).toBe("");
  });

  it("tells the persona how to address the user", () => {
    const block = buildUserContextBlock({ name: "小张", addressStyle: "老张" });
    expect(block).toContain("【关于对话者】");
    expect(block).toContain("小张");
    expect(block).toContain("老张");
  });

  it("tells the persona what not to bring up", () => {
    const block = buildUserContextBlock({ boundaries: "别提我前任" });
    expect(block).toContain("别提我前任");
    expect(block).toContain("避开");
  });

  it("mentions the user's own state", () => {
    const block = buildUserContextBlock({}, { mood: "down" });
    expect(block).toContain("很难过");
    // The persona should not turn it into a production.
    expect(block).toContain("别主动给建议");
  });

  it("writes the same block in English", () => {
    const block = buildUserContextBlock(
      { name: "Sam", addressStyle: "Sam", boundaries: "don't mention the old flat" },
      { locale: "en", mood: "anxious" },
    );
    expect(block).toContain("【About the person you are talking to】");
    expect(block).toContain("Sam");
    expect(block).toContain("anxious");
  });
});

describe("resolveRelationshipPhase", () => {
  it("finds nothing when there is nothing", () => {
    expect(resolveRelationshipPhase([])).toBeNull();
  });

  it("takes the most recent phase event", () => {
    const events = [
      { kind: "breakup", happenedAt: new Date("2024-01-01") },
      { kind: "reunion", happenedAt: new Date("2024-06-01") },
    ];
    expect(resolveRelationshipPhase(events)).toBe("reunion");
  });

  it("takes the most recent one whatever order they come in", () => {
    const events = [
      { kind: "reunion", happenedAt: new Date("2024-06-01") },
      { kind: "breakup", happenedAt: new Date("2024-01-01") },
    ];
    expect(resolveRelationshipPhase(events)).toBe("reunion");
  });

  it("ignores the events that are not about the relationship itself", () => {
    const events = [
      { kind: "meetup", happenedAt: new Date("2024-06-01") },
      { kind: "conflict", happenedAt: new Date("2024-01-01") },
    ];
    expect(resolveRelationshipPhase(events)).toBeNull();
  });
});

describe("buildRelationshipSection", () => {
  it("says nothing when nothing happened", () => {
    expect(buildRelationshipSection([], null)).toBe("");
  });

  it("tells the persona what the user told it", () => {
    const section = buildRelationshipSection(
      [{ kind: "breakup", title: "我们分手了", happenedAt: new Date() }],
      "breakup",
    );
    expect(section).toContain("【最近发生的事】");
    expect(section).toContain("我们分手了");
    expect(section).toContain("你们分手了");
    // It already knows; the user should not have to say it twice.
    expect(section).toContain("不用对方再说一遍");
  });

  it("carries the detail", () => {
    const section = buildRelationshipSection(
      [{ kind: "news", title: "TA 要出差两周", detail: "说是月底才回来", happenedAt: new Date() }],
      null,
    );
    expect(section).toContain("TA 要出差两周");
    expect(section).toContain("说是月底才回来");
  });
});

describe("the prompt", () => {
  function persona(overrides: Record<string, any> = {}) {
    return {
      id: 1,
      userId: 1,
      name: "小A",
      relationshipDesc: "前女友",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      emotionalState: "warm",
      personaData: { personality: "温柔" },
      ...overrides,
    };
  }

  it("tells the persona who it is talking to", () => {
    const prompt = buildSystemPrompt(persona(), {
      now: new Date("2026-06-01T12:00:00Z"),
      userContext: buildUserContextBlock({ name: "小张", addressStyle: "老张" }),
    });
    expect(prompt).toContain("【关于对话者】");
    expect(prompt).toContain("老张");
  });

  it("tells the persona what has been happening", () => {
    const prompt = buildSystemPrompt(persona(), {
      now: new Date("2026-06-01T12:00:00Z"),
      relationshipEvents: buildRelationshipSection(
        [{ kind: "apart", title: "我们暂时分开了", happenedAt: new Date() }],
        "apart",
      ),
      relationshipPhase: "apart",
    });
    expect(prompt).toContain("【最近发生的事】");
    // A separation the user wrote down ends the "we are together" tone,
    // even when the end date was never filled in.
    expect(prompt).toContain("你们已经分开了");
  });

  it("speaks as a couple again after a reunion", () => {
    const prompt = buildSystemPrompt(persona(), {
      now: new Date("2026-06-01T12:00:00Z"),
      relationshipPhase: "reunion",
    });
    expect(prompt).toContain("你们又在一起了");
  });
});
