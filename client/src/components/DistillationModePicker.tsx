import { Check } from "lucide-react";
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

  return (
    <div className="space-y-2" role="radiogroup" aria-label={t("distillation.title")}>
      {DISTILLATION_PRESETS.map((preset) => {
        const selected = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
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
            <p className="text-[11px] text-muted-foreground/80 mt-1">
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
