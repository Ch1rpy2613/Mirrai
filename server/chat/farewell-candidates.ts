/**
 * The farewell letter, written in two passes.
 *
 * The letter used to be written in one prompt: the persona's voice, the
 * memories, "write a farewell letter". It came out as a love letter,
 * because that is what the persona's language habits were tuned for —
 * everyday conversation. A goodbye needs something else: the person's
 * voice *plus* a sentence they have never said. The thing they knew but
 * never said.
 *
 * Put both in one prompt and the two pull against each other: the model
 * retreats to the everyday register it knows, and the letter comes out
 * warm and general instead of final. So they are separated into two
 * passes.
 *
 *   1. Generate — hot, loose, five sentences this person would say but
 *      has never said. Nothing else is asked of them, so the model is
 *      free to be specific rather than safe.
 *   2. Subtract — the only new constraint is "this is the last time it
 *      gets said". The second pass may cut and rewrite; it may not add.
 *
 * The subtraction is checked, not trusted. A model asked to subtract will
 * sometimes answer with a longer, warmer letter than the one it was
 * given, and a farewell that invents new material is exactly the
 * love-letter failure this design exists to avoid.
 */
import type { Persona } from "../../drizzle/schema";
import { copy } from "@shared/copy";
import {
  retrieveMemories,
  formatMemoriesForPrompt,
  formatAnchorsForPrompt,
} from "./retrieval";
import { resolveProviderForUser } from "../llm/user-provider";
import { llmService } from "../llm";
import type { LLMMessage, LLMOptions } from "../llm/types";
import { renderImperfection, selectImperfection } from "@shared/imperfection";
import { renderMicroRules } from "@shared/micro-rules";
import * as db from "../db";

/** One sentence the persona might say but has never said. */
export interface FarewellCandidate {
  text: string;
  confidence: number;
}

/**
 * The letter after the second pass, and what it cost.
 *
 * `kept` and `removed` are kept because the point of the second pass is
 * visible: a person should be able to see which sentences survived the
 * last edit and which ones did not.
 */
export interface FarewellDraft {
  /** The letter itself. */
  letter: string;
  /** The lines that survived the second pass. */
  kept: string[];
  /** The lines the second pass cut. */
  removed: string[];
}

/** Why the letter was not written in two passes. */
export type FarewellFallbackReason =
  /** The two-pass path could not run at all. */
  | "two-pass-unavailable"
  /** The model failed, or answered with something unusable. */
  | "model-failed"
  /** The first pass produced no candidate worth keeping. */
  | "empty-candidates"
  /** The budget ran out before the two passes were done. */
  | "timeout";

/**
 * The budget for the whole two-pass path.
 *
 * Two model calls are twice the latency of one, and the letter is written
 * at the moment the user says goodbye — the one moment nobody is willing
 * to wait. So the path is bounded: when the budget runs out the two-pass
 * attempt is abandoned and the ordinary single-pass letter is written
 * instead, which is what the product did before this existed.
 */
export const FAREWELL_TWO_PASS_TIMEOUT_MS = 60_000;

/**
 * How hot the first pass runs.
 *
 * 1 is the ceiling that every provider configured here accepts: the
 * reasoning models reject any other value, and the chat path's default of
 * 0.7 is already a good deal lower. The first pass is the one place where
 * a repetitive, safe answer is worthless, so it is asked for heat.
 */
export const FAREWELL_CANDIDATE_TEMPERATURE = 1;

/**
 * The confidence a candidate carries when the model did not give one.
 *
 * The candidate prompt asks for the sentences alone — no labels, no
 * scores — so a model that follows it returns no confidence at all. A
 * flat default is honest here; a fabricated ranking would look like a
 * measurement and would not be one.
 */
const DEFAULT_CANDIDATE_CONFIDENCE = 0.5;

/** How much of a line has to trace back to the candidates to be allowed. */
const SUBTRACTION_COVERAGE_THRESHOLD = 0.5;

/** How alike two lines have to be for one to stand in for the other. */
const LINE_MATCH_THRESHOLD = 0.6;

/** The budget ran out. */
export class FarewellTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`The two-pass farewell took longer than ${timeoutMs}ms.`);
    this.name = "FarewellTimeoutError";
  }
}

