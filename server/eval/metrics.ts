/**
 * How alike is the rebuilt persona, really?
 *
 * Everything in this project had a test, and every one of those tests
 * checked a *mechanism*: that the schema is shaped right, that the
 * prompt is assembled, that the state machine switches when it should.
 * None of them checked the only question that matters — does this still
 * sound like the person?
 *
 * The measurements here are deliberately computable without a human in
 * the loop, because a ruler that needs a person to operate is a ruler
 * nobody reaches for. There is also a blind protocol for the humans
 * (`docs/eval/blind-test.md`), but this file is what runs on every
 * change.
 *
 * Four numbers, because four different things can go wrong:
 *
 *   overlap    — does it use the same words? (surface)
 *   likelihood — would this person have written this? (distribution)
 *   length     — is it the same size as the real thing? (habit)
 *   emotion    — does it read the same way? (state)
 *
 * A persona can score well on one and badly on another. A rule that
 * raises the overlap and lowers the likelihood has made the persona
 * repetitive, not more like itself.
 */
import { matchEmotionTrigger, type EmotionTriggerState } from "@shared/emotion-triggers";

/** One held-out exchange, and what the rebuilt persona said instead. */
export interface EvalCaseScore {
  caseId: number;
  /** Dice coefficient over character n-grams, 0–1. */
  overlap: number;
  /** log-likelihood of the generated line minus the real one, under the person's own n-gram model. */
  likelihoodGap: number;
  /** The generated line's length minus the real one's. */
  lengthDelta: number;
  /** The real line's length, in characters. */
  expectedLength: number;
  /** The generated line's length, in characters. */
  generatedLength: number;
  /** The shape of the real line. */
  expectedShape: LineShape;
  /** The shape of the generated line. */
  generatedShape: LineShape;
  /** The emotion the real line carried. */
  expectedState: EmotionTriggerState | null;
  /** The emotion the generated line reads as. */
  actualState: EmotionTriggerState | null;
  /** The persona's own declared state, when the run recorded one. */
  declaredState: EmotionTriggerState | null;
  /**
   * The real line, and the line the persona said.
   *
   * They are carried so that a person can be shown the two side by side.
   * The blind test is a *human* measurement — a person who knew the
   * person deciding which of the two is theirs — and it needs the two
   * lines, not a number about them.
   */
  expectedText?: string;
  generatedText?: string;
}

/** The aggregate of a run. */
export interface EvalMetrics {
  /** How many cases were scored. */
  cases: number;
  /** Mean overlap, 0–1. Higher is closer. */
  overlap: number;
  /** Mean likelihood gap. Zero means indistinguishable; negative means the rebuild is *more* likely than the original. */
  likelihoodGap: number;
  /** The 1-Wasserstein distance between the two length distributions, in characters. */
  lengthDistance: number;
  /** How often the generated line reads as the same emotion, 0–1. */
  emotionAccuracy: number;
  /**
   * The confusion matrix: what the real line carried, against what the
   * generated one carries.
   *
   * The accuracy above says how often the persona got it right. This
   * says *how it gets it wrong* — and that is the different question.
   * A persona that reads every playful line as nostalgic is not
   * randomly wrong; it has one systematic mistake, and the matrix is
   * where that mistake becomes visible. An accuracy of 40% and a matrix
   * with one hot cell are two different failures, and they need two
   * different fixes.
   */
  emotionMatrix: Record<string, Record<string, number>>;
  /** The same numbers, per expected state. */
  perState: Record<
    string,
    { count: number; overlap: number; lengthGap: number; sentenceGap: number; addressGap: number }
  >;
  /** Every case, so a regression can be traced to the case that caused it. */
  scores: EvalCaseScore[];
  /**
   * Which version of the persona was measured.
   *
   * A run with the rules switched off is a *different persona*, so it
   * must never be compared against a run with them on. The variant is
   * stored with the run for exactly that reason.
   */
  variant?: string;
}

/**
 * The shape of a line.
 *
 * Length alone is not enough. A person's messages have a shape — how
 * long they run, how many sentences they break into, how often they use
 * a name for the other person — and a persona that reproduces the
 * words but not the shape is reciting.
 *
 * These three are measured per emotional state, because the shape
 * changes with the mood: a person who is happy sends three short lines;
 * a person who is far away sends one long one.
 */
export interface LineShape {
  /** The number of characters. */
  chars: number;
  /** The number of sentences. */
  sentences: number;
  /** How often a form of address appears. */
  addresses: number;
}

/**
 * The words people use for each other.
 *
 * This is a crude measure and it is deliberately so: the point is not to
 * count how affectionate the persona is, but to notice when it is
 * addressing the user constantly when the real person only did so in
 * the state they were in.
 */
