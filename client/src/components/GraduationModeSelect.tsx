import { useLocale } from "@/contexts/LocaleContext";
import { GRADUATION_MODES, type GraduationMode } from "@shared/graduation-mode";

/**
 * The graduation mode picker.
 *
 * The same three modes are offered in two places — the settings page, where
 * they are the instance-wide default, and the persona editor, where they
 * override that default for one relationship. The persona editor adds an
 * "inherit" option on top, because a persona that has no opinion of its own
 * should follow the instance.
 */

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-[color,box-shadow,border-color,background] focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] dark:bg-input/35";

/** The label of a mode, in the current language. */
export function graduationModeLabelKey(mode: GraduationMode): string {
  return `graduationMode.${mode}`;
}

/** The explanation of a mode, in the current language. */
export function graduationModeNoteKey(mode: GraduationMode): string {
  return `graduationMode.${mode}Note`;
}

interface Props {
  /** The chosen mode, or "inherit" for the persona-level picker. */
  value: GraduationMode | "inherit";
  onChange: (value: GraduationMode | "inherit") => void;
  /** Whether "follow the global setting" is offered. */
  allowInherit?: boolean;
  disabled?: boolean;
  id?: string;
}

export default function GraduationModeSelect({
  value,
  onChange,
  allowInherit = false,
  disabled,
  id,
}: Props) {
  const { t } = useLocale();

  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value as GraduationMode | "inherit")}
      className={selectClass}
    >
      {allowInherit && <option value="inherit">{t("graduationMode.inherit")}</option>}
      {GRADUATION_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {t(graduationModeLabelKey(mode) as any)}
        </option>
      ))}
    </select>
  );
}
