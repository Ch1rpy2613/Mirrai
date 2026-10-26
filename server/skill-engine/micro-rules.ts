/**
 * Mining the discriminative rules from real records.
 *
 * The sharpest thing anyone knows about another person is a difference:
 * "她生气的时候会说『随便你』，只说『随便』没有『你』，那就是真的生气了。"
 * Written into a speaking-style paragraph, that becomes "she gets cold when
 * she is angry" — the distinction is gone, because prose is read as meaning
 * and meaning is exactly what gets lost.
 *
 * So the mining works in two steps. First the records are read for the
 * *smallest contrasts*: two messages from the same speaker, short enough for
 * a judgement to fit into, differing by a few characters ("随便" / "随便你",
 * "嗯" / "嗯嗯", "我走了" / "我先走了"). Then those contrasts are handed to a
 * model, which is asked what the difference means and what the person
 * actually does about it.
 *
 * The second step is where the danger lives. A model asked to find patterns
 * in a handful of sentences will happily invent one, and an invented rule
 * in a hard constraint is worse than no rule at all — the persona would
 * behave according to something that never happened. So every candidate has
 * to survive two checks before it is kept: it must quote the record it was
 * read off, and the trigger it fires on must actually appear in that quote.
 * A rule that fails either check is dropped, not softened.
 */
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import { extractJsonArray, extractJsonObject } from "../_core/json";
import {
  matchesMicroRule,
  normalizeMicroRules,
  type MicroRule,
  type MicroRuleEvidence,
} from "@shared/micro-rules";
import { copy, type Locale } from "@shared/copy";
import type { DistillationMode } from "@shared/distillation-modes";

/** A message the miner may read. */
export interface ContrastPairInput {
  /** What was said. */
  content: string;
  /** When it was said, if the record carried a time. */
  timestamp?: Date | string | null;
  /** Who said it. Two messages can only be contrasted within one role. */
  role?: string;
}

/** Two messages that differ in a very small way. */
export interface ContrastPair {
  /** The two messages that differ in a very small way. */
  a: string;
  b: string;
  /** When they happened, if the record had a timestamp. */
  at?: string;
}

/** How the miner may behave. */
export interface FindContrastPairsOptions {
  /** The longest message that may take part, in characters. */
  maxChars?: number;
  /** The most characters two messages may differ by. */
  maxDifference?: number;
  /** The most a difference may be relative to the longer message. */
  maxRatio?: number;
  /** How many pairs are returned at most. */
  limit?: number;
  /** How many pairs one message may take part in. */
  maxPairsPerMessage?: number;
  /** Only messages from this role are read. */
  role?: string;
}

/** What the miner needs in order to ask the model. */
export interface MineMicroRulesParams {
  /** The contrasts the model is asked to read. */
  pairs?: ContrastPair[];
  /** The records, when the pairs have not been found yet. */
  messages?: ContrastPairInput[];
  /** The user whose provider is used. */
  userId: number;
  /** The provider to prefer; the user's own configuration wins over it. */
  providerName?: string;
  /** The language the prompts are written in. */
  locale?: Locale;
  /** The temperature the extraction runs at. */
  temperature?: number;
  /** Called while the mining goes, so the interface can say what is happening. */
  onProgress?: (message: string) => void;
}

/**
 * How many contrast pairs each preset may look at.
 *
 * The presets are a promise about how much of the material a run reads, and
 * the mining reads the same records the analysis does: the quick preset
 * looks at a sample, the deep one looks at the whole history. More history
 * means more contrasts, so the deep preset mines more pairs than the quick
 * one.
 */
export const MICRO_RULE_PAIR_BUDGET: Record<DistillationMode, number> = {
  fast: 8,
  standard: 12,
  deep: 24,
  colleague: 12,
  celebrity: 24,
};

/**
 * The characters that carry no judgement.
 *
 * Punctuation and spacing are how two messages are formatted, not what they
 * say: two messages that differ only in a full stop are the same sentence,
 * and counting them as a contrast would fill the miner's hands with pairs
 * that say nothing.
 */
function stripNoise(text: string): string {
  return text.replace(/[\p{P}\s]+/gu, "");
}

/** The number of single-character edits that turn one string into another. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

/** The moment a message was sent, as the record wrote it. */
function toTimestamp(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const text = String(value).trim();
  return text || undefined;
}

/**
 * Finds the smallest contrasts in a set of messages.
 *
 * The pairs that matter are the ones where two messages from the same
 * speaker differ by a word or two: that is where the person's own
 * judgement shows, because everything else about the two messages is the
 * same. Longer messages are left out — a judgement needs a short
 * sentence, and a paragraph is read as a story rather than as a
 * distinction.
 *
 * The sharpest pairs come first, and no message may take part in more than
 * a few of them: one recurring sentence would otherwise fill the whole
 * batch and the miner would never see the rest of the person.
 */
