import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  buildCharNgramModel,
  compareToBaseline,
  evaluateGate,
  evaluateRuleBenefit,
  measureLineShape,
  ngramOverlap,
  scoreCase,
  wasserstein1d,
  type EvalCaseScore,
} from "./metrics";

/**
 * The measurements.
 *
 * These are the numbers the whole third phase is judged by, so they are
 * tested like anything else: a ruler that is wrong is worse than no
 * ruler, because it will be trusted.
 */
describe("the overlap measure", () => {
  it("is one for the same line", () => {
    expect(ngramOverlap("我今天有点累", "我今天有点累")).toBeCloseTo(1, 5);
  });

  it("is zero for lines that share nothing", () => {
    expect(ngramOverlap("今天天气很好", "asdfghjkl")).toBe(0);
  });

  it("sits between the two when the lines are partly alike", () => {
    const score = ngramOverlap("我今天有点累", "我今天有点难受");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("punishes a persona that says everything and then adds a paragraph", () => {
    const real = "我今天有点累";
    const padded = `${real}${"，但是我还是很想见你".repeat(8)}`;
    // Recall alone would score this highly. Dice does not.
    expect(ngramOverlap(real, padded)).toBeLessThan(0.5);
  });

  it("scores a line too short to have an n-gram as itself", () => {
    expect(ngramOverlap("嗯", "嗯")).toBe(1);
    expect(ngramOverlap("嗯", "好")).toBe(0);
  });

  it("scores nothing against nothing", () => {
    expect(ngramOverlap("", "我今天")).toBe(0);
    expect(ngramOverlap("我今天", "")).toBe(0);
  });
});

describe("the person's own likelihood", () => {
  const model = buildCharNgramModel([
    "随便你",
    "随便",
    "我知道了",
    "嗯",
    "嗯嗯",
    "我先走了",
    "晚安",
    "今天好累",
  ]);

  it("rates the person's own line above an unrelated one", () => {
    const own = model.logProb("嗯嗯");
    const other = model.logProb("今天股市大涨");
    expect(own).toBeGreaterThan(other);
  });

  it("gives a line the model has never seen a real number, not a crash", () => {
    expect(Number.isFinite(model.logProb("完全没见过的一行话"))).toBe(true);
  });

  it("gives an empty line no likelihood at all", () => {
    // There is nothing to be likely or unlikely about.
    expect(model.logProb("")).toBe(0);
    expect(model.logProb("   ")).toBe(0);
  });

  it("gives a one-character line a likelihood", () => {
    expect(Number.isFinite(model.logProb("嗯"))).toBe(true);
  });

  it("rates a character it has never seen as unlikely but not impossible", () => {
    expect(model.logProb("龟")).toBeLessThan(model.logProb("嗯"));
    expect(Number.isFinite(model.logProb("龟"))).toBe(true);
  });

  it("says nothing about anything when it was fitted on nothing", () => {
    const empty = buildCharNgramModel([]);
    expect(empty.logProb("随便你")).toBe(0);
  });

  it("ignores an empty line when it fits the model", () => {
    const withBlank = buildCharNgramModel(["随便你", "  ", ""]);
    const without = buildCharNgramModel(["随便你"]);
    expect(withBlank.logProb("随便你")).toBeCloseTo(
      without.logProb("随便你"),
      10,
    );
  });
});

describe("the shape of a line", () => {
  it("counts the characters", () => {
    expect(measureLineShape("我今天有点累").chars).toBe(6);
  });

  it("counts the sentences", () => {
    expect(measureLineShape("我今天有点累。你还好吗？").sentences).toBe(2);
    expect(measureLineShape("我今天有点累").sentences).toBe(1);
  });

  it("counts the times the other person is addressed", () => {
    expect(measureLineShape("宝贝，你吃饭了吗").addresses).toBe(1);
    expect(measureLineShape("你吃饭了吗").addresses).toBe(0);
  });

  it("counts the addresses in English too", () => {
    expect(measureLineShape("baby, did you eat", "en").addresses).toBe(1);
  });

  it("counts an empty line as one sentence", () => {
    expect(measureLineShape("").sentences).toBe(1);
    expect(measureLineShape("").chars).toBe(0);
  });

  it("falls back to the Chinese words when the language is not one it knows", () => {
    expect(measureLineShape("宝贝，你吃饭了吗", "fr" as "zh").addresses).toBe(1);
  });
});

describe("the length distance", () => {
  it("is zero for two identical distributions", () => {
    expect(wasserstein1d([10, 20, 30], [10, 20, 30])).toBeCloseTo(0, 6);
  });

  it("is the shift when one distribution is moved", () => {
    expect(wasserstein1d([10, 20, 30], [20, 30, 40])).toBeCloseTo(10, 6);
  });

  it("is zero when one of the distributions is empty", () => {
    expect(wasserstein1d([], [10, 20])).toBe(0);
    expect(wasserstein1d([10, 20], [])).toBe(0);
  });
});

describe("scoring one case", () => {
  const model = buildCharNgramModel(["嗯", "好", "我知道了"]);

  it("measures the shape of both lines", () => {
    const score = scoreCase({
      caseId: 0,
      expected: "宝贝，今天好累啊",
      generated: "好累",
      model,
    });
    expect(score.expectedShape.chars).toBe(8);
    expect(score.generatedShape.chars).toBe(2);
    expect(score.expectedShape.addresses).toBe(1);
    expect(score.generatedShape.addresses).toBe(0);
  });

  it("records the overlap, the likelihood gap and both lengths", () => {
    const score = scoreCase({
      caseId: 0,
      expected: "我知道了",
      generated: "我知道了",
      model,
    });
    expect(score.overlap).toBeCloseTo(1, 5);
    expect(score.likelihoodGap).toBeCloseTo(0, 6);
    expect(score.expectedLength).toBe(4);
    expect(score.generatedLength).toBe(4);
  });

  it("reads the emotion off both lines", () => {
    const score = scoreCase({
      caseId: 0,
      expected: "我想你了",
      generated: "我也想你了",
      model,
    });
    expect(score.expectedState).toBe("nostalgic");
    expect(score.actualState).toBe("nostalgic");
  });

  it("keeps the state the run declared", () => {
    const score = scoreCase({
      caseId: 0,
      expected: "我想你了",
      generated: "我也想你了",
      model,
      declaredState: "playful",
    });
    expect(score.declaredState).toBe("playful");
  });

  it("has no declared state when the run did not declare one", () => {
    const score = scoreCase({
      caseId: 0,
      expected: "我想你了",
      generated: "我也想你了",
      model,
    });
    expect(score.declaredState).toBeNull();
  });
});

describe("aggregating a run", () => {
  const model = buildCharNgramModel(["嗯", "好"]);

  function score(overlap: number, gap: number, expectedLength: number, generatedLength: number): EvalCaseScore {
    return {
      caseId: 0,
      overlap,
      likelihoodGap: gap,
      lengthDelta: generatedLength - expectedLength,
      expectedLength,
      generatedLength,
      expectedShape: measureLineShape("x".repeat(expectedLength)),
      generatedShape: measureLineShape("x".repeat(generatedLength)),
      expectedState: "playful",
      actualState: "playful",
      declaredState: null,
    };
  }

  it("averages the surface measures", () => {
    const metrics = aggregateScores([
      score(0.4, -1, 10, 12),
      score(0.6, 1, 20, 18),
    ]);
    expect(metrics.cases).toBe(2);
    expect(metrics.overlap).toBeCloseTo(0.5, 6);
    expect(metrics.likelihoodGap).toBeCloseTo(0, 6);
  });

  it("breaks the overlap down by the state the real line carried", () => {
    const metrics = aggregateScores([score(0.5, 0, 10, 10)]);
    expect(metrics.perState.playful.count).toBe(1);
    expect(metrics.perState.playful.overlap).toBeCloseTo(0.5, 6);
  });

  it("breaks the shape down by the state too", () => {
    const metrics = aggregateScores([score(0.5, 0, 10, 14)]);
    expect(metrics.perState.playful.lengthGap).toBeCloseTo(4, 6);
  });

  it("records which emotion it confused with which", () => {
    const metrics = aggregateScores([
      { ...score(0.5, 0, 10, 10), expectedState: "playful", actualState: "nostalgic" },
      { ...score(0.5, 0, 10, 10), expectedState: "playful", actualState: "playful" },
      { ...score(0.5, 0, 10, 10), expectedState: "melancholy", actualState: "melancholy" },
    ]);
    // The accuracy says how often it was right; the matrix says how it
    // gets it wrong, which is a different question.
    expect(metrics.emotionMatrix.playful.nostalgic).toBe(1);
    expect(metrics.emotionMatrix.playful.playful).toBe(1);
    expect(metrics.emotionMatrix.melancholy.melancholy).toBe(1);
  });

  it("records a line with no emotion as none", () => {
    const metrics = aggregateScores([
      { ...score(0.5, 0, 10, 10), expectedState: "playful", actualState: null },
    ]);
    expect(metrics.emotionMatrix.playful.none).toBe(1);
  });

  it("is empty rather than broken when there is nothing to score", () => {
    const metrics = aggregateScores([]);
    expect(metrics.cases).toBe(0);
    expect(metrics.overlap).toBe(0);
  });

  it("keeps a line with no emotion out of the matrix", () => {
    const metrics = aggregateScores([
      { ...score(0.5, 0, 10, 10), expectedState: null, actualState: "playful" },
    ]);
    // The matrix is about what the real line carried; a line that
    // carried nothing has no row to sit in.
    expect(metrics.emotionMatrix).toEqual({});
    expect(metrics.perState.none.count).toBe(1);
  });

  it("has no emotion accuracy when no line carried an emotion", () => {
    const metrics = aggregateScores([
      { ...score(0.5, 0, 10, 10), expectedState: null, actualState: null },
    ]);
    expect(metrics.emotionAccuracy).toBe(0);
  });

  it("measures the shape of a state that only has one case", () => {
    const metrics = aggregateScores([score(0.5, 0, 10, 14)]);
    expect(metrics.perState.playful.count).toBe(1);
    expect(metrics.perState.playful.lengthGap).toBeCloseTo(4, 6);
    expect(metrics.perState.playful.sentenceGap).toBeCloseTo(0, 6);
    expect(metrics.perState.playful.addressGap).toBeCloseTo(0, 6);
  });
});

describe("reading the emotion of a line", () => {
  it("reads it in the language the line is in", () => {
    // The trigger table has an English half, and it used to be unused:
    // every line was read with the Chinese table, so an English persona
    // carried no state at all — and every per-state number was empty
    // rather than wrong-looking.
    const model = buildCharNgramModel(["i miss you"], 3);
    const score = scoreCase({
      caseId: 0,
      expected: "i miss you",
      generated: "i miss you",
      model,
      locale: "en",
    });
    expect(score.expectedState).toBe("nostalgic");
    expect(score.actualState).toBe("nostalgic");
  });

  it("reads a Chinese line with the Chinese table", () => {
    const model = buildCharNgramModel(["想你"], 3);
    const score = scoreCase({
      caseId: 0,
      expected: "想你",
      generated: "想你",
      model,
      locale: "zh",
    });
    expect(score.expectedState).toBe("nostalgic");
  });

  it("finds nothing in an English line when it reads it as Chinese", () => {
    // Which is what used to happen to every English persona.
    const model = buildCharNgramModel(["i miss you"], 3);
    const score = scoreCase({
      caseId: 0,
      expected: "i miss you",
      generated: "i miss you",
      model,
      locale: "zh",
    });
    expect(score.expectedState).toBeNull();
  });
});

describe("the gate", () => {
  const good = {
    cases: 10,
    overlap: 0.4,
    likelihoodGap: -1,
    lengthDistance: 10,
    emotionAccuracy: 0.8,
    emotionMatrix: {},
    perState: {},
    scores: [],
  };

  it("fails when there is nothing to compare against", () => {
    // A gate that cannot check anything does not pass. A green mark
    // that checked nothing is the most expensive kind of lie a build
    // can tell.
    const outcome = evaluateGate(null, good);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.regressed).toBe(false);
    expect(outcome.note).toMatch(/nothing was checked/);
  });

  it("fails when the baseline is the other variant", () => {
    // A run with the rules switched off is a different persona.
    const outcome = evaluateGate(
      { ...good, variant: "withoutRules" },
      good,
      "default",
    );
    expect(outcome.exitCode).toBe(2);
  });

  it("passes when the persona did not get worse", () => {
    const outcome = evaluateGate({ ...good, variant: "default" }, good, "default");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.regressed).toBe(false);
  });

  it("fails when the persona got worse", () => {
    const outcome = evaluateGate(
      { ...good, variant: "default", overlap: 0.5 },
      { ...good, overlap: 0.3 },
      "default",
    );
    expect(outcome.regressed).toBe(true);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.offenders).toContain("overlap");
  });
});

