#!/usr/bin/env tsx
/**
 * The gate that can actually gate.
 *
 * The third phase added a ruler: one of the person's real lines is held
 * back, and the rebuilt persona has to say it again, and the numbers are
 * compared with the last run's. That measurement is the honest one — but
 * it is also *noisy*, because a reply is sampled and a sampled reply is
 * not the same twice.
 *
 * Measured against the real metric, two runs of an unchanged persona
 * differ by more than the gate's tolerance about 42% of the time. A
 * gate that cries wolf that often does not gate anything; it trains
 * people to re-run until the colour is the one they want.
 *
 * So this is the gate that runs on every change: it checks the things
 * that are *decided* rather than sampled. That the rules are in the
 * prompt, as a hard constraint, in the right place. That an unconfirmed
 * candidate never reaches the prompt. That the imperfection follows the
 * state the prompt states. That the persona's data survives the round
 * trip through the database's jsonb. That the Layer 0 still says the
 * persona cannot carry a message out of the app.
 *
 * None of that costs a model call, none of it needs the person's
 * records, and none of it has a distribution. It runs in a second and
 * it is the same answer every time.
 *
 * The fidelity measurement is not thrown away — it is moved to where it
 * can be run honestly: on the person's own machine, against the person's
 * own records, with the numbers written down for a human to read.
 *
 *     pnpm eval -- --persona 1 --user 1 --compare
 *
 * Usage: pnpm fidelity:gate
 */
import { buildSystemPrompt } from "../server/_core/persona-utils";
import { normalizePersonaData } from "../server/_core/persona-schema";
import { normalizeMicroRules } from "@shared/micro-rules";
import { normalizeImperfectionProfile } from "@shared/imperfection";
import { PROMPT } from "@shared/copy/prompt";

/** One thing that went wrong, said in a sentence a person can act on. */
interface Failure {
  what: string;
  why: string;
}

const failures: Failure[] = [];

function check(condition: boolean, what: string, why: string): void {
  if (!condition) failures.push({ what, why });
}

