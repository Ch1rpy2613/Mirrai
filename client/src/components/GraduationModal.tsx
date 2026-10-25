import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { useLocation } from "wouter";
import { declinesOnCancel } from "@/lib/graduation-action";

interface Props {
  personaId: number;
  personaName: string;
  open: boolean;
  onClose: () => void;
  /**
   * "suggest" is the app offering a farewell; "manual" is the user asking
   * for one. The copy differs, because in the manual case nobody is being
   * told anything they did not already know.
   */
  variant?: "suggest" | "manual";
}

export default function GraduationModal({ personaId, personaName, open, onClose, variant = "suggest" }: Props) {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<"suggest" | "letter">("suggest");
  const [letter, setLetter] = useState("");

  const graduateMutation = trpc.persona.graduate.useMutation({
    onSuccess: (data) => {
      setLetter(data.farewellLetter);
      setPhase("letter");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const declineMutation = trpc.persona.declineGraduation.useMutation({
    onSuccess: () => { toast.success(t("graduation.keepCompanionship")); onClose(); },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("graduation.moment")}
        className="relative bg-card border border-border rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in"
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="card-title">
            {variant === "manual" ? t("graduation.manualMoment") : t("graduation.moment")}
          </h3>
          <button onClick={onClose} className="app-nav-icon" aria-label={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {phase === "suggest" && (
            <div className="space-y-5">
              <div>
                <p className="font-sans text-base font-semibold text-foreground mb-2.5">
                  {variant === "manual"
                    ? t("graduation.manualMoment")
                    : t("graduation.soulmate", { name: personaName })}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {variant === "manual"
                    ? t("graduation.manualBody", { name: personaName })
                    : t("graduation.farewellIntro") + t("graduation.farewellBody", { name: personaName })}
                </p>
              </div>
              <hr className="rule" />
              <div className="flex gap-3">
                {/* In the manual flow the user is not declining a
                    suggestion — they are simply changing their mind about
                    writing the letter. Marking the persona as "declined"
                    here would close the door the manual mode is meant to
                    keep open. */}
                <Button variant="outline" className="flex-1 rounded-md bg-transparent"
                  onClick={() => {
                    if (!declinesOnCancel(variant)) { onClose(); return; }
                    declineMutation.mutate({ id: personaId });
                  }}
                  disabled={declineMutation.isPending}>
                  {variant === "manual" ? t("graduation.manualCancel") : t("graduation.keepCompanionship")}
                </Button>
                <Button className="flex-1 rounded-md" onClick={() => graduateMutation.mutate({ id: personaId })}
                  disabled={graduateMutation.isPending}>
                  {graduateMutation.isPending
                    ? t("graduation.writing")
                    : variant === "manual" ? t("graduation.manualBegin") : t("graduation.begin")}
                </Button>
              </div>
            </div>
          )}

          {phase === "letter" && (
            <div className="space-y-5">
              <div>
                <p className="kicker">{t("graduation.letterKicker", { name: personaName })}</p>
              </div>
              <div className="surface p-6">
                <p className="letter-prose text-foreground/90 text-[0.9375rem] whitespace-pre-wrap">{letter}</p>
                <p className="text-right text-muted-foreground text-xs mt-5">—— {personaName}</p>
              </div>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                {t("graduation.letterSaved", { name: personaName })}
              </p>
              {/* The letter is the beginning of something, not the end of
                  it. The page holds the timeline, the moments and the
                  diaries — and it stays there afterwards. */}
              <Button variant="outline" className="w-full rounded-md bg-transparent"
                onClick={() => { onClose(); navigate(`/persona/${personaId}/graduation`); }}>
                {t("graduation.openPage")}
              </Button>
              <Button className="w-full rounded-md" onClick={onClose}>
                {t("graduation.goodbye")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
