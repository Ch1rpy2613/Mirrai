/**
 * The command line face of the evaluation.
 *
 * It answers the question the whole test suite could not: does the
 * rebuilt persona still sound like the person it was built from?
 *
 * The cases are cut from the imported chat records — one of their lines
 * is held back — and the rebuilt persona has to say it again. The answer
 * is scored against the line that was actually said, and the run is
 * compared with the baseline so that a change which makes the persona
 * worse cannot pass unnoticed.
 *
 * Usage:
 *   pnpm eval -- --persona 1 --user 1            # score one persona
 *   pnpm eval -- --persona 1 --user 1 --variant withoutRules
 *   pnpm eval -- --persona 1 --user 1 --cases    # only cut the cases
 *   pnpm eval -- --persona 1 --user 1 --save     # store the run
 */
import * as db from "../server/db";
import {
  buildEvalCases,
  casesFromRows,
  trainingTexts,
  type EvalSourceMessage,
} from "../server/eval/dataset";
import { runEval } from "../server/eval/run";
import {
  evaluateGate,
  evaluateRuleBenefit,
  type EvalMetrics,
} from "../server/eval/metrics";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const personaId = Number(flag("persona"));
const userId = Number(flag("user"));
const variant = (flag("variant") ?? "default") as "default" | "withoutRules";
const onlyCases = args.includes("--cases");
const save = args.includes("--save");
/**
 * The gate.
 *
 * With `--gate`, the run is compared with the last saved run and the
 * process fails if the persona got less alike. Without it, the same
 * comparison happens but the process still exits zero — the run is a
 * report, not a verdict.
 */
const gate = args.includes("--gate");
/**
 * Measures the same persona both ways.
 *
 * This is the A/B the rules have to pass: if they do not move the
 * numbers, they do not belong in the prompt.
 */
const compare = args.includes("--compare");
/**
 * Whether to print the pairs the blind test needs.
 *
 * The real line and the one the persona said, side by side, with
 * nothing saying which is which.
 */
const pairs = args.includes("--pairs");
const maxCases = Number(flag("max") ?? 12);
/**
 * The language the records are written in.
 *
 * The emotion is read off the words, so it is read with the trigger
 * table of the language they are in. Reading an English record with the
 * Chinese table finds no emotion in any line — and every per-state
 * number is then empty rather than wrong-looking, which is worse.
 */
const locale = (flag("locale") ?? "zh") === "en" ? "en" : "zh";

if (!Number.isFinite(personaId) || !Number.isFinite(userId)) {
  console.error(
    "Usage: pnpm eval -- --persona <id> --user <id> [--variant withoutRules] [--locale zh|en] [--cases] [--pairs] [--save] [--gate] [--compare] [--calibrate] [--temperature n] [--tolerance-overlap n] [--tolerance-likelihood n] [--tolerance-emotion n]",
  );
  process.exit(1);
}

/**
 * The recorded messages, in the order they were said.
 *
 * The records are the ground truth. The app's own conversation is not
 * used here — the persona wrote that one, so measuring against it would
 * measure nothing.
 */
async function loadRecords(): Promise<EvalSourceMessage[]> {
  const rows = await db.getCollectedMessagesForPersona(personaId, userId);
  return rows
    .map((row) => ({
      id: row.id,
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: row.content,
      timestamp: row.timestamp ?? null,
    }))
    .filter((message) => message.content.trim().length > 0);
}

const records = await loadRecords();
if (!records.length) {
  console.error("No collected records for this persona. Import the chat logs first.");
  process.exit(1);
}

// The stored cases are the ones that get measured. Cutting a fresh set
// every time would measure a different question each time — and the
// comparison with the baseline would be between two different things,
// which is the one thing a gate must never be.
const stored = casesFromRows(await db.getEvalCases(personaId, userId));
const cases = stored.length
  ? stored
  : buildEvalCases(records, { maxCases, locale });
console.log(
  `[eval] ${records.length} records → ${cases.length} held-out cases` +
    (stored.length ? " (the stored ones)" : ""),
);