/** The material the letter is written from. */
export interface FarewellContext {
  /** The facts that must hold, rendered for a prompt. */
  anchorSection: string;
  /** The retrieved memories, rendered for a prompt. */
  memorySection: string;
  /** The summary of older conversation, with its heading. */
  summarySection: string;
  /** How many memories were available. */
  memoryCount: number;
}

/**
 * Gathers what the letter is written from.
 *
 * Both passes are written from the same material, so it is assembled
 * once, here. The milestones are asked for by name: a farewell that only
 * mentions the persona's catchphrases is not a letter.
 */
export async function assembleFarewellContext(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  /** The reference time, so that a caller can ask for a fixed moment. */
  now?: Date;
}): Promise<FarewellContext> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";

  const milestones = await db
    .getMemoriesByPersonaId(persona.id, userId)
    .catch(() => []);
  const milestoneText = milestones
    .filter((m) => m.category === "milestone" || m.category === "anniversary")
    .map((m) => `${m.title} ${m.description ?? ""}`)
    .join(" ");
  const query = `${persona.name} ${milestoneText}`.trim();

  const memories = await retrieveMemories({
    personaId: persona.id,
    userId,
    userMessage: query,
    locale,
    now: params.now?.getTime(),
  }).catch(() => []);

  const summary = await db
    .getLatestChatSummary(persona.id, userId)
    .catch(() => null);
  const summaryText = summary?.summary ?? "";

  return {
    anchorSection: formatAnchorsForPrompt(memories, locale),
    memorySection: formatMemoriesForPrompt(memories, locale),
    summarySection: summaryText
      ? `${copy(locale, "prompt.summarySectionHeading")}\n${summaryText}`
      : "",
    memoryCount: memories.length,
  };
}

/**
 * A compact description of who this person is.
 *
 * The candidate prompt needs the persona's voice, not the whole system
 * prompt. The full prompt carries the conversation rules, the memory
 * sections and the state description, and a prompt that describes
 * everything describes nothing. What has to survive into this slot is the
 * way she talks — her personality, her rhythm, the words she reaches for,
 * and the way she is imperfect in the state she is in.
 */
export function describePersonaForCandidates(
  persona: Persona,
  locale: "zh" | "en" = "zh",
): string {
  const p = (persona as any).personaData ?? {};
  const sections: string[] = [persona.name];

  if (p.personality) {
    sections.push(
      `${copy(locale, "prompt.personalityHeading")}\n${p.personality}`,
    );
  }
  if (p.speakingStyle) {
    sections.push(
      `${copy(locale, "prompt.speakingStyleHeading")}\n${p.speakingStyle}`,
    );
  }
  sections.push(
    copy(locale, "prompt.catchphrases", {
      value:
        (p.catchphrases || []).join(locale === "en" ? ", " : "、") ||
        copy(locale, "prompt.noCatchphrases"),
    }),
  );
  sections.push(
    copy(locale, "prompt.nickname", {
      value: p.nickname || copy(locale, "prompt.noNickname"),
    }),
  );

  // The imperfection of the state she is in right now, and the rules she
  // discriminates by: the two things that make a sentence sound like her
  // rather than like a person in general.
  const imperfection = renderImperfection(
    selectImperfection(p.imperfectionProfile, persona.emotionalState),
    p.realismLevel ?? 70,
    locale,
  );
  if (imperfection) sections.push(imperfection);

  const rules = renderMicroRules(p.microRules ?? [], locale);
  if (rules) sections.push(rules);

  return sections.join("\n");
}

/**
 * The first pass: five sentences this person would say but has never said.
 *
 * The temperature is high on purpose. A candidate that could have been
 * said any day is not worth writing a farewell around, and a model that
 * is being careful produces those by the dozen.
 */
export async function buildFarewellCandidates(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  now?: Date;
  /** Cancels the request when the budget runs out. */
  signal?: AbortSignal;
}): Promise<FarewellCandidate[]> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";

  const context = await assembleFarewellContext({
    persona,
    userId,
    locale,
    now: params.now,
  });
  const memories = [
    context.anchorSection,
    context.memorySection,
    context.summarySection,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = copy(locale, "prompts.farewellCandidates", {
    persona: describePersonaForCandidates(persona, locale),
    memories,
  });
  const userPrompt = copy(locale, "prompts.farewellCandidatesUser");

  const raw = await invokeFarewellModel({
    userId,
    providerName: persona.llmProvider ?? undefined,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      temperature: FAREWELL_CANDIDATE_TEMPERATURE,
      maxTokens: 1024,
      signal: params.signal,
    },
  });

  return parseFarewellCandidates(raw);
}