describe("whether the rules earn their place", () => {
  const base = {
    cases: 10,
    overlap: 0.4,
    likelihoodGap: -1,
    lengthDistance: 10,
    emotionAccuracy: 0.8,
    emotionMatrix: {},
    perState: {},
    scores: [],
  };

  it("says so when the rules change nothing", () => {
    // The one honest acceptance criterion: a rule that does not move
    // the numbers is decoration.
    const outcome = evaluateRuleBenefit(base, base);
    expect(outcome.improved).toBe(0);
    expect(outcome.exitCode).toBe(3);
  });

  it("counts a measure the rules improve", () => {
    const outcome = evaluateRuleBenefit({ ...base, overlap: 0.5 }, base);
    expect(outcome.improved).toBe(1);
    expect(outcome.exitCode).toBe(0);
  });

  it("counts a likelihood that gets closer to zero", () => {
    const outcome = evaluateRuleBenefit(
      { ...base, likelihoodGap: -0.5 },
      { ...base, likelihoodGap: -2 },
    );
    expect(outcome.improved).toBe(1);
  });

  it("does not count a likelihood that gets further from zero", () => {
    const outcome = evaluateRuleBenefit(
      { ...base, likelihoodGap: -2 },
      { ...base, likelihoodGap: -0.5 },
    );
    expect(outcome.improved).toBe(0);
  });
});