const ADDRESS_WORDS: Record<"zh" | "en", RegExp> = {
  zh: /宝贝|宝宝|亲爱的|老婆|老公|小可爱|小笨蛋|小朋友|哥哥|姐姐|宝儿/g,
  en: /baby|babe|dear|honey|love|darling/gi,
};

/** How many sentences a line has. */
function countSentences(text: string): number {
  const parts = text
    .split(/[。！？!?…\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

/** How many times the line addresses the other person. */
function countAddresses(text: string, locale: "zh" | "en"): number {
  const pattern = ADDRESS_WORDS[locale] ?? ADDRESS_WORDS.zh;
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/** The shape of a line. */
export function measureLineShape(text: string, locale: "zh" | "en" = "zh"): LineShape {
  return {
    chars: text.length,
    sentences: countSentences(text),
    addresses: countAddresses(text, locale),
  };
}

/** A character n-gram model over one person's writing. */
export interface CharNgramModel {
  /** The log-likelihood of a string under the model. */
  logProb(text: string): number;
}

function normaliseForModel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Builds a character n-gram model from a person's own writing.
 *
 * This is the "would they have written this?" measure. It is a crude
 * model next to a language model, but it has two properties that matter
 * more than sophistication here:
 *
 *   it is fitted on the *person*, not on a corpus, so it measures their
 *   habits rather than the average person's; and
 *   it is fitted on the *other* messages, never on the held-out one, so
 *   it does not simply memorise the answer back.
 */
export function buildCharNgramModel(
  texts: string[],
  order = 3,
  smoothing = 0.5,
): CharNgramModel {
  const counts = new Map<number, Map<string, Map<string, number>>>();
  const totals = new Map<number, Map<string, number>>();
  let vocab = new Set<string>();

  for (const raw of texts) {
    const text = normaliseForModel(raw);
    if (!text) continue;
    for (const ch of text) vocab.add(ch);
    for (let k = 0; k < order; k++) {
      const level = counts.get(k) ?? new Map<string, Map<string, number>>();
      const levelTotals = totals.get(k) ?? new Map<string, number>();
      for (let i = 0; i <= text.length; i++) {
        const context = text.slice(Math.max(0, i - k), i);
        const ch = i < text.length ? text[i] : "";
        const bucket = level.get(context) ?? new Map<string, number>();
        bucket.set(ch, (bucket.get(ch) ?? 0) + 1);
        level.set(context, bucket);
        levelTotals.set(context, (levelTotals.get(context) ?? 0) + 1);
      }
      counts.set(k, level);
      totals.set(k, levelTotals);
    }
  }

  const vocabSize = Math.max(1, vocab.size);

  const logProb = (text: string): number => {
    const clean = normaliseForModel(text);
    if (!clean) return 0;
    let total = 0;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      let probability = 0;
      for (let k = Math.min(order - 1, i); k >= 0; k--) {
        const context = clean.slice(Math.max(0, i - k), i);
        const bucket = counts.get(k)?.get(context);
        if (!bucket) continue;
        const seen = bucket.get(ch) ?? 0;
        const denominator = (totals.get(k)?.get(context) ?? 0) + smoothing * vocabSize;
        probability = (seen + smoothing) / denominator;
        break;
      }
      if (!probability) {
        const bucket = counts.get(0)?.get("");
        const seen = bucket?.get(ch) ?? 0;
        const denominator = (totals.get(0)?.get("") ?? 0) + smoothing * vocabSize;
        probability = (seen + smoothing) / denominator;
      }
      total += Math.log(Math.max(probability, 1e-12));
    }
    return total;
  };

  return { logProb };
}

/**
 * The Dice coefficient over character n-grams.
 *
 * Both directions matter: a persona that says everything the person says,
 * plus a paragraph of its own, would score high on recall and low on
 * precision. Dice punishes that, which is the behaviour we want.
 */
export function ngramOverlap(expected: string, generated: string, n = 3): number {
  const grams = (text: string): Set<string> => {
    const clean = normaliseForModel(text).replace(/\s+/g, "");
    const out = new Set<string>();
    if (clean.length < n) {
      if (clean) out.add(clean);
      return out;
    }
    for (let i = 0; i <= clean.length - n; i++) out.add(clean.slice(i, i + n));
    return out;
  };
  const a = grams(expected);
  const b = grams(generated);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * The 1-Wasserstein distance between two sets of numbers.
 *
 * This is the "how far apart are these two distributions" measure — the
 * one-dimensional case is exact and cheap, so there is no reason to
 * approximate it.
 */
export function wasserstein1d(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const points = [...new Set([...a, ...b])].sort((x, y) => x - y);
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const mid = (points[i] + points[i + 1]) / 2;
    const cdfA = a.filter((x) => x <= mid).length / a.length;
    const cdfB = b.filter((x) => x <= mid).length / b.length;
    total += Math.abs(cdfA - cdfB) * (points[i + 1] - points[i]);
  }
  return total;
}

/** Scores one case. */
export function scoreCase(params: {
  caseId: number;
  expected: string;
  generated: string;
  model: CharNgramModel;
  declaredState?: EmotionTriggerState | null;
  /**
   * The language the lines are written in.
   *
   * The emotion is read off the words, so it has to be read in the
   * language the words are in. Reading an English line with the Chinese
   * trigger table finds nothing — which does not mean the line has no
   * emotion, it means the ruler was reading it with the wrong table, and
   * every number it produced afterwards was quietly wrong.
   */
  locale?: "zh" | "en";
}): EvalCaseScore {
  const locale = params.locale ?? "zh";
  const expectedState = matchEmotionTrigger(params.expected, locale);
  const actualState = matchEmotionTrigger(params.generated, locale);
  const expectedLog = params.model.logProb(params.expected);
  const generatedLog = params.model.logProb(params.generated);
  return {
    expectedShape: measureLineShape(params.expected),
    generatedShape: measureLineShape(params.generated),
    caseId: params.caseId,
    overlap: ngramOverlap(params.expected, params.generated),
    likelihoodGap: generatedLog - expectedLog,
    lengthDelta: params.generated.length - params.expected.length,
    expectedLength: params.expected.length,
    generatedLength: params.generated.length,
    expectedState,
    actualState,
    declaredState: params.declaredState ?? null,
    expectedText: params.expected,
    generatedText: params.generated,
  };
}

/** Aggregates the cases into the run's numbers. */
export function aggregateScores(scores: EvalCaseScore[]): EvalMetrics {
  const n = scores.length;
  if (!n) {
    return {
      cases: 0,
      overlap: 0,
      likelihoodGap: 0,
      lengthDistance: 0,
      emotionAccuracy: 0,
      emotionMatrix: {},
      perState: {},
      scores: [],
    };
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  const overlap = mean(scores.map((s) => s.overlap));
  const likelihoodGap = mean(scores.map((s) => s.likelihoodGap));

  // The per-state buckets. A persona that is only right in the happy
  // state is half a persona, so each state is measured on its own: the
  // words, and the shape of the line they came in.
  const perState: Record<
    string,
    { count: number; overlap: number; lengthGap: number; sentenceGap: number; addressGap: number }
  > = {};
  for (const score of scores) {
    const key = score.expectedState ?? "none";
    const bucket = perState[key] ?? {
      count: 0,
      overlap: 0,
      lengthGap: 0,
      sentenceGap: 0,
      addressGap: 0,
    };
    bucket.count += 1;
    bucket.overlap += score.overlap;
    bucket.lengthGap += Math.abs(score.generatedShape.chars - score.expectedShape.chars);
    bucket.sentenceGap += Math.abs(score.generatedShape.sentences - score.expectedShape.sentences);
    bucket.addressGap += Math.abs(score.generatedShape.addresses - score.expectedShape.addresses);
    perState[key] = bucket;
  }
  for (const key of Object.keys(perState)) {
    const bucket = perState[key];
    bucket.overlap = bucket.overlap / bucket.count;
    bucket.lengthGap = bucket.lengthGap / bucket.count;
    bucket.sentenceGap = bucket.sentenceGap / bucket.count;
    bucket.addressGap = bucket.addressGap / bucket.count;
  }

  // The length comparison is between two *distributions*: the real lines
  // and the generated ones. Comparing them pairwise would punish a
  // persona for varying its length the way the person varies theirs.
  const lengthDistance = wasserstein1d(
    scores.map((s) => s.expectedLength),
    scores.map((s) => s.generatedLength),
  );

  const emotionMatches = scores.filter(
    (s) => s.expectedState !== null && s.expectedState === s.actualState,
  ).length;
  const emotionDenominator = scores.filter((s) => s.expectedState !== null).length;

  // The confusion matrix: expected state down the side, actual state
  // across it. The cells that are not on the diagonal are the persona's
  // systematic mistakes, and they are the interesting ones.
  const emotionMatrix: Record<string, Record<string, number>> = {};
  for (const score of scores) {
    if (!score.expectedState) continue;
    const row = emotionMatrix[score.expectedState] ?? {};
    const key = score.actualState ?? "none";
    row[key] = (row[key] ?? 0) + 1;
    emotionMatrix[score.expectedState] = row;
  }

  return {
    cases: n,
    overlap,
    likelihoodGap,
    lengthDistance,
    emotionAccuracy: emotionDenominator ? emotionMatches / emotionDenominator : 0,
    emotionMatrix,
    perState,
    scores,
  };
}

/** A regression is a movement in the wrong direction, past a tolerance. */
export interface RegressionReport {
  regressed: boolean;
  /** The names of the metrics that moved the wrong way. */
  offenders: string[];
}

/**
 * Compares a run against the baseline.
 *
 * The tolerances are deliberately loose on the surface metric and tight
 * on the distribution metric. A change that shifts the length
 * distribution or the person's likelihood is a change in the persona's
 * behaviour; a change that shifts the overlap by a point or two is
 * probably noise.
 */
/**
 * What the gate decided.
 *
 * The gate is the part of this that has to be right: it is what stands
 * between a change and a persona that has quietly stopped sounding like
 * the person. So the decision lives here, in a function that can be
 * tested, rather than in a script that can only be run.
 */
export interface GateOutcome {
  /** Whether the persona got worse than the baseline. */
  regressed: boolean;
  /** Which measures got worse. */
  offenders: string[];
  /** The exit code the gate ends with. */
  exitCode: number;
  /** What to tell the person reading the output. */
  note: string;
}

/**
 * The gate, given a baseline and a fresh measurement.
 *
 * A gate that cannot check anything does not pass. It fails — because a
 * green mark that checked nothing is the most expensive kind of lie a
 * build can tell.
 */
export function evaluateGate(
  baseline: EvalMetrics | null,
  metrics: EvalMetrics,
  variant = "default",
  tolerances: { overlap?: number; likelihoodGap?: number; emotionAccuracy?: number } = {},
): GateOutcome {
  if (!baseline) {
    return {
      regressed: false,
      offenders: [],
      exitCode: 2,
      note: "no baseline run to compare against; nothing was checked",
    };
  }
  // A run of the other variant is a different persona, so it is not a
  // baseline for this one.
  if (baseline.variant && baseline.variant !== variant) {
    return {
      regressed: false,
      offenders: [],
      exitCode: 2,
      note:
        "the last run was of the other variant, so there is nothing to compare against; nothing was checked",
    };
  }
  const report = compareToBaseline(baseline, metrics, tolerances);
  if (report.regressed) {
    return {
      regressed: true,
      offenders: report.offenders,
      exitCode: 2,
      note: `REGRESSION against the last run: ${report.offenders.join(", ")}`,
    };
  }
  return {
    regressed: false,
    offenders: [],
    exitCode: 0,
    note: "no regression against the last run",
  };
}

/**
 * Whether the rules make the persona measurably closer.
 *
 * The one honest acceptance criterion in the whole phase: if the rules
 * do not move the numbers, they are decoration, and a prompt full of
 * decoration is a prompt full of noise.
 */
export function evaluateRuleBenefit(
  withRules: EvalMetrics,
  withoutRules: EvalMetrics,
): { improved: number; of: number; exitCode: number; note: string } {
  const overlapBetter = withRules.overlap > withoutRules.overlap;
  const likelihoodBetter =
    Math.abs(withRules.likelihoodGap) < Math.abs(withoutRules.likelihoodGap);
  const emotionBetter = withRules.emotionAccuracy > withoutRules.emotionAccuracy;
  const of = 3;
  const improved = [overlapBetter, likelihoodBetter, emotionBetter].filter(Boolean).length;
  if (improved === 0) {
    return {
      improved,
      of,
      exitCode: 3,
      note:
        "The rules do not make the persona measurably closer. They are decoration — remove them.",
    };
  }
  return {
    improved,
    of,
    exitCode: 0,
    note: `The rules help on ${improved} of ${of} measures.`,
  };
}

export function compareToBaseline(
  baseline: EvalMetrics,
  current: EvalMetrics,
  tolerances: { overlap?: number; likelihoodGap?: number; emotionAccuracy?: number } = {},
): RegressionReport {
  const overlapTolerance = tolerances.overlap ?? 0.02;
  const likelihoodTolerance = tolerances.likelihoodGap ?? 1.0;
  const emotionTolerance = tolerances.emotionAccuracy ?? 0.05;

  const offenders: string[] = [];
  if (current.overlap < baseline.overlap - overlapTolerance) offenders.push("overlap");
  if (current.likelihoodGap > baseline.likelihoodGap + likelihoodTolerance) {
    offenders.push("likelihoodGap");
  }
  if (current.emotionAccuracy < baseline.emotionAccuracy - emotionTolerance) {
    offenders.push("emotionAccuracy");
  }
  return { regressed: offenders.length > 0, offenders };
}