/**
 * The second pass: subtraction.
 *
 * The candidates go in, a letter comes out, and the letter may only be
 * made of what the candidates already said. What survived and what was
 * cut is reported back, because a subtraction nobody can see is a
 * subtraction nobody can check.
 */
export async function editFarewellCandidates(params: {
  persona: Persona;
  userId: number;
  candidates: FarewellCandidate[];
  locale?: "zh" | "en";
  now?: Date;
  /** Cancels the request when the budget runs out. */
  signal?: AbortSignal;
}): Promise<FarewellDraft> {
  const { persona, userId, candidates } = params;
  const locale = params.locale ?? "zh";

  const systemPrompt = copy(locale, "prompts.farewellEdit", {
    candidates: JSON.stringify(
      candidates.map((c) => c.text),
      null,
      2,
    ),
  });
  const userPrompt = copy(locale, "prompts.farewellEditUser");

  const raw = await invokeFarewellModel({
    userId,
    providerName: persona.llmProvider ?? undefined,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      // No temperature is set here on purpose. The second pass is a cut,
      // not a creation, and the provider's own default is lower than the
      // heat the first pass needs. What actually keeps the pass from
      // adding is the check on the answer, not the dial.
      maxTokens: 2048,
      signal: params.signal,
    },
  });

  return parseFarewellEdit(raw, candidates);
}

/**
 * The letter, written in two passes.
 *
 * `degraded` means the two passes did not produce a letter: the first
 * pass found nothing, the second failed, or the budget ran out. The
 * letter is then the best the two passes managed — the candidates joined
 * together — and the caller is free to fall back to the ordinary
 * single-pass letter, which is what the product did before.
 */
export async function writeFarewellLetterInTwoPasses(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  now?: Date;
}): Promise<{
  letter: string;
  draft: FarewellDraft | null;
  degraded: boolean;
  /** Why it degraded, when it did. */
  reason?: FarewellFallbackReason;
}> {
  const locale = params.locale ?? "zh";
  let generated: FarewellCandidate[] = [];

  try {
    const outcome = await withinBudget(async (signal) => {
      generated = await buildFarewellCandidates({ ...params, locale, signal });
      if (!generated.length) return { draft: null as FarewellDraft | null };
      return {
        draft: await editFarewellCandidates({
          ...params,
          locale,
          candidates: generated,
          signal,
        }),
      };
    }, FAREWELL_TWO_PASS_TIMEOUT_MS);

    if (!generated.length) {
      // There was nothing to write the letter from. The single-pass
      // letter is still a letter.
      return {
        letter: "",
        draft: null,
        degraded: true,
        reason: "empty-candidates",
      };
    }
    if (!outcome.draft) {
      // The candidates exist and the second pass still could not deliver
      // a letter: the path as a whole is unavailable, not merely short.
      return {
        letter: joinCandidates(generated),
        draft: null,
        degraded: true,
        reason: "two-pass-unavailable",
      };
    }
    if (!outcome.draft.letter.trim()) {
      // The model answered, and the answer was empty.
      return {
        letter: joinCandidates(generated),
        draft: outcome.draft,
        degraded: true,
        reason: "model-failed",
      };
    }
    return {
      letter: outcome.draft.letter.trim(),
      draft: outcome.draft,
      degraded: false,
    };
  } catch (e) {
    const reason: FarewellFallbackReason =
      e instanceof FarewellTimeoutError ? "timeout" : "model-failed";
    console.warn(
      `[Graduation] The two-pass farewell could not be written (${reason}):`,
      (e as Error).message,
    );
    return {
      letter: joinCandidates(generated),
      draft: null,
      degraded: true,
      reason,
    };
  }
}

/**
 * Reads the first pass's answer.
 *
 * A model asked for five sentences will hand them over as a JSON array,
 * as a numbered list, or one per line, and which one it chooses is not
 * something the prompt can pin down. All three are read, because a
 * farewell that failed on formatting would be a silly way to lose one.
 */
