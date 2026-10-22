/**
 * Tolerant JSON extraction for LLM output.
 *
 * LLMs wrap JSON in prose, markdown fences, or trailing commentary, and a greedy
 * `/\{[\s\S]*\}/` match breaks on the first nested brace. This scans for a
 * balanced object instead, ignoring braces that appear inside strings.
 */

/** Strips a ```json ... ``` fence if present, otherwise returns the input trimmed. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
}

/** Returns the index just past the balanced object starting at `start`, or -1. */
function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Returns the index just past the balanced array starting at `start`, or -1. */
function findArrayEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Extracts the first balanced JSON array from arbitrary LLM output.
 * Returns null when no parseable array is present.
 */
export function extractJsonArray(text: string | null | undefined): unknown[] | null {
  if (!text) return null;
  const source = stripCodeFence(text);

  try {
    const direct = JSON.parse(source);
    if (Array.isArray(direct)) return direct;
  } catch {
    // fall through to scanning
  }

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "[") continue;
    const end = findArrayEnd(source, i);
    if (end === -1) continue;
    try {
      const parsed = JSON.parse(source.slice(i, end));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Extracts the first balanced JSON object from arbitrary LLM output.
 * Returns null when no parseable object is present.
 */
export function extractJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const source = stripCodeFence(text);

  try {
    const direct = JSON.parse(source);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // fall through to scanning
  }

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "{") continue;
    const end = findObjectEnd(source, i);
    if (end === -1) continue;
    try {
      const parsed = JSON.parse(source.slice(i, end));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}
