/**
 * Memory retrieval.
 *
 * Until now the `memories` table was write-only: `memory.autoExtract` filled it
 * and nothing ever read it back into a conversation. This module decides which
 * memories are worth putting in front of the model.
 *
 * The scoring is deliberately dependency-free — no vector database, no extra
 * service — so it works in the packaged desktop builds. Chinese text is
 * matched with character bigrams, which needs no word segmenter.
 */
import * as db from "../db";
import { copy } from "@shared/copy";

export interface MemoryCandidate {
  id: number;
  title: string;
  description: string | null;
  category: string;
  date: string | null;
  isPinned: boolean;
  importance: number;
  lastRecalledAt: Date | null;
  /** Whose memory this is: "them" or "me". */
  subject: string;
  createdAt: Date;
}

export interface ScoredMemory extends MemoryCandidate {
  score: number;
}

export interface RetrievalOptions {
  /** How many ordinary (non-anchor) memories to inject. */
  topK?: number;
  /** Inject a memory whose text does not appear in the user's message. */
  minKeywordScore?: number;
  now?: number;
}

const DEFAULT_TOP_K = 5;

/**
 * How many memories a turn may bring back.
 *
 * The setting is a number the user typed, and the settings accept any
 * shape.
 */
export const MAX_TOP_K = 50;

function clampTopK(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TOP_K;
  return Math.min(MAX_TOP_K, Math.max(1, Math.round(n)));
}
const DEFAULT_MIN_KEYWORD_SCORE = 0.05;

/**
 * How many file summaries may be injected.
 *
 * The summary of an uploaded chat log is long and rarely the answer, so it
 * gets a smaller budget than the memories the user curated.
 */
const FILE_SUMMARY_TOP_K = 2;

/**
 * How many anchors go into the prompt.
 *
 * They are the facts that must hold, so they are the last thing to be
 * cut — but not all of them: with fifty anchors the whole block was in
 * the system prompt on every turn, and nothing trimmed it.
 */
const MAX_ANCHORS = 10;

/** How much of a file summary is worth putting in front of the model. */
const FILE_SUMMARY_MAX_LENGTH = 400;

/** Category weights — an anchor or a milestone matters more than a passing note. */
const CATEGORY_WEIGHTS: Record<string, number> = {
  milestone: 1.0,
  anchor: 1.0,
  anniversary: 0.8,
  memory: 0.5,
};

const RECALL_DAMPING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECALL_DAMPING_FACTOR = 0.5;

/**
 * Splits text into comparable tokens.
 *
 * Latin runs become words; CJK runs become character bigrams (a single
 * character is also kept, so one-word queries still match).
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;

  const lower = text.toLowerCase();
  // Latin words and numbers.
  for (const match of Array.from(lower.matchAll(/[a-z0-9]+/g))) {
    if (match[0].length >= 2) tokens.add(match[0]);
  }
  // CJK bigrams.
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * Keyword coverage of a memory against the user's message, from 0 to 1.
 *
 * Coverage is measured against the *message's* tokens, so a long
 * message does not make an unrelated memory look relevant.
 *
 * It used to be measured against the *memory's* tokens — which is the
 * opposite of what the sentence above says, and it made two things
 * wrong at once. A long memory was essentially never retrieved: a
 * four-hundred-character description had to share twenty words with
 * the message to clear the floor, while a short title needed one. And
 * a weak match was never damped: one shared word in a ten-word memory
 * scored a tenth however long the message was.
 */
export function keywordCoverage(memoryText: string, messageTokens: Set<string>): number {
  if (messageTokens.size === 0) return 0;
  const memoryTokens = tokenize(memoryText);
  if (memoryTokens.size === 0) return 0;

  let hits = 0;
  for (const token of Array.from(memoryTokens)) {
    if (messageTokens.has(token)) hits++;
  }
  return hits / messageTokens.size;
}

/** Recency weight — a memory fades over roughly a month. */
export function recencyWeight(createdAt: Date, now: number): number {
  const ageDays = Math.max(0, (now - new Date(createdAt).getTime()) / 86_400_000);
  return 1 / (1 + ageDays / 30);
}

/**
 * Scores a single memory.
 *
 * Weights follow the plan: 45% keyword match, 25% recency, 20% category,
 * 10% manual pin. A memory that was already surfaced in the last day is
 * damped so the same line does not come back every turn.
 */
