/**
 * Turning a conversation into memories.
 *
 * The extraction used to be a button. A button means the user has to
 * remember to press it, decide it is worth pressing, and then live with
 * the result — and if they press it twice, they get the same memories
 * twice. The conversation moves on without them.
 *
 * So the extraction runs on its own, at most once a day, and it never
 * stores anything it already holds.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { llmService } from "../llm";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import { copy } from "@shared/copy";

/**
 * How many messages back the extraction looks when there is no cut-off.
 *
 * The window is normally "everything since the last extraction", so this
 * is only the ceiling for the very first run — and for a run whose
 * cut-off could not be read.
 */
const LOOKBACK = 50;

/** How many memories one run may add. */
const MAX_PER_RUN = 5;

/**
 * The normal form of a title, for comparison.
 *
 * Two memories about the same thing are written differently every time —
 * "第一次见面" and "初次见面" and "我们第一次约会" are one memory
 * written three ways.
 */
export function normalizeMemoryTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    // Whitespace and punctuation — ASCII, and the CJK blocks, because a
    // Chinese title ends with 「。」 or 「！」 as often as not. A full
    // unicode property escape would need a newer target than the one
    // this server is compiled for.
    .replace(/[\s!-\/:-@\[-`{-~\u3000-\u303F\uFF01-\uFF65]/g, "");
}

/**
 * Whether a memory is already held.
 *
 * Exact match on the normalised title, or a close match on the
 * description — a memory that says the same thing in different words is
 * still the same memory.
 */
export function isDuplicateMemory(
  candidate: { title: string; description?: string | null },
  existing: Array<{ title: string; description?: string | null }>,
): boolean {
  const title = normalizeMemoryTitle(candidate.title);
  if (!title) return true;

  for (const memory of existing) {
    if (normalizeMemoryTitle(memory.title) === title) return true;

    const a = candidate.description?.trim();
    const b = memory.description?.trim();
    if (!a || !b) continue;
    if (normalizeMemoryTitle(a) === normalizeMemoryTitle(b)) return true;

    // A description that contains the other's title is the same memory
    // told at a different length.
    if (a.length >= 4 && b.length >= 4) {
      if (a.includes(b) || b.includes(a)) {
        const shorter = a.length <= b.length ? a : b;
        const longer = a.length <= b.length ? b : a;
        // Only when the extra length is not a whole new sentence.
        if (longer.length - shorter.length < longer.length * 0.5) return true;
      }
    }
  }
  return false;
}

export interface ExtractResult {
  added: Array<{ id: number; title: string; subject: string }>;
  skipped: number;
}

/**
 * Runs the extraction and stores what is new.
 */
export async function extractMemories(params: {
  persona: Persona;
  userId: number;
  locale?: "zh" | "en";
  now?: Date;
}): Promise<ExtractResult> {
  const { persona, userId } = params;
  const locale = params.locale ?? "zh";
  /**
   * The messages since the last extraction.
   *
   * The cut-off has to come from the extraction log — the record of
   * what was looked at. It used to come from the newest *memory* row,
   * which is a different thing entirely: a memory the user added by
   * hand moved the cut-off forward, so the messages between the last
   * extraction and that memory were never extracted; and an extraction
   * that produced no new memory left the cut-off where it was, so the
   * same messages were sent to the model again on every later run.
   */
  const lastExtracted = await db.getLastExtractionAt(persona.id, userId);
  /**
   * The window.
   *
   * It was a fixed fifty messages — so when more than fifty messages
   * arrived between two extractions, the older ones were outside the
   * window, were never extracted, and the window was still marked as
   * extracted. Those messages were skipped for ever.
   */
  /**
   * The messages are read in batches.
   *
   * The read had no ceiling, so on a persona's *first* extraction it
   * brought every message the persona had ever had — id, role, text
   * and all — into the heap, and then threw away all but the first
   * fifty. A long-lived persona's first extraction was tens of
   * thousands of rows for nothing.
   */
  const history = await db.getMessagesSince(
    persona.id,
    userId,
    lastExtracted ?? new Date(0),
    LOOKBACK,
  );
  if (history.length === 0) return { added: [], skipped: 0 };

  /**
   * The batch: the oldest messages first, and only as many as the model
   * can read.
   *
   * The window used to be a fixed fifty messages, so when more than
   * fifty messages arrived between two extractions the older ones were
   * outside the window, were never extracted, and the window was still
   * marked as extracted: those messages were skipped for ever.
   *
   * So the run covers only what it read, and the rest is picked up by
   * the next one.
   */
  const batch = history.slice(0, LOOKBACK);
  const coveredAt = batch[batch.length - 1]?.createdAt ?? null;

  /**
   * Only the messages that have not been looked at yet.
   *
   * The cut-off has to come from the extraction log — the record of
   * what was looked at. It used to come from the newest *memory* row,
   * which is a different thing entirely: a memory the user added by
   * hand moved the cut-off forward, so the messages between the last
   * extraction and that memory were never extracted; and an extraction
   * that produced no new memory left the cut-off where it was, so the
   * same messages were sent to the model again on every later run.
   */
  const fresh = batch;
  if (fresh.length < 3) return { added: [], skipped: 0 };

  // The transcript is read by the model, so the name it gives the user is
  // in the language the persona is speaking.
  const chatText = fresh
    .map((m) => `${m.role === "user" ? copy(locale, "prompt.roleUser") : persona.name}: ${m.content}`)
    .join("\n");

  let response = "";
  /**
   * Whose provider this is.
   *
   * The distinction is the whole point. The environment-configured
   * provider is the *operator's* account and the operator's bill, so it
   * may only be used when the user has no provider of their own. When
   * the provider is the user's, the operator's must not be tried
   * afterwards: that is how a user's private conversation ended up on
   * somebody else's account whenever their provider had a bad minute.
   *
   * The extraction used to fall back unconditionally — so a user's
   * own transcript was sent to the operator's account, and billed to
   * the operator, exactly when their provider had a bad minute.
   */
  let mayUseServerProvider = true;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId,
      providerName: (persona as any).llmProvider ?? undefined,
    });
    mayUseServerProvider = !resolved.owned;
    if (resolved.provider) {
      // Through the service, so the retry policy is the same as it is
      // everywhere else: a transient failure of the user's own provider
      // failed the extraction outright, while the same failure would
      // have been retried for every other call.
      response = await llmService.invokeWithProvider(resolved.provider, {
        messages: [
          { role: "system", content: copy(locale, "prompts.memoryExtraction") },
          { role: "user", content: chatText },
        ],
      });
    }
  } catch (e) {
    console.warn("[Memories] The user's provider failed:", (e as Error).message);
  }
  if (!response.trim() && mayUseServerProvider) {
    try {
      response = await llmService.invoke({
        messages: [
          { role: "system", content: copy(locale, "prompts.memoryExtraction") },
          { role: "user", content: chatText },
        ],
      });
    } catch (e) {
      console.warn("[Memories] No provider could extract:", (e as Error).message);
      return { added: [], skipped: 0 };
    }
  }
  if (!response.trim()) return { added: [], skipped: 0 };

  const existing = await db.getMemoriesByPersonaId(persona.id, userId);
  const added: ExtractResult["added"] = [];
  let skipped = 0;

  let parsed: unknown;
  /**
   * Whether the answer was understood.
   *
   * An answer that cannot be read is not an answer of "nothing to
   * remember" — it is a failure. The two were the same thing here, so
   * a malformed reply marked the window as extracted and those messages
   * were never looked at again.
   */
  let understood = false;
  /**
   * The array, or null when the answer is not an array at all.
   *
   * The fallback used to be `?? "[]"`, which made a reply that was not
   * JSON at all — a refusal, a truncated answer, a sentence — parse as
   * an empty list. So the reply was *understood*, and the window was
   * marked as extracted: those messages were never looked at again, and
   * the user had no way of knowing.
   *
   * So the two are separate now: no array means the answer could not be
   * read, and an empty array means there was nothing to remember.
   */
  const arrayText = extractJsonArrayText(response);
  if (arrayText === null) {
    parsed = [];
    console.warn("[Memories] The extraction could not be read — the messages are kept for the next run.");
  } else {
    try {
      parsed = JSON.parse(arrayText);
      understood = true;
    } catch {
      parsed = [];
      console.warn("[Memories] The extraction could not be read — the messages are kept for the next run.");
    }
  }
  const items = Array.isArray(parsed) ? parsed : [];
  const seen: Array<{ title: string; description?: string | null }> = [];

  for (const raw of items.slice(0, MAX_PER_RUN)) {
    const item = (raw ?? {}) as {
      title?: string;
      description?: string;
      category?: string;
      subject?: string;
      date?: string;
    };
    const title = (item.title || "").trim();
    if (!title) continue;

    // The same run may produce the same memory twice.
    if (isDuplicateMemory({ title, description: item.description }, seen)) {
      skipped += 1;
      continue;
    }
    // And it may produce one that is already held.
    if (isDuplicateMemory({ title, description: item.description }, existing as any)) {
      skipped += 1;
      continue;
    }
    seen.push({ title, description: item.description });

    const category = ["milestone", "memory", "anniversary", "anchor"].includes(item.category ?? "")
      ? item.category!
      : "memory";
    const subject = item.subject === "me" ? "me" : "them";

    const id = await db.createMemory({
      personaId: persona.id,
      userId,
      title: title.slice(0, 200),
      description: item.description ?? null,
      category: category as any,
      subject,
      date: item.date ?? null,
      importance: category === "anchor" ? 5 : category === "milestone" ? 3 : 1,
    } as any);

    added.push({ id, title: title.slice(0, 200), subject });
  }

  /**
   * The window is marked as looked at only when the answer was read.
   *
   * An empty array is a real answer: there was nothing to remember, and
   * marking it means the same messages are not sent again on every
   * later run. An answer that could not be parsed is not.
   */
  if (understood) {
    await db.markMemoryExtracted(
      persona.id,
      userId,
      coveredAt ? new Date(coveredAt) : new Date(),
    );
  }
  return { added, skipped };
}

/**
 * Pulls a JSON array out of a model response.
 */
function extractJsonArrayText(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

/**
 * Whether the extraction is due.
 *
 * Once a day, and only when there is enough new conversation to be worth
 * extracting. The cost of an LLM call is real, and running it every turn
 * would turn a background task into a bill.
 */
export function isExtractionDue(params: {
  lastExtractedAt: Date | null;
  newMessageCount: number;
  now?: Date;
  minNewMessages?: number;
  minIntervalHours?: number;
}): boolean {
  const now = params.now ?? new Date();
  const minNewMessages = params.minNewMessages ?? 10;
  const minIntervalHours = params.minIntervalHours ?? 24;

  if (params.newMessageCount < minNewMessages) return false;
  if (!params.lastExtractedAt) return true;
  const elapsed = now.getTime() - params.lastExtractedAt.getTime();
  return elapsed >= minIntervalHours * 3_600_000;
}
