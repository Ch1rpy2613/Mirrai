/**
 * The server's own words.
 *
 * The interface was translated; the server was not. Every error toast,
 * every push notification, every reply in WeChat, every line of the
 * questionnaire — all of it was written in Chinese, so an English user
 * got an English app that answered in Chinese whenever anything went
 * wrong.
 *
 * This is the other half of the dictionary: the words the *server* says
 * to a person. It lives in `shared/` because both sides need it — the
 * server to pick a language, and the client to check that the two sides
 * agree.
 *
 * The rules:
 *
 *   - Every entry has both a `zh` and an `en`. An entry with only one
 *     is a half-finished translation, and the test says so.
 *   - `zh` is never Latin-only. If it is, the English string was pasted
 *     into the wrong file.
 *   - Placeholders are `{{name}}` in both languages, and the test
 *     checks that the two sides use the same set.
 */
import { ERRORS } from "./errors";
import { CHANNELS } from "./channels";
import { REMINDERS } from "./reminders";
import { SKILL_ENGINE } from "./skill-engine";
import { CONTENT } from "./content";
import { PROMPT } from "./prompt";
import { PROMPTS } from "./prompts";
import { LABELS } from "./labels";
import { SAFETY } from "./safety";
import { SCENES_COPY, BUILTIN_SCENE_SLUGS, BUILTIN_SCENE_DEFINITIONS } from "./scenes";
import { USER_SIDE } from "./user-side";
import { FIDELITY } from "./fidelity";
/**
 * The skill prompts, for their keys.
 *
 * They live in their own file because they are added to the table when
 * the pipeline is loaded — so they are not in `COPY` at the time this
 * module is read. Their keys are part of the key type all the same: a
 * typo in one of them is as wrong as a typo in any other.
 *
 * The import is of the type only, so nothing is read at runtime and
 * there is no cycle.
 */
import type { SKILL_PROMPTS } from "./skill-prompts";

export type CopyEntry = { zh: string; en: string };
export type CopyTable = Record<string, CopyEntry>;

/**
 * The whole table.
 *
 * It is not annotated as `CopyTable`. The annotation widened `CopyKey`
 * to `string`, so `copy()` accepted any key at all and a typo compiled
 * cleanly — and then rendered as the raw key in the interface or inside
 * a model's prompt. The individual tables are annotated, so the union is
 * still checked entry by entry; it is only the *merged* table that has
 * to keep its literal keys.
 *
 * And the key of `copy()` is the literal union, so a typo in a literal
 * call is a compile error. It was `CopyKey | string` — which is
 * `string`, so the union bought nothing at all.
 */
export const COPY = {
  ...ERRORS,
  ...CHANNELS,
  ...REMINDERS,
  ...SKILL_ENGINE,
  ...CONTENT,
  ...PROMPT,
  ...PROMPTS,
  ...LABELS,
  ...SAFETY,
  ...SCENES_COPY,
  ...USER_SIDE,
  ...FIDELITY,
} as const satisfies CopyTable;

export type CopyKey = keyof typeof COPY | keyof typeof SKILL_PROMPTS;

export type Locale = "zh" | "en";

/** Anything that can go wrong to look up. */
export function isCopyKey(key: string): key is Extract<CopyKey, string> {
  return Object.prototype.hasOwnProperty.call(COPY, key);
}

/**
 * The sentence, in the language asked for.
 *
 * The key is a literal, so a typo is a compile error. It used to be
 * `CopyKey | string` — which is `string`, so every typo compiled
 * cleanly and then showed up as `errors.someKey` in the interface, or
 * inside a model's prompt where nobody would ever see it.
 *
 * A key that is built at runtime goes through `copyKey` below.
 */
export function copy(
  locale: Locale | string | undefined,
  key: CopyKey,
  params?: Record<string, string | number>,
): string {
  const entry = (COPY as unknown as Record<string, CopyEntry | undefined>)[key];
  if (!entry) return key;
  const lang: Locale = locale === "en" ? "en" : "zh";
  return interpolate(entry[lang] ?? entry.zh, params);
}

/**
 * The sentence for a key that is not known until it is built.
 *
 * The key is checked at runtime instead of at compile time, so a key
 * that is wrong shows up as the key itself — which is how a missing
 * translation should look.
 */
export function copyKey(
  locale: Locale | string | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const entry = (COPY as unknown as Record<string, CopyEntry | undefined>)[key];
  if (!entry) return key;
  const lang: Locale = locale === "en" ? "en" : "zh";
  return interpolate(entry[lang] ?? entry.zh, params);
}

/** Fills `{{name}}` in. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * The built-in scenes, by the name the database row carries.
 *
 * The rows are seeded with the Chinese name, because that is what the
 * seeding has always used and the name identifies the scene. The
 * display copy lives in the copy table under the slug.
 */
export { BUILTIN_SCENE_SLUGS };

export interface LocalisableScene {
  name: string;
  description?: string | null;
  systemPromptOverlay?: string | null;
  starters?: string[] | null;
  isBuiltin?: boolean;
}

/**
 * Swaps a built-in scene's wording for the language the person is
 * reading.
 *
 * A scene the app ships should read in their language. A scene they
 * wrote themselves is left exactly as they wrote it.
 *
 * The starters are swapped by position, and only when the row carries the
 * same number of them as the copy table does. A row that has been edited
 * — or one from an older release — keeps its own wording rather than
 * having somebody else's line put in its place.
 */
export function localizeScene<T extends LocalisableScene>(scene: T, locale: Locale): T {
  if (!scene.isBuiltin) return scene;
  const slug = BUILTIN_SCENE_SLUGS[scene.name];
  if (!slug) return scene;

  const starters = scene.starters ?? [];
  const definition = BUILTIN_SCENE_DEFINITIONS.find((entry) => entry.slug === slug);
  const localisedStarters =
    definition && starters.length === definition.starters.length
      ? definition.starters.map((starter) => starter[locale === "en" ? "en" : "zh"])
      : starters;

  return {
    ...scene,
    /**
     * The keys are built from the slug, so they are looked up at
     * runtime rather than checked at compile time.
     */
    name: copyKey(locale, `scenes.${slug}.name`),
    description: copyKey(locale, `scenes.${slug}.description`),
    systemPromptOverlay: copyKey(locale, `scenes.${slug}.overlay`),
    starters: localisedStarters,
  };
}

/**
 * Picks a language out of whatever a person typed.
 *
 * The channels are where this matters: the reply goes back to a phone,
 * and the person who wrote it is the only thing that says which language
 * they want it in.
 */
export function detectLocale(text: string | undefined | null): Locale {
  if (!text) return "zh";
  // A CJK character anywhere means Chinese; everything else is English.
  return /[一-鿿぀-ヿ]/.test(text) ? "zh" : "en";
}
