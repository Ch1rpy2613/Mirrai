/**
 * Running the ruler.
 *
 * This is the loop that makes "does it still sound like them" a question
 * with an answer: hold out a line the person actually said, ask the
 * rebuilt persona to say it again, and score the two against each other.
 *
 * The persona is prompted through exactly the same path the chat uses —
 * `buildPromptForPersona` — because a measurement taken against a
 * different prompt would be measuring a different product.
 */
import type { Persona } from "../../drizzle/schema";
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import { buildPromptForPersona } from "../chat/prompt";
import type { LLMMessage } from "../llm/types";
import {
  aggregateScores,
  buildCharNgramModel,
  scoreCase,
  type EvalMetrics,
} from "./metrics";
import type { EvalCaseData } from "./dataset";

/**
 * Which version of the persona to measure.
 *
 * The A/B exists because a change can make the numbers better and the
 * persona worse. "withoutRules" turns the discriminative rules and the
 * per-state imperfection off, so the same persona can be measured both
 * ways — and if the rules do not move the numbers, they do not belong
 * in the prompt.
 */
export type EvalVariant = "default" | "withoutRules" | "withRulesOnly";

/**
 * What each variant turns on and off.
 *
 * "withRulesOnly" used to mean exactly the same thing as "default" —
 * the rules stayed on *and* the per-state imperfection stayed on — so
 * an arm called "rules only" measured a persona that still had the
 * imperfection. The day someone used it for the rules-on/rules-off
 * comparison, it would have measured nothing and looked like a result.
 */
function variantSwitches(variant: EvalVariant): {
  rules: "on" | "off";
  imperfection: "on" | "off";
} {
  if (variant === "withoutRules") return { rules: "off", imperfection: "off" };
  if (variant === "withRulesOnly") return { rules: "on", imperfection: "off" };
  return { rules: "on", imperfection: "on" };
}

export interface EvalRunOptions {
  persona: Persona;
  userId: number;
  cases: EvalCaseData[];
  /** The persona's other lines, for the n-gram model. Never the held-out ones. */
  trainingTexts: string[];
  locale?: "zh" | "en";
  variant?: EvalVariant;
  maxTokens?: number;
  temperature?: number;
  /** Called after each case, so a long run can show progress. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * The conversation, as the model sees it.
 *
 * The held-out line is not in it. The context is the real conversation,
 * in the real order, with the roles the real conversation had.
 */
function messagesForCase(
  systemPrompt: string,
  caseData: EvalCaseData,
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "system", content: systemPrompt }];
  for (const message of caseData.context) {
    messages.push({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    });
  }
  return messages;
}

/**
 * Runs the cases and scores them.
 *
 * A provider that fails on one case does not fail the run: the case is
 * skipped and the run reports how many it managed to score. A ruler
 * that stops at the first bad answer is not a ruler.
 */
export async function runEval(options: EvalRunOptions): Promise<EvalMetrics> {
  const locale = options.locale ?? "zh";
  const variant = options.variant ?? "default";
  const provider = await resolveProviderForUser({ userId: options.userId });
  if (!provider) {
    throw new Error("No LLM provider is configured for this user.");
  }

  const switches = variantSwitches(variant);
  const systemPrompt = await buildPromptForPersona({
    persona: options.persona,
    userId: options.userId,
    locale,
    microRules: switches.rules === "off" ? null : undefined,
    imperfectionProfile: switches.imperfection === "off" ? null : undefined,
    /**
     * The run is not a conversation.
     *
     * Looking at the prompt is a read, and a read does not make a
     * memory recalled — so the user's own pinned memories and anchors
     * kept losing half their weight every time an evaluation ran.
     */
    markRecalled: false,
  });

  const model = buildCharNgramModel(options.trainingTexts);
  const scores = [];

  for (let i = 0; i < options.cases.length; i++) {
    const caseData = options.cases[i];
    let generated = "";
    try {
      // A provider that answers with nothing is a provider that
      // misbehaved, not a reason to lose the whole run: the case is
      // skipped and the others are still scored.
      const answer = await llmService.invokeWithProvider(provider, {
        messages: messagesForCase(systemPrompt, caseData),
        options: {
          maxTokens: options.maxTokens ?? 200,
          temperature: options.temperature ?? 0.7,
        },
      });
      generated = typeof answer === "string" ? answer : "";
    } catch (error) {
      console.warn(
        `[Eval] Case ${caseData.expected.content.slice(0, 30)} failed: ${
          (error as Error).message
        }`,
      );
    }
    if (!generated.trim()) {
      options.onProgress?.(i + 1, options.cases.length);
      continue;
    }
    scores.push(
      scoreCase({
        caseId: i,
        expected: caseData.expected.content,
        generated,
        model,
        declaredState: caseData.expectedState ?? null,
        // The emotion is read in the language the words are in. Reading
        // an English line with the Chinese trigger table finds nothing,
        // and every number that depends on it is then quietly wrong.
        locale,
      }),
    );
    options.onProgress?.(i + 1, options.cases.length);
  }

  return aggregateScores(scores);
}
