import { Check } from "lucide-react";
import { useRef } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DISTILLATION_PRESETS,
  type DistillationMode,
} from "@shared/distillation-modes";

/**
 * The distillation preset picker.
 *
 * The presets are named rather than parameterised, because the two things
 * a user actually wants to know are "how much will this cost" and "will
 * this be good enough" — and neither of those is a number. The estimate of
 * the model calls is shown next to every preset so the cost is visible
 * before the run starts rather than after it has been paid for.
 */

interface Props {
  value: DistillationMode;
  onChange: (mode: DistillationMode) => void;
  disabled?: boolean;
}

export default function DistillationModePicker({ value, onChange, disabled }: Props) {
  const { t } = useLocale();
  const groupRef = useRef<HTMLDivElement>(null);

  /**
   * The arrow keys move between the options.
   *
   * A group of radio buttons is one control, so the arrow keys are what
   * moves inside it — and the tab key should move *out* of it, not
   * through it. Without this, a keyboard user had to tab through every
   * preset to reach the next control, and could not tell which one was
   * selected without tabbing to it.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = DISTILLATION_PRESETS.findIndex((preset) => preset.id === value);
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next =
      DISTILLATION_PRESETS[
        (index + step + DISTILLATION_PRESETS.length) % DISTILLATION_PRESETS.length
      ];
    if (!next) return;
    onChange(next.id);
    // The focus follows the selection.
    requestAnimationFrame(() => {
      const group = groupRef.current;
      const options = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      options?.[DISTILLATION_PRESETS.findIndex((preset) => preset.id === next.id)]?.focus();
    });
  };

  return (
    <div
      ref={groupRef}
      className="space-y-2"
      role="radiogroup"
      aria-label={t("distillation.title")}
      onKeyDown={onKeyDown}
    >
      {DISTILLATION_PRESETS.map((preset) => {
        const selected = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            tabIndex={selected ? 0 : -1}
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(preset.id)}
            className={`w-full text-left p-3 rounded-md border transition-colors disabled:opacity-50 ${
              selected
                ? "border-cinnabar/40 bg-cinnabar/5"
                : "border-border hover:border-foreground/30 hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                {t(preset.clientLabelKey as any)}
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {t("distillation.calls", { count: preset.approxCalls })}
              </span>
              {selected && <Check className="w-3.5 h-3.5 text-cinnabar flex-shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(preset.clientDescriptionKey as any)}
            </p>
            <p className="text-[11px] text-muted-subtle mt-1">
              {t("distillation.sample", { count: preset.chatSampleLimit })}
              {" · "}
              {t("distillation.photos", { count: preset.maxImages })}
            </p>
          </button>
        );
      })}
    </div>
  );
}
