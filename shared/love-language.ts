/**
 * The love languages, and the values they are stored under.
 *
 * There were three vocabularies for one thing.
 *
 * The profile editor offered five values. The lobby drew an icon from
 * five *different* values — one of which was misspelled, so the gift
 * icon never appeared for anybody. And the questionnaire wrote a
 * localised string into the persona: "具体的礼物" for a Chinese user and
 * "Gifts" for an English one. A persona created from the questionnaire
 * therefore matched neither the editor's list nor the lobby's icons: the
 * editor's select showed nothing at all, and the icon was missing.
 *
 * So the values live here, once. They are the values the rows in the
 * database hold, and they are not localised — the label the user sees
 * comes from the dictionary.
 */

/** One love language. */
export interface LoveLanguage {
  /** A stable key, for code that needs one. */
  key: string;
  /** The value written to the persona. Not localised — it is data. */
  value: string;
  /** The dictionary key for the label shown to the user. */
  labelKey: string;
}

// The values below are stored, not displayed: they are what the rows in
// the database say, and the label the user sees comes from the dictionary.
// They are Chinese because that is what the rows say, so they are marked
// as identifiers rather than as text.
// i18n:allow-identifier
export const LOVE_LANGUAGES: LoveLanguage[] = [
  { key: "time", value: "精心时刻", labelKey: "personaOptions.loveLanguages.qualityTime" },
  { key: "words", value: "肯定的言辞", labelKey: "personaOptions.loveLanguages.words" },
  { key: "service", value: "服务的行动", labelKey: "personaOptions.loveLanguages.service" },
  { key: "touch", value: "身体接触", labelKey: "personaOptions.loveLanguages.touch" },
  { key: "gifts", value: "接收礼物", labelKey: "personaOptions.loveLanguages.gifts" },
];

/**
 * The value each of the questionnaire's answers is stored under.
 *
 * The questionnaire asks about six things; the five love languages
 * cover them, and two of the answers — "acts" and "service" — are the
 * same language in different words.
 */
// i18n:allow-identifier
export const LOVE_LANGUAGE_BY_ANSWER_KEY: Record<string, string> = {
  words: "肯定的言辞",
  time: "精心时刻",
  gifts: "接收礼物",
  acts: "服务的行动",
  touch: "身体接触",
  service: "服务的行动",
};

/**
 * The values the questionnaire used to write.
 *
 * They are in the database already: every persona created from the
 * questionnaire before this list existed has one of them. They are
 * mapped to the right label so those personas are not left blank.
 */
const LEGACY_VALUES: Record<string, string> = {
  // i18n:allow-identifier
  "具体的礼物": "接收礼物",
  // i18n:allow-identifier
  "陪伴的时间": "精心时刻",
  // i18n:allow-identifier
  "为对方做的实际的事": "服务的行动",
  // i18n:allow-identifier
  "身体接触和亲密": "身体接触",
  // i18n:allow-identifier
  "接受礼物": "接收礼物",
};

/**
 * The value a persona should hold for a love language.
 *
 * A key — what the questionnaire asks for — becomes the stored value.
 * A value that is already stored is left alone, unless it is one of the
 * old spellings, in which case it is brought forward.
 */
export function normaliseLoveLanguage(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  const legacy = LEGACY_VALUES[trimmed];
  if (legacy) return legacy;
  return trimmed;
}

/** The stable key for a stored love language. */
export function loveLanguageKey(value: string | null | undefined): string | null {
  const normalised = normaliseLoveLanguage(value);
  if (!normalised) return null;
  const match = LOVE_LANGUAGES.find((entry) => entry.value === normalised);
  if (match) return match.key;
  // A value the app does not know about: the key is the value itself,
  // so the caller can still tell it apart from another one.
  return normalised;
}