if (pairs) {
  // The blind test needs the two lines side by side: the real one and
  // the one the persona said. It is a human measurement — a person who
  // knew the person deciding which of the two is theirs — and it needs
  // the lines themselves, not a number about them.
  const blind = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant,
    locale,
  });
  console.log("");
  console.log("[eval] the pairs for the blind test:");
  for (const score of blind.scores) {
    console.log("");
    console.log(`  case ${score.caseId}`);
    console.log(`    real: ${score.expectedText ?? ""}`);
    console.log(`    said: ${score.generatedText ?? ""}`);
  }
  console.log("");
  console.log("Give each pair to someone who knew the person, without saying which is which.");
  process.exit(0);
}

if (onlyCases) {
  for (const item of cases) {
    console.log(`  · ${item.expectedState ?? "—"}  ${item.expected.content.slice(0, 48)}`);
  }
  process.exit(0);
}

const persona = await db.getPersonaById(personaId, userId);
if (!persona) {
  console.error("No such persona.");
  process.exit(1);
}

const training = trainingTexts(records, cases);

/**
 * The A/B.
 *
 * The rules and the per-state imperfection could make the numbers better
 * and the persona worse. The only way to know is to measure the same
 * persona both ways — with them and without them — and look at the
 * difference.
 *
 * So: "the rules are worth keeping if they make the persona measurably
 * closer to the person". If they do not, they are decoration, and a
 * prompt full of decoration is a prompt full of noise.
 */
if (compare) {
  const withThem = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "default",
    locale,
    temperature,
  });
  const withoutThem = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "withoutRules",
    locale,
    temperature,
  });

  const row = (label: string, a: number, b: number, better: "higher" | "closer") => {
    const delta = a - b;
    const improved = better === "higher" ? delta > 0 : Math.abs(b) < Math.abs(a);
    console.log(
      `  ${label.padEnd(12)} with=${a.toFixed(4)}  without=${b.toFixed(4)}  ` +
        `delta=${delta > 0 ? "+" : ""}${delta.toFixed(4)}  ${improved ? "better with" : "not better with"}`,
    );
    return improved;
  };

  console.log("");
  console.log("[eval] the same persona, measured both ways:");
  row("overlap", withThem.overlap, withoutThem.overlap, "higher");
  row("likelihood", withThem.likelihoodGap, withoutThem.likelihoodGap, "closer");
  row("emotion", withThem.emotionAccuracy, withoutThem.emotionAccuracy, "higher");

  const benefit = evaluateRuleBenefit(withThem, withoutThem);
  console.log("");
  if (save) {
    await db.saveEvalRun(
      personaId,
      userId,
      { ...withThem, variant: "default" },
      persona.personaData,
    );
    console.log("[eval] run saved");
  }
  // The run is saved before the gate decides, so `--save` saves whether
  // or not the gate passes. A flag that quietly stops working when
  // something else fails is a flag nobody can rely on.
  if (benefit.improved === 0) {
    console.error(`[eval] ${benefit.note}`);
    if (gate) process.exit(benefit.exitCode);
  } else {
    console.log(`[eval] ${benefit.note}`);
  }
  process.exit(0);
}

/**
 * The calibration.
 *
 * The tolerances above are a guess. A guess is not good enough for a
 * gate, because the measurement is sampled: two runs of an unchanged
 * persona do not agree, and if the tolerance is narrower than that
 * disagreement the gate is measuring the weather.
 *
 * So this runs the same persona several times, with nothing changed,
 * and reports how far the numbers move. The tolerances are then set from
 * that spread rather than from a guess — and the guess can be replaced
 * with a number that means something.
 */
if (calibrate) {
  const runs: EvalMetrics[] = [];
  for (let i = 0; i < calibrateRuns; i++) {
    console.log(`[eval] calibration run ${i + 1} of ${calibrateRuns}…`);
    runs.push(
      await runEval({
        persona,
        userId,
        cases,
        trainingTexts: training,
        variant,
        locale,
        temperature,
      }),
    );
  }

  const spread = (values: number[]): { min: number; max: number; width: number } => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, width: max - min };
  };

  console.log("");
  console.log("[eval] how far the numbers move when nothing has changed:");
  const overlaps = spread(runs.map((r) => r.overlap));
  const likelihoods = spread(runs.map((r) => r.likelihoodGap));
  const emotions = spread(runs.map((r) => r.emotionAccuracy));
  console.log(`  overlap        ${overlaps.min.toFixed(4)} … ${overlaps.max.toFixed(4)}   (moves ${overlaps.width.toFixed(4)})`);
  console.log(`  likelihoodGap  ${likelihoods.min.toFixed(4)} … ${likelihoods.max.toFixed(4)}   (moves ${likelihoods.width.toFixed(4)})`);
  console.log(`  emotionAccuracy ${emotions.min.toFixed(4)} … ${emotions.max.toFixed(4)}   (moves ${emotions.width.toFixed(4)})`);
  console.log("");
  console.log("[eval] Set the tolerances wider than that spread, or the gate is");
  console.log("[eval] measuring the weather rather than the persona:");
  console.log("  pnpm eval -- --tolerance-overlap " + (overlaps.width * 1.5).toFixed(3) +
    " --tolerance-likelihood " + (likelihoods.width * 1.5).toFixed(3) +
    " --tolerance-emotion " + (emotions.width * 1.5).toFixed(3));
  process.exit(0);
}

