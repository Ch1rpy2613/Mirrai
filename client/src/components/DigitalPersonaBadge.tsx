/**
 * The label that says what this is.
 *
 * The product's transparency principle says the user should always know
 * they are talking to a digital persona. It used to be left to the model:
 * the prompt told the persona it must never admit to being an AI, and the
 * interface said nothing at all. The interface is the honest place for
 * this, so the label lives here — permanently, and without asking the
 * model to be brave.
 */
import { useLocale } from "@/contexts/LocaleContext";

export interface DigitalPersonaBadgeProps {
  /** A quieter, single-line form for dense lists. */
  compact?: boolean;
}

export default function DigitalPersonaBadge({ compact = false }: DigitalPersonaBadgeProps) {
  // The label is in the interface's language.
  //
  // It was written into the component, in Chinese — so an English user
  // saw 「数字分身」 on every persona card, and this is the one label the
  // product's whole transparency principle rests on.
  const { t } = useLocale();

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[0.625rem] px-1.5 py-0.5 rounded border border-border/70 text-muted-subtle shrink-0">
        {t("chat.digitalPersona")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[0.625rem] px-2 py-0.5 rounded-md border border-border/70 bg-muted/30 text-muted-foreground shrink-0">
      <span aria-hidden className="w-1 h-1 rounded-full bg-current opacity-60" />
      {t("chat.digitalPersona")}
    </span>
  );
}