export function parseFarewellCandidates(raw: string): FarewellCandidate[] {
  const text = stripCodeFence((raw ?? "").trim());
  if (!text) return [];

  const fromJson = parseCandidatesFromJson(text);
  if (fromJson.found && fromJson.candidates.length) {
    return dedupeCandidates(fromJson.candidates);
  }

  // The model tried to answer with JSON and the answer does not parse.
  // That is not a sentence, and reading the brackets as one would put
  // noise into the letter.
  //
  // But a list numbered in square brackets is not a JSON attempt — it is
  // the third shape of the same list, and the line reader below knows
  // how to strip "[1]" off the front of it. So the two are told apart
  // before either is given up on: a line that opens with a bracketed
  // number is a numbered list, and anything else that opens with a
  // bracket is a broken JSON.
  if (/^[[{]/.test(text) && !/^\s*[\[(（]\s*\d{1,3}\s*[\])）]/.test(text)) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const out: FarewellCandidate[] = [];
  for (const line of lines) {
    const cleaned = cleanCandidateText(line);
    if (cleaned && hasContent(cleaned)) {
      out.push({ text: cleaned, confidence: DEFAULT_CANDIDATE_CONFIDENCE });
    }
  }
  return dedupeCandidates(out);
}

/**
 * Reads the second pass's answer.
 *
 * The model is asked for JSON and usually gives it, but it wraps it in a
 * code fence or explains itself first often enough that the block has to
 * be dug out rather than assumed.
 */
export function parseFarewellEdit(
  raw: string,
  candidates: FarewellCandidate[],
): FarewellDraft {
  const candidateTexts = candidates.map((c) => c.text);

  const block = extractBalanced(raw ?? "", "{", "}");
  let parsed: any = null;
  if (block) {
    try {
      parsed = JSON.parse(block);
    } catch {
      parsed = null;
    }
  }

  // An answer that cannot be read cannot be cut. The candidates are then
  // the letter — which is the honest outcome: they were written for this
  // moment and nothing has been added to them.
  if (!parsed || typeof parsed !== "object") {
    return {
      letter: candidateTexts.join("\n"),
      kept: [...candidateTexts],
      removed: [],
    };
  }

  const letter = typeof parsed.letter === "string" ? parsed.letter.trim() : "";
  const kept = matchLinesToCandidates(
    normalizeLineList(parsed.kept),
    candidateTexts,
  );
  const removed = matchLinesToCandidates(
    normalizeLineList(parsed.removed),
    candidateTexts,
  ).filter((line) => !kept.includes(line));

  // The second pass may only subtract. A letter that carries material
  // the candidates never had is not a shorter letter, it is a different
  // letter — the love letter this whole design exists to avoid. So the
  // answer is not trusted: the kept lines are used instead.
  if (letter && !introducesNewContent(letter, candidateTexts)) {
    return { letter, kept, removed };
  }

  const fallback = kept.length ? kept : candidateTexts;
  return { letter: fallback.join("\n"), kept, removed };
}

/**
 * Whether the letter says something the candidates never said.
 *
 * The check is lexical rather than semantic, because there is no model
 * left to ask: the letter is compared against everything the candidates
 * contained, and a stretch of it that cannot be traced back to them is
 * treated as new material. The threshold is deliberately forgiving of
 * rewording — the second pass is allowed to rephrase — and strict about
 * whole sentences that came from nowhere.
 */
export function introducesNewContent(
  letter: string,
  candidates: string[],
): boolean {
  const segments = splitIntoSegments(letter);
  if (!segments.length) return false;

  const pool = buildCoveragePool(candidates);
  return segments.some((segment) => !isCoveredBy(segment, pool));
}

/**
 * Runs the work under a budget.
 *
 * The provider is asked to stop when the budget runs out, and the caller
 * is released either way: a request that never comes back must not be
 * able to hold the goodbye hostage.
 */
async function withinBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FarewellTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Writes with the user's own provider.
 *
 * The same plumbing the conversation uses: the provider the user
 * configured, invoked through the service so the retry policy stays in
 * one place. A letter written with the server's key would be a letter
 * the user did not pay for, from a key they never set.
 */
async function invokeFarewellModel(params: {
  userId: number;
  providerName?: string;
  messages: LLMMessage[];
  options?: LLMOptions;
}): Promise<string> {
  const provider = await resolveProviderForUser({
    userId: params.userId,
    providerName: params.providerName,
  });
  if (!provider) {
    throw new Error("No LLM provider is available for this user.");
  }
  const response = await llmService.invokeWithProvider(provider, {
    messages: params.messages,
    options: params.options,
  });
  return response ?? "";
}

function joinCandidates(candidates: FarewellCandidate[]): string {
  return candidates.map((c) => c.text).join("\n");
}

/**
 * Reads a candidate out of a JSON value.
 *
 * The array may hold plain strings or objects with the sentence and a
 * confidence; both are read, because the prompt asks for the sentences
 * alone and only some models add the rest.
 */
function toCandidate(value: unknown): FarewellCandidate | null {
  if (typeof value === "string") {
    const text = cleanCandidateText(value);
    return text ? { text, confidence: DEFAULT_CANDIDATE_CONFIDENCE } : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const raw = record.text ?? record.line ?? record.sentence ?? record.content;
    const text = cleanCandidateText(typeof raw === "string" ? raw : "");
    if (!text) return null;
    const confidence = Number(record.confidence);
    return {
      text,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : DEFAULT_CANDIDATE_CONFIDENCE,
    };
  }
  return null;
}

function parseCandidatesFromJson(text: string): {
  found: boolean;
  candidates: FarewellCandidate[];
} {
  const arrayText = extractBalanced(text, "[", "]");
  if (arrayText) {
    try {
      const parsed = JSON.parse(arrayText);
      if (Array.isArray(parsed)) {
        return {
          found: true,
          candidates: parsed
            .map(toCandidate)
            .filter((c): c is FarewellCandidate => !!c),
        };
      }
    } catch {
      // Not JSON after all — the other shapes are tried.
    }
  }

  const objectText = extractBalanced(text, "{", "}");
  if (objectText) {
    try {
      const parsed = JSON.parse(objectText);
      const list = parsed?.candidates ?? parsed?.lines ?? parsed?.items;
      if (Array.isArray(list)) {
        return {
          found: true,
          candidates: list
            .map(toCandidate)
            .filter((c): c is FarewellCandidate => !!c),
        };
      }
    } catch {
      // Not JSON after all.
    }
  }

  return { found: false, candidates: [] };
}

/**
 * Removes the code fence a model wrapped its answer in.
 *
 * The fence is packaging, and a line of it is not something anybody
 * said.
 */
function stripCodeFence(text: string): string {
  return text.replace(/^```[^\n]*$/gm, "").trim();
}

/** Whether a line carries anything that could be said. */
function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Removes the packaging around a candidate.
 *
 * Numbering, quotes and stray punctuation are the model's formatting,
 * not the sentence. The sentence's own ending is kept: a half-finished
 * line and a full stop are different voices, and a farewell is made of
 * exactly that difference.
 */
export function cleanCandidateText(raw: string): string {
  let text = (raw ?? "").trim();
  // The numbering comes off in every shape it arrives in — "1.", "(1)",
  // "1）", and "[1]". The square bracket was missing, which meant a list
  // numbered that way kept its numbers on the front of every sentence.
  text = text.replace(
    /^\s*(?:\d{1,3}\s*[.、,，)）:：]|[\[(（]\s*\d{1,3}\s*[\])）]|[-*•·—]\s*)/u,
    "",
  );
  text = text.replace(/^[\s"'“”‘’「『]+/u, "");
  text = text.replace(/[\s"'“”‘’「」『』`*_~，,、；;：:]+$/u, "");
  return stripUnbalancedClosers(text).trim();
}

/** Removes a closing bracket that was never opened. */
function stripUnbalancedClosers(text: string): string {
  const pairs: Array<[string, string]> = [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"],
    ["《", "》"],
    ["〈", "〉"],
  ];
  let out = text;
  let changed = true;
  while (changed && out.length) {
    changed = false;
    for (const [open, close] of pairs) {
      if (!out.endsWith(close)) continue;
      const opens = countChar(out, open);
      const closes = countChar(out, close);
      if (closes > opens) {
        out = out.slice(0, -1).trimEnd();
        changed = true;
      }
    }
  }
  return out;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const ch of text) if (ch === char) count++;
  return count;
}