const metrics = await runEval({
  persona,
  userId,
  cases,
  trainingTexts: training,
  variant,
  locale,
  temperature,
});

console.log("");
console.log(`[eval] variant: ${variant}`);
console.log(`[eval] cases scored : ${metrics.cases}`);
console.log(`[eval] overlap      : ${metrics.overlap.toFixed(4)}  (higher is closer)`);
console.log(`[eval] likelihood   : ${metrics.likelihoodGap.toFixed(4)}  (zero means indistinguishable)`);
console.log(`[eval] length dist  : ${metrics.lengthDistance.toFixed(2)} characters`);
console.log(`[eval] emotion      : ${(metrics.emotionAccuracy * 100).toFixed(1)}% agreement`);

if (Object.keys(metrics.perState).length) {
  console.log("[eval] per state (words, then the shape of the line):");
  for (const [state, bucket] of Object.entries(metrics.perState)) {
    console.log(
      `  · ${state.padEnd(10)} n=${String(bucket.count).padStart(2)}` +
        `  overlap=${bucket.overlap.toFixed(4)}` +
        `  length±${bucket.lengthGap.toFixed(1)}` +
        `  sentences±${bucket.sentenceGap.toFixed(2)}` +
        `  address±${bucket.addressGap.toFixed(2)}`,
    );
  }
}

const matrix = (metrics as any).emotionMatrix as
  | Record<string, Record<string, number>>
  | undefined;
if (matrix && Object.keys(matrix).length) {
  console.log("[eval] which emotion was confused with which:");
  for (const [expected, row] of Object.entries(matrix)) {
    const cells = Object.entries(row)
      .map(([actual, count]) => `${actual}×${count}`)
      .join("  ");
    console.log(`  · ${expected.padEnd(10)} ${cells}`);
  }
}

// The baseline has to be a run of the *same* persona: a run with the
// rules switched off is a different persona, and comparing the two
// would say nothing about either.
const baselineRow = await db.getLatestEvalRun(personaId, userId);
const storedBaseline = baselineRow ? (baselineRow.metricsJson as EvalMetrics) : null;
const baseline =
  storedBaseline && (!storedBaseline.variant || storedBaseline.variant === variant)
    ? storedBaseline
    : null;
if (save) {
  // The run is saved before the gate decides, so `--save` saves whether
  // or not the gate passes. A flag that quietly stops working when
  // something else fails is a flag nobody can rely on.
  const id = await db.saveEvalRun(
    personaId,
    userId,
    { ...metrics, variant },
    persona.personaData,
  );
  console.log(`[eval] run ${id} saved`);
}

const outcome = evaluateGate(baseline, metrics, variant, tolerances);
console.log("");
if (outcome.regressed) {
  console.error(`[eval] ${outcome.note}`);
  // The gate fails whether or not the run is being saved. `--save` is
  // about keeping the measurement, not about whether a regression
  // counts — and a flag that turns the gate off is a flag nobody should
  // be able to pass by accident.
  if (gate) process.exit(outcome.exitCode);
} else if (gate && outcome.exitCode !== 0) {
  // There is nothing to regress against. Saying so is more useful than
  // passing quietly — a green run with no baseline proves nothing. The
  // gate was asked to check something and could not, so it fails.
  console.warn(`[eval] ${outcome.note}`);
  process.exit(outcome.exitCode);
} else {
  console.log(`[eval] ${outcome.note}`);
}

