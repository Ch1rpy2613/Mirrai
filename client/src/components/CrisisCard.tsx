import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The crisis card.
 *
 * A crisis reply is not an ordinary bubble. The server short-circuits the
 * model and sends something completely different — but the flag that said
 * so was never read, so the most serious moment the app handles looked
 * exactly like any other message in the thread.
 *
 * It lives on its own because it is not only the chat that shows it: the
 * mood check-in and the relationship timeline are places a person writes
 * the kind of thing this card is for, and they show it too.
 */
export default function CrisisCard({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { data } = trpc.safety.resources.useQuery();

  return (
    <div
      role="alert"
      className="surface border-destructive/40 bg-destructive/5 p-5 sm:p-6 mb-6 animate-fade-in-up relative"
    >
      {/**
       * The card can be put away.
       *
       * It used to stay for the rest of the session — so once it had
       * appeared, the support resources sat above the conversation for
       * the whole visit, long after the moment had passed.
       */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="font-display text-sm font-semibold text-destructive mb-2">
        {t("safety.crisisTitle")}
      </p>
      <p className="text-sm text-foreground/85 leading-relaxed">
        {t("safety.crisisBody")}
      </p>
      <p className="text-xs text-muted-foreground mt-4 mb-2">
        {t("safety.resourcesTitle")}
      </p>
      <ul className="space-y-1.5">
        {(data?.resources ?? []).map((resource) => (
          <li key={resource.id} className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground/80">{resource.region}</span>
            {" · "}
            {resource.description}
            {" · "}
            <span className="text-foreground/80">{resource.contact}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
