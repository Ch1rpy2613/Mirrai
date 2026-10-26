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
    expect(result).toEqual({
      ...raw,
      realismLevel: 70,
      relationshipPhase: "initial",
      microRules: [],
      imperfectionProfile: [],
    });
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
      "imperfectionProfile",
      "loveLanguage",
      "memories",
      "microRules",
      "nickname",
      "personality",
      "realismLevel",
      "relationshipPhase",
      "speakingStyle",
      "summary",
      "touchingMoments",
    ]);
  });

  it("keeps data stored before the quality fields existed working", () => {
    // The fields were added after the first release: old personas have none of
    // them, and they must not need a migration.
    const old = {
      personality: "温柔但有边界",
      speakingStyle: "短句",
      catchphrases: ["嗯嗯"],
      nickname: "宝贝",
      memories: "一起看过海",
      attachmentStyle: "安全型",
      loveLanguage: "精心时刻",
      conflictStyle: "先冷静再和好",
      touchingMoments: "记得小细节",
      summary: "温暖真诚",
    };

    const result = normalizePersonaData(old, { name: "小A" });

    expect(result.realismLevel).toBe(70);
    expect(result.relationshipPhase).toBe("initial");
    // The old fields are untouched.
    expect(result.personality).toBe(old.personality);
    expect(result.catchphrases).toEqual(old.catchphrases);
    // And the persona does not quietly gain a personality it never had:
    // no rules and no per-state imperfection, so the prompt is unchanged.
    expect(result.microRules).toEqual([]);
    expect(result.imperfectionProfile).toEqual([]);
  });

  it("keeps the discriminative rules", () => {
    const rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [{ snippet: "随便你" }],
      },
    ];
    const result = normalizePersonaData(
      { microRules: rules },
      { name: "小A" },
    );
    expect(result.microRules).toHaveLength(1);
    expect(result.microRules![0].trigger).toEqual(["随便你"]);
    expect(result.microRules![0].verified).toBe(true);
  });

  it("drops a rule that cannot be obeyed", () => {
    const result = normalizePersonaData(
      { microRules: [{ trigger: [], meaning: "x", rendering: "y" }] },
      { name: "小A" },
    );
    expect(result.microRules).toEqual([]);
  });

  it("keeps the per-state imperfection", () => {
    const result = normalizePersonaData(
      { imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }] },
      { name: "小A" },
    );
    expect(result.imperfectionProfile).toHaveLength(1);
    expect(result.imperfectionProfile![0].state).toBe("distant");
    expect(result.imperfectionProfile![0].deviations).toEqual(["极短句"]);
  });

  it("fills an empty state with the default for that state", () => {
    const result = normalizePersonaData(
      { imperfectionProfile: [{ state: "happy", deviations: [] }] },
      { name: "小A" },
    );
    expect(result.imperfectionProfile![0].deviations.length).toBeGreaterThan(0);
  });

  it("keeps an explicit realism level and relationship phase", () => {
    const result = normalizePersonaData(
      { realismLevel: 30, relationshipPhase: "closing" },
      { name: "小A" },
    );
    expect(result.realismLevel).toBe(30);
    expect(result.relationshipPhase).toBe("closing");
  });

  it("clamps an out-of-range realism level", () => {
    expect(normalizePersonaData({ realismLevel: 400 }, { name: "小A" }).realismLevel).toBe(100);
    expect(normalizePersonaData({ realismLevel: -20 }, { name: "小A" }).realismLevel).toBe(0);
  });

  it("falls back to the default phase for an unknown one", () => {
    const result = normalizePersonaData({ relationshipPhase: "whatever" }, { name: "小A" });
    expect(result.relationshipPhase).toBe("initial");
  });
});
