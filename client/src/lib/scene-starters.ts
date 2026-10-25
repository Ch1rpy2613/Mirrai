/**
 * The opening lines a conversation starts with.
 *
 * Three sources can supply them, and they are not equally close to the
 * moment: a scene knows what is happening right now, the persona knows how
 * this person usually starts a conversation, and the app has a generic set
 * for when neither knows. The scene wins, because it is the most specific
 * answer to "what would we say at this point".
 *
 * The function is pure so the priority can be tested without a browser.
 */

/** Reads a list of non-empty strings out of an unknown value. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function resolveStarterQuestions(params: {
  /** The active scene's own opening lines. */
  sceneStarters?: unknown;
  /** The persona's own opening lines, from its distilled data. */
  personaStarters?: unknown;
  /** The app's generic set, used when nothing else is known. */
  fallback: readonly string[];
}): string[] {
  const scene = toStringList(params.sceneStarters);
  if (scene.length > 0) return scene;

  const persona = toStringList(params.personaStarters);
  if (persona.length > 0) return persona;

  return [...params.fallback];
}
