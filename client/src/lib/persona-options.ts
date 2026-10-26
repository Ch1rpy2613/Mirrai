/**
 * The persona fields that are stored as fixed Chinese values.
 *
 * The server keeps `attachmentStyle` and `loveLanguage` verbatim — they are
 * data, not display strings — so the *values* must never be localised. What
 * the user sees, however, is a label, and that label has to follow the
 * interface language or the English UI would show Chinese.
 */
import type { Translate } from "@/i18n";
import {
  LOVE_LANGUAGES as SHARED_LOVE_LANGUAGES,
  normaliseLoveLanguage,
} from "@shared/love-language";

export interface PersonaOption {
  /** The value written to the persona. */
  value: string;
  /** The dictionary key for the label shown to the user. */
  labelKey: string;
}

// The values below are stored, not displayed: they are what the rows in
// the database say, and the label the user sees comes from the dictionary.
// They are Chinese because that is what the rows say, so they are marked
// as identifiers rather than as text.
// i18n:allow-identifier
export const ATTACHMENT_STYLES: PersonaOption[] = [
  { value: "安全型", labelKey: "personaOptions.attachmentStyles.secure" },
  { value: "焦虑型", labelKey: "personaOptions.attachmentStyles.anxious" },
  { value: "回避型", labelKey: "personaOptions.attachmentStyles.avoidant" },
  { value: "混乱型", labelKey: "personaOptions.attachmentStyles.disorganized" },
];

/**
 * The love languages.
 *
 * They live in `shared/love-language.ts`, because the questionnaire, the
 * profile editor and the lobby all have to agree on what is stored —
 * and they did not: the lobby had a different list, with one value
 * misspelled, so the gift icon never appeared for anybody.
 */
export const LOVE_LANGUAGES: PersonaOption[] = SHARED_LOVE_LANGUAGES.map((entry) => ({
  value: entry.value,
  labelKey: entry.labelKey,
}));

function labelFor(
  value: string | null | undefined,
  options: PersonaOption[],
  t: Translate,
): string {
  if (!value) return "";
  // A persona created from the questionnaire before the values were
  // unified holds one of the old spellings; it is brought forward so it
  // is not left blank.
  const normalised =
    options === LOVE_LANGUAGES ? normaliseLoveLanguage(value) : value;
  const match = options.find((option) => option.value === normalised);
  // A value the app does not know about is shown as it is — better than
  // showing nothing.
  if (!match) return value;
  return String(t(match.labelKey as any));
}

/** The label for a stored attachment style. */
export function attachmentStyleLabel(
  value: string | null | undefined,
  t: Translate,
): string {
  return labelFor(value, ATTACHMENT_STYLES, t);
}

/** The label for a stored love language. */
export function loveLanguageLabel(
  value: string | null | undefined,
  t: Translate,
): string {
  return labelFor(value, LOVE_LANGUAGES, t);
}