/**
 * How many candidates each speaker contributes.
 *
 * The search compares every pair of them, so this is the square root of
 * the work.
 */
const MAX_CANDIDATES_PER_ROLE = 400;

/**
 * Keeps the most recent candidates of each speaker.
 */
function capPerRole<T extends { index: number; role: string }>(
  candidates: T[],
  cap: number,
): T[] {
  const perRole = new Map<string, T[]>();
  for (const candidate of candidates) {
    const list = perRole.get(candidate.role) ?? [];
    list.push(candidate);
    perRole.set(candidate.role, list);
  }
  const kept: T[] = [];
  for (const list of perRole.values()) {
    if (list.length <= cap) {
      kept.push(...list);
      continue;
    }
    // The most recent ones: the last ones in the transcript.
    kept.push(...list.slice(list.length - cap));
  }
  return kept.sort((a, b) => a.index - b.index);
}

export function findContrastPairs(
  messages: ContrastPairInput[],
  options: FindContrastPairsOptions = {},
): ContrastPair[] {
  const maxChars = options.maxChars ?? 60;
  const maxDifference = options.maxDifference ?? 6;
  const maxRatio = options.maxRatio ?? 0.5;
  const limit = options.limit ?? 24;
  const maxPairsPerMessage = options.maxPairsPerMessage ?? 2;

  const all = messages
    .map((message, index) => ({
      index,
      role: (message.role ?? "").trim().toLowerCase(),
      content: (message.content ?? "").trim(),
      normalised: stripNoise(message.content ?? ""),
      at: toTimestamp(message.timestamp),
    }))
    .filter((candidate) => candidate.content.length > 0)
    .filter((candidate) => candidate.content.length <= maxChars)
    .filter((candidate) => candidate.normalised.length > 0)
    .filter((candidate) =>
      options.role === undefined ? true : candidate.role === options.role.trim().toLowerCase(),
    );

  /**
   * The candidates, capped per speaker.
   *
   * Every pair of candidates is compared, and each comparison costs an
   * edit distance. A chat log of short messages — "嗯", "好", "在吗" —
   * gives thousands of them, and the quadratic loop over those is
   * billions of comparisons: the mining never finished.
   *
   * The most recent ones are kept: a rule is read off the conversation
   * as it is now.
   */
  const candidates = capPerRole(all, MAX_CANDIDATES_PER_ROLE);

  const scored: Array<{
    pair: ContrastPair;
    distance: number;
    ratio: number;
    aIndex: number;
    bIndex: number;
  }> = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      // Two messages can only be contrasted within one speaker: the
      // difference between what she said and what he said is not a
      // distinction, it is a conversation.
      if (a.role !== b.role) continue;

      // The difference in length is a lower bound on the distance, so
      // a pair that is too different in length is skipped without the
      // edit distance being computed at all.
      if (Math.abs(a.normalised.length - b.normalised.length) > maxDifference) continue;

      const distance = editDistance(a.normalised, b.normalised);
      // Identical messages are not a contrast — there is no difference to
      // read a rule off.
      if (distance === 0) continue;
      if (distance > maxDifference) continue;

      const longest = Math.max(a.normalised.length, b.normalised.length);
      const ratio = distance / longest;
      // A difference that is large relative to the message is not a small
      // one; it is a different sentence.
      if (ratio > maxRatio) continue;

      scored.push({
        pair: { a: a.content, b: b.content, ...(a.at || b.at ? { at: a.at ?? b.at } : {}) },
        distance,
        ratio,
        aIndex: i,
        bIndex: j,
      });
    }
  }

  // The sharpest distinctions first: one character of difference is a
  // sharper rule than four.
  scored.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.ratio - right.ratio ||
      left.aIndex - right.aIndex,
  );

  const usage = new Map<number, number>();
  const chosen: ContrastPair[] = [];
  for (const candidate of scored) {
    if (chosen.length >= limit) break;
    const aCount = usage.get(candidate.aIndex) ?? 0;
    const bCount = usage.get(candidate.bIndex) ?? 0;
    if (aCount >= maxPairsPerMessage || bCount >= maxPairsPerMessage) continue;
    usage.set(candidate.aIndex, aCount + 1);
    usage.set(candidate.bIndex, bCount + 1);
    chosen.push(candidate.pair);
  }
  return chosen;
}

/**
 * The labels a transcript uses for the user's own side.
 *
 * i18n:allow-input — these are the labels a pasted transcript actually
 * uses, so they are matched against the input rather than shown to anyone.
 */