/** Drops the candidates that say the same thing. */
function dedupeCandidates(
  candidates: FarewellCandidate[],
): FarewellCandidate[] {
  const seen = new Set<string>();
  const out: FarewellCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.text.replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    // Two candidates that are nearly the same sentence are one candidate
    // written twice. Five of the same sentence is not five sentences,
    // and a letter made of them is a letter with nothing in it — so a
    // rewrite of a line already kept is dropped.
    if (out.some((kept) => similarity(kept.text, candidate.text) >= 0.8)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * Extracts the first balanced block of the given delimiters.
 *
 * The scan skips over string literals, so a brace inside a quoted
 * sentence does not end the block early.
 */
export function extractBalanced(
  text: string,
  open: string,
  close: string,
): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Reads a list of lines out of the model's answer. */
function normalizeLineList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = cleanCandidateText(item);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/**
 * Keeps only the lines that stand for one of the candidates.
 *
 * A "kept" line that matches nothing is new material wearing a
 * candidate's clothes, and it is dropped rather than reported.
 */
function matchLinesToCandidates(
  lines: string[],
  candidates: string[],
): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const match = findMatchingCandidate(line, candidates);
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

/** The candidate a line stands for, if there is one. */
function findMatchingCandidate(
  line: string,
  candidates: string[],
): string | null {
  const normalized = line.replace(/\s+/g, "");
  for (const candidate of candidates) {
    if (candidate.replace(/\s+/g, "") === normalized) return candidate;
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarity(line, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= LINE_MATCH_THRESHOLD ? best : null;
}

/**
 * Splits a letter into the stretches that are checked one by one.
 *
 * Newlines and sentence endings, but not commas: a sentence is what a
 * reader takes in at once, and it is what a model adds when it goes back
 * to being warm.
 */
function splitIntoSegments(text: string): string[] {
  return (text ?? "")
    .split(/[\r\n。！？!?；;]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Everything the candidates contained, as a set of units and pairs. */
interface CoveragePool {
  units: Set<string>;
  bigrams: Set<string>;
}

function buildCoveragePool(candidates: string[]): CoveragePool {
  const units = new Set<string>();
  const bigrams = new Set<string>();
  for (const candidate of candidates) {
    const candidateUnits = contentUnits(candidate);
    for (const unit of candidateUnits) units.add(unit);
    for (const bigram of bigramsOf(candidateUnits)) bigrams.add(bigram);
  }
  return { units, bigrams };
}

/**
 * Whether a stretch of the letter can be traced back to the candidates.
 *
 * The measure is how much of the stretch the candidates already
 * contained, in pairs of characters or words: a rewording keeps most of
 * them, a sentence from nowhere keeps almost none.
 */
function isCoveredBy(segment: string, pool: CoveragePool): boolean {
  const units = contentUnits(segment);
  if (!units.length) return true;

  const bigrams = bigramsOf(units);
  if (bigrams.length) {
    let covered = 0;
    for (const bigram of bigrams) if (pool.bigrams.has(bigram)) covered++;
    return covered / bigrams.length >= SUBTRACTION_COVERAGE_THRESHOLD;
  }

  let covered = 0;
  for (const unit of units) if (pool.units.has(unit)) covered++;
  return covered / units.length >= SUBTRACTION_COVERAGE_THRESHOLD;
}

/**
 * The content of a line: one unit per Chinese character, one per word
 * for everything else.
 *
 * Punctuation is dropped. It is the packaging of a sentence, not its
 * content, and a letter that only differs in punctuation has not said
 * anything new.
 */
function contentUnits(text: string): string[] {
  const tokens =
    (text ?? "").match(
      /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+/gu,
    ) ?? [];
  const units: string[] = [];
  for (const token of tokens) {
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(token)) {
      for (const char of token) units.push(char);
    } else {
      units.push(token.toLowerCase());
    }
  }
  return units;
}

function bigramsOf(units: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < units.length; i++)
    out.push(`${units[i]}\u0000${units[i + 1]}`);
  return out;
}

/**
 * How alike two lines are, from 0 to 1.
 *
 * Used to decide whether a line the model reported as "kept" is really
 * one of the candidates.
 */
function similarity(a: string, b: string): number {
  const left = bigramsOf(contentUnits(a));
  const right = bigramsOf(contentUnits(b));
  if (!left.length || !right.length) return a === b ? 1 : 0;

  const rightSet = new Set(right);
  let shared = 0;
  for (const bigram of left) if (rightSet.has(bigram)) shared++;
  return (2 * shared) / (left.length + right.length);
}
