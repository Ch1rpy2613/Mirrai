import { describe, expect, it } from "vitest";
import {
  defaultImperfectionProfile,
  IMPERFECTION_STATES,
  mergeImperfectionDefaults,
  normalizeImperfectionProfile,
  renderImperfection,
  selectImperfection,
} from "./imperfection";

/**
 * The imperfection.
 *
 * The whole point of this file is that imperfection is not a number. A
 * persona that is "70% imperfect" in every state is a persona with one
 * personality wearing six hats, and the tests here are about making sure
 * that does not happen by accident.
 */
describe("the default profile", () => {
  it("has an entry for every state", () => {
    const profile = defaultImperfectionProfile("zh");
    expect(profile).toHaveLength(IMPERFECTION_STATES.length);
    for (const entry of profile) {
      expect(entry.deviations.length).toBeGreaterThan(0);
    }
  });

  it("says something different in each state", () => {
    const profile = defaultImperfectionProfile("zh");
    const rendered = profile.map((e) => e.deviations.join("|"));
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("has an English half too", () => {
    const profile = defaultImperfectionProfile("en");
    expect(profile.every((e) => e.deviations.length > 0)).toBe(true);
  });
});

describe("normalising what was stored", () => {
  it("is empty when nothing was stored, so an old persona does not change", () => {
    expect(normalizeImperfectionProfile(undefined)).toEqual([]);
    expect(normalizeImperfectionProfile(null)).toEqual([]);
    expect(normalizeImperfectionProfile([])).toEqual([]);
  });

  it("keeps the states it knows and drops the ones it does not", () => {
    const profile = normalizeImperfectionProfile([
      { state: "distant", deviations: ["极短句"] },
      { state: "sleepy", deviations: ["打哈欠"] },
    ]);
    expect(profile).toHaveLength(1);
    expect(profile[0].state).toBe("distant");
  });

  it("fills an empty state with the default for that state", () => {
    const profile = normalizeImperfectionProfile([{ state: "happy", deviations: [] }]);
    expect(profile[0].deviations.length).toBeGreaterThan(0);
  });

  it("keeps what the user wrote", () => {
    const profile = normalizeImperfectionProfile([
      { state: "happy", deviations: ["会连着发三条"] },
    ]);
    expect(profile[0].deviations).toEqual(["会连着发三条"]);
  });

  it("takes a delimited string as the deviations", () => {
    const profile = normalizeImperfectionProfile([
      { state: "happy", deviations: "会连着发三条；容易跑题" },
    ]);
    expect(profile[0].deviations).toEqual(["会连着发三条", "容易跑题"]);
  });

  it("skips an entry that is not an entry at all", () => {
    const profile = normalizeImperfectionProfile([
      null,
      "nonsense",
      { state: "happy", deviations: ["会连着发三条"] },
    ]);
    expect(profile).toHaveLength(1);
    expect(profile[0].state).toBe("happy");
  });

  it("drops a state that is not a state at all", () => {
    const profile = normalizeImperfectionProfile([
      { state: 42, deviations: ["会连着发三条"] },
    ]);
    expect(profile).toEqual([]);
  });

  it("keeps the first of two entries for the same state", () => {
    const profile = normalizeImperfectionProfile([
      { state: "happy", deviations: ["会连着发三条"] },
      { state: "happy", deviations: ["容易跑题"] },
    ]);
    expect(profile).toHaveLength(1);
    expect(profile[0].deviations).toEqual(["会连着发三条"]);
  });

  it("reads the deviations as text", () => {
    const profile = normalizeImperfectionProfile([
      { state: "happy", deviations: [42, true] },
    ]);
    expect(profile[0].deviations).toEqual(["42", "true"]);
  });
});

describe("showing the whole picture", () => {
  it("fills the gaps with the defaults", () => {
    const merged = mergeImperfectionDefaults(
      [{ state: "distant", deviations: ["极短句"] }],
      "zh",
    );
    expect(merged).toHaveLength(IMPERFECTION_STATES.length);
    const distant = merged.find((e) => e.state === "distant");
    expect(distant?.deviations).toEqual(["极短句"]);
  });
});

describe("picking the state", () => {
  it("finds the entry for the state the persona is in", () => {
    const profile = normalizeImperfectionProfile([
      { state: "distant", deviations: ["极短句"] },
    ]);
    expect(selectImperfection(profile, "distant")?.deviations).toEqual(["极短句"]);
  });

  it("finds nothing for a state that has no entry", () => {
    expect(selectImperfection([], "distant")).toBeNull();
    expect(selectImperfection(null, "distant")).toBeNull();
  });

  it("finds nothing for a state that is not in the profile", () => {
    const profile = normalizeImperfectionProfile([
      { state: "distant", deviations: ["极短句"] },
    ]);
    expect(selectImperfection(profile, "happy")).toBeNull();
  });

  it("finds nothing when there is no state to look for", () => {
    const profile = normalizeImperfectionProfile([
      { state: "distant", deviations: ["极短句"] },
    ]);
    expect(selectImperfection(profile, null)).toBeNull();
    expect(selectImperfection(profile, undefined)).toBeNull();
  });
});

describe("writing the imperfection for the model", () => {
  const entry = { state: "distant" as const, deviations: ["极短句", "不解释"] };

  it("says nothing when there is nothing to say", () => {
    expect(renderImperfection(null, 70, "zh")).toBe("");
    expect(renderImperfection({ ...entry, deviations: [] }, 70, "zh")).toBe("");
  });

  it("says nothing when the persona is meant to be perfect", () => {
    expect(renderImperfection(entry, 0, "zh")).toBe("");
  });

  it("says nothing when the intensity is not a number at all", () => {
    expect(renderImperfection(entry, Number.NaN, "zh")).toBe("");
  });

  it("says nothing when the intensity is below zero", () => {
    expect(renderImperfection(entry, -10, "zh")).toBe("");
  });

  it("keeps an intensity above the scale at the top of it", () => {
    const text = renderImperfection(entry, 150, "zh");
    expect(text).toContain("明显");
  });

  it("scales the intensity with how imperfect the persona is", () => {
    expect(renderImperfection(entry, 50, "zh")).toContain("偶尔");
    expect(renderImperfection(entry, 20, "zh")).toContain("几乎不");
  });

  it("writes the deviations and how strongly they apply", () => {
    const text = renderImperfection(entry, 80, "zh");
    expect(text).toContain("极短句");
    expect(text).toContain("不解释");
  });

  it("writes the same thing in English", () => {
    const text = renderImperfection(entry, 80, "en");
    expect(text).toContain("极短句");
    expect(text).toContain("Imperfection");
  });
});