export function scoreMemory(
  memory: MemoryCandidate,
  messageTokens: Set<string>,
  now: number,
): number {
  const text = [memory.title, memory.description, memory.date].filter(Boolean).join(" ");
  const coverage = keywordCoverage(text, messageTokens);
  const recency = recencyWeight(memory.createdAt, now);
  const category = CATEGORY_WEIGHTS[memory.category] ?? 0.5;
  const pin = memory.isPinned ? 1 : 0;

  let score = 0.45 * coverage + 0.25 * recency + 0.2 * category + 0.1 * pin;

  if (memory.lastRecalledAt) {
    const sinceRecall = now - new Date(memory.lastRecalledAt).getTime();
    if (sinceRecall < RECALL_DAMPING_WINDOW_MS) {
      score *= RECALL_DAMPING_FACTOR;
    }
  }

  return score;
}

export interface RetrievalResult {
  /** Memories to inject, anchors first. */
  selected: ScoredMemory[];
  /** Anchor memories, which are always injected. */
  anchors: ScoredMemory[];
}

/**
 * Picks the memories to inject for a message.
 */
export function selectMemories(
  candidates: MemoryCandidate[],
  userMessage: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  /**
   * How many memories come back.
   *
   * It came straight from the user's settings — so a value that is not
   * a number gave `Math.max(0, NaN)`, and `slice(0, NaN)` is an empty
   * slice: the ordinary memories were silently never retrieved. And an
   * enormous value removed the limit altogether.
   *
   * The other settings are clamped on the way in; this one was not.
   */
  const topK = clampTopK(options.topK);
  const minKeywordScore = options.minKeywordScore ?? DEFAULT_MIN_KEYWORD_SCORE;
  const now = options.now ?? Date.now();
  const messageTokens = tokenize(userMessage);

  const scored = candidates.map((memory) => ({
    ...memory,
    score: scoreMemory(memory, messageTokens, now),
  }));

  /**
   * The pinned memories are kept whatever their score.
   *
   * A pin was worth a tenth of the score — so an anchor that matched
   * the message well could push out the very fact the user had pinned,
   * and the persona stopped using it. The user pinned it; it is theirs.
   */
  const pinned = scored.filter((m) => m.isPinned);
  const pinnedIds = new Set(pinned.map((m) => m.id));
  const rest = scored.filter((m) => !pinnedIds.has(m.id));

  /**
   * The anchors, and only the best of them.
   *
   * Every anchor used to be returned and rendered, however many there
   * were: fifty of them put the whole block into the system prompt on
   * every single turn, with nothing to trim it. They are the facts that
   * must hold, so they are the last thing to be cut — but not all
   * fifty.
   */
  const pinnedAnchors = pinned.filter((m) => m.category === "anchor");
  const otherAnchors = rest
    .filter((m) => m.category === "anchor")
    .sort((a, b) => b.score - a.score);
  const anchors = [
    ...pinnedAnchors,
    ...otherAnchors.slice(0, Math.max(0, MAX_ANCHORS - pinnedAnchors.length)),
  ];

  const pinnedOrdinary = pinned.filter((m) => m.category !== "anchor");
  const otherOrdinary = rest
    .filter((m) => m.category !== "anchor")
    .filter((m) => keywordCoverage(
      [m.title, m.description, m.date].filter(Boolean).join(" "),
      messageTokens,
    ) >= minKeywordScore)
    .sort((a, b) => b.score - a.score);
  const ordinary = [
    ...pinnedOrdinary,
    ...otherOrdinary.slice(0, Math.max(0, topK - pinnedOrdinary.length)),
  ];

  return { selected: [...anchors, ...ordinary], anchors };
}

/**
 * The punctuation between a memory's title and its description.
 *
 * The two languages punctuate it differently, so it cannot be a constant.
 * It is not a copy entry either: the copy table's Chinese half has to
 * carry Chinese characters, and a lone full-width colon has none — so the
 * one piece of punctuation that has no words in it stays here, where it is
 * one character wide.
 */
function descriptionSeparator(locale: "zh" | "en"): string {
  return locale === "en" ? ": " : "：";
}

/**
 * Renders retrieved memories as a prompt section.
 *
 * The section is read by the model, so the headings and the markers that
 * say which memory is which are in the language the persona is speaking.
 */
export function formatMemoriesForPrompt(
  memories: ScoredMemory[],
  locale: "zh" | "en" = "zh",
): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => {
    const date = m.date ? `${m.date} ` : "";
    const description = m.description
      ? `${descriptionSeparator(locale)}${m.description}`
      : "";
    const kind = m.category === "anchor"
      ? copy(locale, "prompt.memoryMarkerFact")
      : m.category === "milestone"
        ? copy(locale, "prompt.memoryMarkerMilestone")
        : "";
    // A memory about the user is marked, so the persona does not mistake
    // the user's own life for the persona's.
    const whose = (m as any).subject === "me" ? copy(locale, "prompt.memoryMarkerAboutUser") : "";
    return `- ${date}${m.title}${description}${kind}${whose}`;
  });
  return `${copy(locale, "prompt.memorySectionHeading")}\n${lines.join("\n")}`;
}

