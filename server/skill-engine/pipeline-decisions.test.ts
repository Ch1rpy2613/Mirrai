import { describe, expect, it } from "vitest";
import { mergeUserDecisions } from "./pipeline";
import type { PersonaData } from "../_core/persona-schema";
import type { MicroRule } from "@shared/micro-rules";

/**
 * What survives a re-run.
 *
 * A re-distillation rebuilds the persona from the records. It would
 * happily throw away everything the user worked out by hand — and those
 * things are exactly the things the model cannot work out on its own.
 * They are the user's decisions about a person the model cannot see.
 */
const fresh: PersonaData = {
  personality: "温柔",
  speakingStyle: "短句",
  catchphrases: ["嗯嗯"],
  nickname: "宝贝",
  memories: "",
  attachmentStyle: "",
  loveLanguage: "",
  conflictStyle: "",
  touchingMoments: "",
  summary: "",
  realismLevel: 70,
  relationshipPhase: "initial",
  microRules: [],
  imperfectionProfile: [],
};

const confirmed: MicroRule = {
  id: "r1",
  trigger: ["随便你"],
  meaning: "她真的生气了",
  rendering: "更短、更冷",
  confidence: 1,
  source: "manual",
  verified: true,
  evidence: [],
};

const candidate: MicroRule = {
  id: "auto-1",
  trigger: ["嗯嗯"],
  meaning: "心情好",
  rendering: "连发三条",
  confidence: 0.6,
  source: "auto",
  verified: false,
  evidence: [{ snippet: "嗯嗯" }],
};

describe("a re-run of the distillation", () => {
  it("keeps the rules the user confirmed", () => {
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [confirmed] },
      [candidate],
      "zh",
    );
    expect(merged.microRules?.map((rule) => rule.id)).toContain("r1");
  });

  it("does not keep the candidates the user never confirmed", () => {
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [candidate] },
      [],
      "zh",
    );
    expect(merged.microRules).toEqual([]);
  });

  it("does not add a mined rule the user has already confirmed", () => {
    // Two rules about the same word are two contradictory instructions
    // in one prompt, and the user's is the one they checked.
    const same: MicroRule = { ...candidate, id: "auto-2", trigger: ["随便你"] };
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [confirmed] },
      [same],
      "zh",
    );
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["r1"]);
  });

  it("adds the freshly mined candidates", () => {
    const merged = mergeUserDecisions(fresh, {}, [candidate], "zh");
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["auto-1"]);
  });

  it("keeps the per-state imperfection the user wrote", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }] },
      [],
      "zh",
    );
    expect(merged.imperfectionProfile).toHaveLength(1);
    expect(merged.imperfectionProfile?.[0].deviations).toEqual(["极短句"]);
  });

  it("does not invent an imperfection for a persona that never had one", () => {
    const merged = mergeUserDecisions(fresh, {}, [], "zh");
    expect(merged.imperfectionProfile).toEqual([]);
  });

  it("keeps everything else the fresh build produced", () => {
    const merged = mergeUserDecisions(
      { ...fresh, personality: "更温柔了" },
      { microRules: [confirmed] },
      [],
      "zh",
    );
    expect(merged.personality).toBe("更温柔了");
  });

  it("puts the rules the user confirmed before the ones just mined", () => {
    const merged = mergeUserDecisions(fresh, { microRules: [confirmed] }, [candidate], "zh");

    // The user's own decisions come first: they are the ones that took
    // effect, and the candidates are still waiting to be looked at.
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["r1", "auto-1"]);
  });

  it("leaves out a stored rule that cannot be obeyed", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        microRules: [
          {
            id: "r2",
            trigger: ["随便"],
            meaning: "她真的生气了",
            rendering: "",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          },
        ],
      },
      [],
      "zh",
    );

    // A rule without a rendering is not a rule — and it is not carried
    // over either.
    expect(merged.microRules).toEqual([]);
  });

  it("writes the default imperfection in Chinese when no language is named", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: [] }] },
      [],
    );

    // The user asked for imperfection in that state but wrote none, so
    // the default for that state stands in.
    expect(merged.imperfectionProfile?.[0].deviations[0]).toBe("极短句");
  });

  it("writes the default imperfection in the language it was given", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: [] }] },
      [],
      "en",
    );

    expect(merged.imperfectionProfile?.[0].deviations[0]).toBe("very short sentences");
  });
});