describe("comparing a run with the baseline", () => {
  const baseline = aggregateScores([
    {
      caseId: 0,
      overlap: 0.5,
      likelihoodGap: 0,
      lengthDelta: 0,
      expectedLength: 10,
      generatedLength: 10,
      expectedShape: measureLineShape("x".repeat(10)),
      generatedShape: measureLineShape("x".repeat(10)),
      expectedState: "playful",
      actualState: "playful",
      declaredState: null,
    },
  ]);

  it("accepts a run that is the same", () => {
    expect(compareToBaseline(baseline, baseline).regressed).toBe(false);
  });

  it("catches a persona that got less alike", () => {
    const worse = aggregateScores([
      {
        ...baseline.scores[0],
        overlap: 0.3,
      },
    ]);
    const report = compareToBaseline(baseline, worse);
    expect(report.regressed).toBe(true);
    expect(report.offenders).toContain("overlap");
  });

  it("catches a persona whose lines became less likely for this person", () => {
    const worse = aggregateScores([
      {
        ...baseline.scores[0],
        likelihoodGap: 5,
      },
    ]);
    const report = compareToBaseline(baseline, worse);
    expect(report.regressed).toBe(true);
    expect(report.offenders).toContain("likelihoodGap");
  });

  it("does not call a tiny movement a regression", () => {
    const barely = aggregateScores([
      {
        ...baseline.scores[0],
        overlap: 0.49,
      },
    ]);
    expect(compareToBaseline(baseline, barely).regressed).toBe(false);
  });

  it("catches a persona that reads the wrong emotions", () => {
    const worse = aggregateScores([
      {
        ...baseline.scores[0],
        expectedState: "playful",
        actualState: "melancholy",
      },
    ]);
    const report = compareToBaseline(baseline, worse);
    expect(report.regressed).toBe(true);
    expect(report.offenders).toContain("emotionAccuracy");
  });

  it("takes the tolerances it is given", () => {
    const barely = aggregateScores([
      {
        ...baseline.scores[0],
        overlap: 0.49,
      },
    ]);
    // The default tolerance forgives a point; a tighter one does not.
    expect(compareToBaseline(baseline, barely).regressed).toBe(false);
    const report = compareToBaseline(baseline, barely, { overlap: 0.005 });
    expect(report.regressed).toBe(true);
    expect(report.offenders).toEqual(["overlap"]);
  });
});
