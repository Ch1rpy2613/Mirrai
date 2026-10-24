import { describe, expect, it } from "vitest";
import { buildPersonaFromAnswers } from "./questionnaire";

describe("buildPersonaFromAnswers", () => {
  it("fills in a persona from a complete set of answers", () => {
    const result = buildPersonaFromAnswers({
      name: "小 A",
      relationship: "前任",
      togetherFrom: "2021-05",
      metStory: "在朋友的生日会上认识的",
      communicationStyles: ["gentle", "playful"],
      catchphrases: ["好呀", "傻瓜"],
      caresAbout: "工作上的成就感",
      conflictStyle: "silent",
      loveLanguage: "words",
      boundaries: "不要提起她的前任",
      nickname: "傻瓜",
    });

    expect(result.name).toBe("小 A");
    expect(result.relationshipDesc).toContain("前任");
    expect(result.relationshipDesc).toContain("2021-05");
    expect(result.togetherFrom).toBe("2021-05");
    expect(result.personaData.speakingStyle).toContain("温和");
    expect(result.personaData.speakingStyle).toContain("玩笑");
    expect(result.personaData.catchphrases).toEqual(["好呀", "傻瓜"]);
    expect(result.personaData.nickname).toBe("傻瓜");
    expect(result.personaData.memories).toContain("生日会");
    expect(result.personaData.conflictStyle).toContain("沉默");
    expect(result.personaData.loveLanguage).toContain("肯定");
    expect(result.personaData.personality).toContain("成就感");
  });

  it("keeps the boundaries the user wrote", () => {
    const result = buildPersonaFromAnswers({
      name: "小 A",
      boundaries: "不要提起她的前任",
    });

    // The boundaries have to reach the persona data — that is what the
    // system prompt is built from.
    expect(result.personaData.personality).toContain("不要提起她的前任");
  });

  it("keeps a long list of boundaries in one piece", () => {
    const result = buildPersonaFromAnswers({
      boundaries: "不要提起她的前任；不要开工作上的玩笑；不要在凌晨发消息",
    });

    expect(result.personaData.personality).toContain("不要提起她的前任");
    expect(result.personaData.personality).toContain("不要开工作上的玩笑");
    expect(result.personaData.personality).toContain("不要在凌晨发消息");
  });

  it("says nothing about boundaries when none were given", () => {
    const result = buildPersonaFromAnswers({ name: "小 A" });
    expect(result.personaData.personality).not.toContain("雷区");
  });

  it("falls back to sensible defaults for an empty answer set", () => {
    const result = buildPersonaFromAnswers({});
    expect(result.name).toBe("TA");
    expect(result.personaData.catchphrases.length).toBeGreaterThan(0);
    expect(result.personaData.personality.length).toBeGreaterThan(0);
    expect(result.personaData.speakingStyle.length).toBeGreaterThan(0);
  });

  it("keeps an unknown style as written", () => {
    const result = buildPersonaFromAnswers({
      communicationStyles: ["一个没见过的风格"],
    });
    expect(result.personaData.speakingStyle).toContain("一个没见过的风格");
  });

  it("returns the answers unchanged for the record", () => {
    const answers = { name: "小 A", relationship: "同事" };
    const result = buildPersonaFromAnswers(answers);
    expect(result.answers).toBe(answers);
  });
});