const SELF_LABELS = new Set(["我", "我方", "自己", "me", "mine", "user", "用户"]);

/**
 * The labels a transcript uses for the other side.
 *
 * i18n:allow-input — matched against what was pasted in.
 */
const PERSONA_LABELS = new Set([
  "ta",
  "分身",
  "persona",
  "assistant",
  "ai",
  "机器人",
  "对方",
  "她",
  "他",
]);

/** A speaker label in front of a message. */
const SPEAKER = /^([^\s:：/\\]{1,20})\s*[:：]\s*(.*)$/;

/**
 * The role a speaker label belongs to.
 *
 * The records name the two sides however the export did it: the app's own
 * transcripts write "我" and "TA", a chat export writes the two people's
 * names. The label itself is kept as the role, because two messages can
 * only be contrasted within one side — and the persona's own name is the
 * one label that is known for sure.
 */
function roleFor(speaker: string, personaName?: string): string {
  const key = speaker.trim().toLowerCase();
  if (!key) return "";
  const wanted = (personaName ?? "").trim().toLowerCase();
  if (wanted && key === wanted) return "persona";
  if (SELF_LABELS.has(key)) return "user";
  if (PERSONA_LABELS.has(key)) return "persona";
  return key;
}

/** Splits a leading timestamp off a line. */
function splitTimestamp(line: string): { at?: string; rest: string } {
  const bracket = line.match(/^\[([^\]]{4,32})\]\s*/);
  if (bracket && /\d/.test(bracket[1])) {
    return { at: bracket[1], rest: line.slice(bracket[0].length) };
  }
  const date = line.match(
    /^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+/,
  );
  if (date) return { at: date[1], rest: line.slice(date[0].length) };
  const clock = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/);
  if (clock) return { at: clock[1], rest: line.slice(clock[0].length) };
  return { rest: line };
}

/** Whether a line names its speaker. */
function hasSpeaker(line: string): boolean {
  const { rest } = splitTimestamp(line);
  const match = rest.match(SPEAKER);
  return !!match && !match[2].startsWith("//");
}

/**
 * Reads a transcript into messages.
 *
 * The material arrives as text — an uploaded chat log or a collected
 * transcript — and both are one message per line with the speaker in
 * front. The speaker is what says who said what, and it is kept as the
 * role, so that the miner can tell her words from his.
 *
 * A transcript that names no speakers at all is read as a list of
 * messages; a line that follows a message without a speaker of its own is
 * read as a continuation of it, which is how a wrapped sentence arrives.
 */
export function parseTranscriptMessages(
  text: string,
  options: { personaName?: string } = {},
): ContrastPairInput[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  if (!lines.some((line) => hasSpeaker(line))) {
    // Nobody is named, so every line is a message of the same unnamed side.
    return lines.map((line) => ({ content: line, role: "", timestamp: null }));
  }

  const messages: ContrastPairInput[] = [];
  for (const line of lines) {
    const { at, rest } = splitTimestamp(line);
    const match = rest.match(SPEAKER);
    if (!match || match[2].startsWith("//")) {
      const last = messages[messages.length - 1];
      if (last) {
        // A line without a speaker continues the message above it, which is
        // how a wrapped sentence arrives.
        last.content = `${last.content} ${rest}`.trim();
      } else {
        messages.push({ content: rest, role: "", timestamp: at ?? null });
      }
      continue;
    }
    const content = match[2].trim();
    if (!content) continue;
    messages.push({
      content,
      role: roleFor(match[1], options.personaName),
      timestamp: at ?? null,
    });
  }
  return messages;
}

/** Coerces whatever the model wrote into a list of trigger tokens. */
function toTriggerList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[、,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** Coerces whatever the model wrote into the evidence of a rule. */
function toEvidence(value: unknown): MicroRuleEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: MicroRuleEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = typeof record.snippet === "string" ? record.snippet.trim() : "";
    if (!snippet) continue;
    const at = typeof record.at === "string" ? record.at.trim() : "";
    evidence.push(at ? { at, snippet } : { snippet });
  }
  return evidence;
}

/**
 * The confidence of a mined rule.
 *
 * The model is not asked for one — the mining prompt asks for the trigger,
 * the meaning, the rendering and the evidence, and a number the model
 * invents about its own certainty is worth little. So every candidate
 * starts at the same moderate confidence and the user decides, by
 * confirming it, how sure they are.
 */
const DEFAULT_CONFIDENCE = 0.6;

function toConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(number)) return DEFAULT_CONFIDENCE;
  return Math.max(0, Math.min(1, number));
}

/**
 * The moment a quoted snippet happened, when the pair it came from had one.
 *
 * The model is asked to quote the record, and it usually leaves the time
 * out — but the pair it quoted is right there, so the time is taken from
 * there instead of being asked for twice.
 */