/**
 * A persona with everything switched on.
 *
 * It is a fixture, but it is a fixture of a *complete* persona: a
 * confirmed rule, a candidate nobody has confirmed, two states of
 * imperfection, and a state to be in.
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
    realismLevel: 70,
    microRules: [
      {
        id: "confirmed-1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷，不解释",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [{ snippet: "随便你", at: "2025-03-01" }],
      },
      {
        id: "candidate-1",
        trigger: ["算了"],
        meaning: "她放弃了",
        rendering: "只回一个嗯",
        confidence: 0.5,
        source: "auto",
        verified: false,
        evidence: [{ snippet: "算了", at: "2025-03-02" }],
      },
    ],
    imperfectionProfile: [
      { state: "distant", deviations: ["极短句", "不解释"] },
      { state: "happy", deviations: ["会连着发三条"] },
    ],
  },
} as any;

const prompt = buildSystemPrompt(persona, { locale: "zh" });

// ── The rules are in the prompt, and they are instructions ────────────────

check(
  prompt.includes("随便你"),
  "the confirmed rule's trigger is not in the prompt",
  "a rule the user confirmed has stopped reaching the persona — " +
    "the prompt builder is probably not reading personaData.microRules any more",
);
check(
  prompt.includes("她真的生气了"),
  "the confirmed rule's meaning is not in the prompt",
  "the trigger arrived but the meaning did not — the rule is being " +
    "rendered as a word list rather than as a rule",
);
check(
  prompt.includes("更短、更冷，不解释"),
  "the confirmed rule's rendering is not in the prompt",
  "what the person actually does about it is the part the model needs; " +
    "without it the rule says what it means and not what to do",
);

// ── A candidate nobody confirmed never reaches the prompt ────────────────

check(
  !prompt.includes("算了"),
  "an unconfirmed candidate reached the prompt",
  "a rule the model wrote and the user never checked is worse than no " +
    "rule — the user has to be able to look at it before it counts",
);

// ── The rules sit with the persona's instructions, not at the end ────────

const speaking = prompt.indexOf("慢慢说");
const rules = prompt.indexOf("随便你");
const principles = prompt.indexOf("【对话原则】");
check(
  speaking >= 0 && rules > speaking,
  "the rules come before the speaking style",
  "a rule that arrives before the persona's own instructions is read as " +
    "part of the setup rather than as a rule",
);
check(
  principles > 0 && rules > 0 && rules < principles,
  "the rules arrive after the closing principles",
  "a rule that arrives as a closing note is read as a closing note — " +
    "it has to sit with the persona's own instructions",
);

// ── The imperfection follows the state the prompt states ─────────────────

check(
  prompt.includes("极短句"),
  "the imperfection of the current state is not in the prompt",
  "the persona is in a state, and the deviations of that state are not " +
    "being applied — the imperfection has come loose from the state",
);
check(
  !prompt.includes("会连着发三条"),
  "the imperfection of another state reached the prompt",
  "a persona that is imperfect in six states at once is a persona with " +
    "one personality wearing six hats",
);

// The state the prompt states is the one that applies.
const inHappy = buildSystemPrompt(
  { ...persona, emotionalState: "happy" },
  { locale: "zh" },
);
check(
  inHappy.includes("会连着发三条") && !inHappy.includes("极短句"),
  "the imperfection does not follow the state",
  "switching the persona's state did not switch its imperfection — the " +
    "deviations are being taken from somewhere other than the state",
);

// ── The persona's data survives the round trip through jsonb ─────────────

const roundTripped = normalizePersonaData(
  JSON.parse(JSON.stringify(persona.personaData)),
  "zh",
);
check(
  roundTripped.microRules?.length === persona.personaData.microRules.length,
  "the rules did not survive the round trip through the database",
  "personaData is jsonb: what goes in comes back out as json, and a " +
    "rule that does not survive that is a rule that disappears on save",
);
check(
  (roundTripped.microRules ?? []).every(
    (rule, index) =>
      rule.trigger.join("|") ===
      persona.personaData.microRules[index].trigger.join("|"),
  ),
  "a rule came back from the database changed",
  "the trigger is what the rule fires on — a rule that comes back with " +
    "a different trigger is a different rule",
);
check(
  (roundTripped.imperfectionProfile ?? []).some(
    (entry) => entry.state === "distant",
  ),
  "the imperfection did not survive the round trip through the database",
  "the per-state imperfection lives in personaData too, and it has the " +
    "same obligation to come back unchanged",
);

// ── A persona that never opted in is untouched ───────────────────────────

const plain = buildSystemPrompt(
  {
    ...persona,
    personaData: { personality: "温柔", speakingStyle: "慢慢说" },
  },
  { locale: "zh" },
);
check(
  !plain.includes("极短句") && !plain.includes("随便你"),
  "a persona that never opted in gained a personality",
  "the rules and the imperfection are opt-in — a persona distilled " +
    "before either existed has to keep behaving exactly as it did",
);

// ── The persona still cannot carry a message out of the app ─────────────

const hardRules = PROMPT["prompt.hardRules"].zh;
check(
  hardRules.includes("不能替用户给外面的人传话"),
  "Layer 0 no longer says the persona cannot carry a message outside the app",
  "the exit exists, and the line that keeps it honest is in Layer 0 — " +
    "without it the persona may promise to deliver a line it cannot deliver",
);

// ── The report ───────────────────────────────────────────────────────────

const checks = [
  "the confirmed rule is in the prompt, with its meaning and what to do",
  "an unconfirmed candidate never reaches the prompt",
  "the rules sit with the persona's own instructions",
  "the imperfection follows the state the prompt states",
  "the persona's data survives the round trip through the database",
  "a persona that never opted in is untouched",
  "Layer 0 still says the persona cannot carry a message out of the app",
];

if (failures.length === 0) {
  console.log("[gate] the persona still has everything it needs:");
  for (const item of checks) console.log(`  ✓ ${item}`);
  console.log("");
  console.log("[gate] The fidelity measurement itself is not here — it needs");
  console.log("[gate] the person's records and a model, and it is sampled, so");
  console.log("[gate] it is run on their machine: pnpm eval -- --persona 1 --user 1");
  process.exit(0);
}

console.error("[gate] the persona lost something:");
for (const failure of failures) {
  console.error(`  ✗ ${failure.what}`);
  console.error(`      ${failure.why}`);
}
console.error("");
console.error("[gate] A gate that cannot be trusted is worse than no gate.");
process.exit(1);
