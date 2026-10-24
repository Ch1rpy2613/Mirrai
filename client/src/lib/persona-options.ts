/**
 * The persona fields that are stored as fixed Chinese values.
 *
 * The server keeps `attachmentStyle` and `loveLanguage` verbatim — they are
 * data, not display strings — so the *values* must never be localised. What
 * the user sees, however, is a label, and that label has to follow the
 * interface language or the English UI would show Chinese.
 */
import type { Translate } from "@/i18n";

export interface PersonaOption {
  /** The value written to the persona. */
  value: string;
  /** The dictionary key for the label shown to the user. */
  labelKey: string;
}

export const ATTACHMENT_STYLES: PersonaOption[] = [
  { value: "安全型", labelKey: "personaOptions.attachmentStyles.secure" },
  { value: "焦虑型", labelKey: "personaOptions.attachmentStyles.anxious" },
  { value: "回避型", labelKey: "personaOptions.attachmentStyles.avoidant" },
  { value: "混乱型", labelKey: "personaOptions.attachmentStyles.disorganized" },
];

export const LOVE_LANGUAGES: PersonaOption[] = [
  { value: "精心时刻", labelKey: "personaOptions.loveLanguages.qualityTime" },
  { value: "肯定的言辞", labelKey: "personaOptions.loveLanguages.words" },
  { value: "服务的行动", labelKey: "personaOptions.loveLanguages.service" },
  { value: "身体接触", labelKey: "personaOptions.loveLanguages.touch" },
  { value: "接收礼物", labelKey: "personaOptions.loveLanguages.gifts" },
];

function labelFor(
  value: string | null | undefined,
  options: PersonaOption[],
  t: Translate,
): string {
  if (!value) return "";
  const match = options.find((option) => option.value === value);
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
