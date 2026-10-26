import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../_core/persona-utils";

/**
 * The rules and the imperfection, in the prompt.
 *
 * Two things have to be true, and they are easy to get wrong:
 *
 *   the rules must sit with the persona's own instructions rather than
 *   at the end of the prompt, because a rule that arrives as a closing
 *   note is read as a closing note; and
 *
 *   the imperfection must apply to the state the persona is actually in,
 *   because a persona that is imperfect in six states at once is a
 *   persona with one personality wearing six hats.
 */
const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "distant",
  timezone: "Asia/Shanghai",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: {
    personality: "温柔",
    speakingStyle: "慢慢说",
    microRules: [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷，不解释",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [{ snippet: "随便你" }],
      },
    ],
    imperfectionProfile: [
      { state: "distant", deviations: ["极短句", "不解释"] },
      { state: "happy", deviations: ["会连着发三条"] },
    ],
  },
} as any;

describe("the discriminative rules in the prompt", () => {
  it("says them out loud", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).toContain("随便你");
    expect(prompt).toContain("她真的生气了");
    expect(prompt).toContain("更短、更冷，不解释");
  });

  it("puts them next to the speaking style, not at the end", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    const speaking = prompt.indexOf("慢慢说");
    const rules = prompt.indexOf("随便你");
    expect(speaking).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThan(speaking);
    // The rules are instructions, so they belong before the closing
    // principles rather than after them — and the position is a real
    // position, not a number that is always true.
    const principles = prompt.indexOf("【对话原则】");
    const state = prompt.indexOf("【当前状态】");
    expect(principles).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(principles);
    expect(rules).toBeGreaterThan(speaking);
    // And before the dynamic state section, so the two are read in the
    // order a person would act in them.
    if (state > -1) expect(rules).toBeLessThan(state);
  });

  it("says nothing about a rule the user has not confirmed", () => {
    const unverified = {
      ...persona,
      personaData: {
        ...persona.personaData,
        microRules: [{ ...persona.personaData.microRules[0], verified: false }],
      },
    };
    const prompt = buildSystemPrompt(unverified, { locale: "zh" });
    expect(prompt).not.toContain("随便你");
  });

  it("can be switched off without touching the persona", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", microRules: null });
    expect(prompt).not.toContain("随便你");
  });

  it("writes the framing in English and keeps the user's own words", () => {
    const prompt = buildSystemPrompt(persona, { locale: "en" });
    expect(prompt).toContain("Discriminative rules");
    expect(prompt).toContain("她真的生气了");
  });
});

describe("the imperfection in the prompt", () => {
  it("applies the state the persona is in", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).toContain("极短句");
    expect(prompt).toContain("不解释");
  });

  it("does not apply the other states", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).not.toContain("会连着发三条");
  });

  it("follows the state it is given", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", emotionalState: "happy" });
    expect(prompt).toContain("会连着发三条");
    expect(prompt).not.toContain("极短句");
  });

  it("says nothing when the persona is meant to be perfect", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", realismLevel: 0 });
    expect(prompt).not.toContain("极短句");
  });

  it("can be switched off without touching the persona", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", imperfectionProfile: null });
    expect(prompt).not.toContain("极短句");
  });

  it("gives a state the user never wrote a conservative default", () => {
    // The interface shows six states, each with something in it. The
    // prompt has to use those same six — a persona that is imperfect in
    // one mood and perfect in the other five is not a person.
    const prompt = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "melancholy",
        personaData: {
          ...persona.personaData,
          imperfectionProfile: [
            { state: "distant", deviations: ["极短句"] },
          ],
        },
      },
      { locale: "zh" },
    );
    // The default for "melancholy" is applied even though the user only
    // ever wrote about "distant".
    expect(prompt).toContain("不解释自己");
    // And the state the user did write about keeps their own words.
    const distant = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "distant",
        personaData: {
          ...persona.personaData,
          imperfectionProfile: [
            { state: "distant", deviations: ["极短句"] },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(distant).toContain("极短句");
    expect(distant).not.toContain("不解释自己");
  });

  it("gives a persona that never opted in nothing at all", () => {
    // A persona built before this field existed must not quietly gain a
    // personality nobody chose for it.
    const prompt = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "melancholy",
        personaData: { ...persona.personaData, imperfectionProfile: [] },
      },
      { locale: "zh" },
    );
    expect(prompt).not.toContain("不解释自己");
  });

  it("follows the mood the prompt states, not the one it happens to be stored in", () => {
    // A scene can set the mood the persona speaks in. If the prompt
    // says "you are distant" and then applies the deviations of "happy",
    // it is telling the model two different things at once.
    const prompt = buildSystemPrompt(persona, {
      locale: "zh",
      emotionalState: "happy",
      emotionalDesc: "开心，充满活力",
    });
    expect(prompt).toContain("会连着发三条");
    expect(prompt).not.toContain("极短句");
  });

  it("says nothing for a persona that was distilled before it existed", () => {
    const old = { ...persona, personaData: { personality: "温柔", speakingStyle: "慢慢说" } };
    const prompt = buildSystemPrompt(old, { locale: "zh" });
    expect(prompt).toContain("慢慢说");
    expect(prompt).not.toContain("不完美的特征");
  });
});