function timeForSnippet(snippet: string, pairs: ContrastPair[]): string | undefined {
  const needle = stripNoise(snippet);
  if (!needle) return undefined;
  for (const pair of pairs) {
    if (!pair.at) continue;
    if (stripNoise(pair.a).includes(needle) || stripNoise(pair.b).includes(needle)) {
      return pair.at;
    }
  }
  return undefined;
}

/** The rules the model wrote, whichever shape it wrote them in. */
function parseRules(raw: string): Array<Record<string, unknown>> {
  const object = extractJsonObject(raw);
  if (object && Array.isArray(object.rules)) {
    return object.rules.filter(
      (rule): rule is Record<string, unknown> => !!rule && typeof rule === "object",
    );
  }
  const array = extractJsonArray(raw);
  if (array) {
    return array.filter(
      (rule): rule is Record<string, unknown> => !!rule && typeof rule === "object",
    );
  }
  return [];
}

/**
 * Turns the contrasts into candidate rules.
 *
 * The model is asked what each contrast means and what the person does
 * about it, and it answers with JSON — which it may wrap in a code fence
 * or bury in prose, so the first balanced object is taken out of the
 * answer rather than the whole thing being parsed.
 *
 * Two rules are dropped, and they are the important ones:
 *
 *   - a rule without evidence. A rule the model cannot source is a rule it
 *     hallucinated, and a hallucinated rule in a hard constraint is worse
 *     than no rule at all — it would make the persona behave according to
 *     something that never happened;
 *   - a rule whose trigger does not appear in the evidence it quotes. The
 *     trigger is what the persona will fire on, so a trigger that is not
 *     in the record is a trigger the model made up, however good its
 *     meaning sounds.
 *
 * What is left is a *candidate*: it is marked as mined and not confirmed,
 * and it only takes effect once the user has looked at it.
 */
export async function mineMicroRules(params: MineMicroRulesParams): Promise<MicroRule[]> {
  const locale = params.locale ?? "zh";
  const pairs = params.pairs ?? findContrastPairs(params.messages ?? []);
  if (!pairs.length) return [];

  let answer: string;
  try {
    const provider = await resolveProviderForUser({
      userId: params.userId,
      providerName: params.providerName,
    });
    if (!provider) {
      console.warn("[MicroRules] No provider is available; no rules were mined.");
      return [];
    }

    params.onProgress?.(copy(locale, "labels.microRules.mining"));

    answer = await llmService.invokeWithProvider(provider, {
      messages: [
        { role: "system", content: copy(locale, "prompts.microRuleMining") },
        {
          role: "user",
          content: copy(locale, "prompts.microRuleMiningUser", {
            pairs: JSON.stringify(pairs, null, 2),
          }),
        },
      ],
      options: { temperature: params.temperature ?? 0.3, maxTokens: 2000 },
    });
  } catch (error) {
    // The mining is a bonus: the persona is already written by the time it
    // runs, so a provider that is down costs the rules and nothing else.
    console.warn("[MicroRules] The model could not be reached; no rules were mined:", error);
    return [];
  }

  try {
    const candidates = parseRules(answer ?? "");
    const accepted: MicroRule[] = [];

    for (const candidate of candidates) {
      const trigger = toTriggerList(candidate.trigger);
      const meaning = typeof candidate.meaning === "string" ? candidate.meaning.trim() : "";
      const rendering =
        typeof candidate.rendering === "string" ? candidate.rendering.trim() : "";
      if (!trigger.length || !meaning || !rendering) continue;

      const evidence = toEvidence(candidate.evidence);
      // A rule the model cannot source is a rule it hallucinated.
      if (!evidence.length) continue;

      const rule: MicroRule = {
        id: `auto-${accepted.length + 1}`,
        trigger,
        meaning,
        rendering,
        confidence: toConfidence(candidate.confidence),
        source: "auto",
        verified: false,
        evidence: evidence.map((entry) =>
          entry.at ? entry : { ...entry, at: timeForSnippet(entry.snippet, pairs) },
        ),
      };

      // The trigger has to be in the evidence the rule quotes. This is the
      // single check that separates a rule that was read off the record
      // from a rule the model made up, so it is checked with the same
      // matcher the rest of the app uses.
      const grounded = rule.evidence.some((entry) => matchesMicroRule(rule, entry.snippet));
      if (!grounded) continue;

      accepted.push(rule);
    }

    return normalizeMicroRules(accepted);
  } catch (error) {
    // A malformed answer is not a crash: the caller simply gets no rules.
    console.warn("[MicroRules] The answer could not be read; no rules were mined:", error);
    return [];
  }
}
