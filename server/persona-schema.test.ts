import { describe, expect, it } from "vitest";
import { normalizePersonaData } from "./_core/persona-schema";

describe("normalizePersonaData", () => {
  it("keeps a complete, well-formed payload intact", () => {
    const raw = {
      personality: "温柔但有边界",
      speakingStyle: "短句，喜欢用语气词",
      catchphrases: ["嗯嗯", "好呀"],
      nickname: "宝贝",
      memories: "一起看过海",
      attachmentStyle: "安全型",
      loveLanguage: "精心时刻",
      conflictStyle: "先冷静再和好",
      touchingMoments: "记得我说过的小细节",
      summary: "温暖真诚",
    };
    const result = normalizePersonaData(raw, { name: "小A" });
    expect(result).toEqual(raw);
  });

  it("splits a delimited catchphrases string into an array", () => {
    const result = normalizePersonaData(
      { catchphrases: "嗯嗯、好呀、哈哈" },
      { name: "小A" },
    );
    expect(result.catchphrases).toEqual(["嗯嗯", "好呀", "哈哈"]);
  });

  it("keeps catchphrases as an array when it already is one", () => {
    const result = normalizePersonaData(
      { catchphrases: ["嗯嗯", "好呀"] },
      { name: "小A" },
    );
    expect(result.catchphrases).toEqual(["嗯嗯", "好呀"]);
  });

  it("fills defaults for missing fields instead of returning empties", () => {
    const result = normalizePersonaData({}, { name: "小A" });
    expect(result.personality).toContain("小A");
    expect(result.speakingStyle.length).toBeGreaterThan(0);
    expect(result.catchphrases.length).toBeGreaterThan(0);
    expect(result.nickname.length).toBeGreaterThan(0);
    expect(result.attachmentStyle.length).toBeGreaterThan(0);
    expect(result.summary).toContain("小A");
  });

  it("handles a null payload without throwing", () => {
    const result = normalizePersonaData(null, { name: "小A" });
    expect(result.personality).toContain("小A");
  });

  it("joins an array-valued memories field into a string", () => {
    const result = normalizePersonaData(
      { memories: ["第一次见面", "一起看海"] },
      { name: "小A" },
    );
    expect(typeof result.memories).toBe("string");
    expect(result.memories).toContain("第一次见面");
    expect(result.memories).toContain("一起看海");
  });

  it("prefers provided fallback values over the built-in defaults", () => {
    const result = normalizePersonaData({}, {
      name: "小A",
      fallback: { personality: "自定义性格", nickname: "小甜心" },
    });
    expect(result.personality).toBe("自定义性格");
    expect(result.nickname).toBe("小甜心");
  });

  it("always returns the same set of keys", () => {
    const result = normalizePersonaData({ personality: "x" }, { name: "小A" });
    expect(Object.keys(result).sort()).toEqual([
      "attachmentStyle",
      "catchphrases",
      "conflictStyle",
      "loveLanguage",
      "memories",
      "nickname",
      "personality",
      "speakingStyle",
      "summary",
      "touchingMoments",
    ]);
  });
});