/**
 * Renders anchor memories as a prompt section with a no-hallucination rule.
 */
export function formatAnchorsForPrompt(
  anchors: ScoredMemory[],
  locale: "zh" | "en" = "zh",
): string {
  if (anchors.length === 0) return "";
  const lines = anchors.map((m) => {
    const description = m.description
      ? `${descriptionSeparator(locale)}${m.description}`
      : "";
    return `- ${m.title}${description}`;
  });
  return [
    copy(locale, "prompt.anchorSectionHeading"),
    ...lines,
    copy(locale, "prompt.anchorNoHallucinationRule"),
  ].join("\n");
}

/**
 * Turns the summary of an uploaded file into a retrieval candidate.
 *
 * The plan lists `personaFiles.extractedMemory` as a candidate next to the
 * `memories` table: it is distilled from the chat logs the user uploaded, so
 * it carries the same kind of facts. It ranks below the curated memories
 * because it is long and only loosely structured.
 *
 * The id is negative so it can never collide with a `memories` row id — the
 * two live in different tables and are recalled separately.
 */
export function fileSummaryCandidates(
  files: Array<{ id: number; originalName: string; extractedMemory: string | null; createdAt: Date }>,
  locale: "zh" | "en" = "zh",
): MemoryCandidate[] {
  return files
    .filter((file) => (file.extractedMemory ?? "").trim().length > 0)
    .map((file) => ({
      id: -Math.abs(file.id),
      title: copy(locale, "prompt.fileSummaryTitle", { name: file.originalName }),
      description: (file.extractedMemory ?? "").trim().slice(0, FILE_SUMMARY_MAX_LENGTH),
      category: "file_summary",
      date: null,
      isPinned: false,
      importance: 0,
      subject: "them",
      lastRecalledAt: null,
      createdAt: file.createdAt,
    }));
}

/**
 * Loads a persona's memories and picks the ones worth injecting.
 *
 * Records the recall time so a memory that was just surfaced is damped on the
 * next turn.
 */
export async function retrieveMemories(params: {
  personaId: number;
  userId: number;
  userMessage: string;
  topK?: number;
  locale?: "zh" | "en";
  now?: number;
  /**
   * Whether the selected memories are marked as recalled.
   *
   * A memory that has just been recalled has its weight halved for a
   * day. So looking at the prompt — a read, not a conversation — used
   * to halve the weight of the user's own pinned memories and anchors:
   * the persona stopped using the facts the user had explicitly pinned.
   */
  markRecalled?: boolean;
}): Promise<ScoredMemory[]> {
  const rows = await db.getMemoriesByPersonaId(params.personaId, params.userId);
  const candidates: MemoryCandidate[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    date: row.date,
    subject: (row as any).subject ?? "them",
    isPinned: row.isPinned,
    importance: row.importance,
    lastRecalledAt: row.lastRecalledAt,
    createdAt: row.createdAt,
  }));

  const { selected } = selectMemories(candidates, params.userMessage, {
    topK: params.topK,
    now: params.now,
  });

  // The uploaded-file summaries are candidates too, but they sit below the
  // pinned and anchor memories. A failure to read the files is not fatal —
  // the curated memories are still worth injecting.
  let files: Array<{ id: number; originalName: string; extractedMemory: string | null; createdAt: Date }> = [];
  try {
    /**
     * Only the columns that are used, and only the newest files.
     *
     * The whole row used to be loaded, including the extracted text of
     * every uploaded chat log — megabytes of it, on every single chat
     * turn, of which two summaries of four hundred characters were
     * actually used.
     */
    files = await db.getFileSummariesByPersonaId(params.personaId, params.userId);
  } catch {
    files = [];
  }
  const fileCandidates = fileSummaryCandidates(files, params.locale ?? "zh");
  const fileSelected = selectMemories(fileCandidates, params.userMessage, {
    topK: FILE_SUMMARY_TOP_K,
    now: params.now,
  }).selected;

  const merged = [...selected, ...fileSelected];

  if (selected.length > 0 && params.markRecalled !== false) {
    const now = new Date(params.now ?? Date.now());
    await Promise.all(
      selected.map((m) => db.touchMemoryRecalled(m.id, params.userId, now).catch(() => undefined)),
    );
  }

  return merged;
}
