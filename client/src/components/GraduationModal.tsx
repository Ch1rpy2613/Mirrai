import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { useLocation } from "wouter";
import { declinesOnCancel } from "@/lib/graduation-action";
import { usePersistFn } from "@/hooks/usePersistFn";

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
    onError: (e: any) => toast.error(e.message),
  });

  /**
   * Every way out of the offer is a refusal.
   *
   * The ✕ and the backdrop used to close the window without telling
   * anybody. The rule the app follows is in `graduation-action.ts`: in
   * the "suggest" flow the app offered the farewell and the user is
   * declining it, and that has to be recorded — or the app offers it
   * again on the next turn. So the two natural "no, thank you" gestures
   * were the two that did not count.
   */
  const dismiss = usePersistFn(() => {
    /**
     * After the letter has been written, closing is not a refusal.
     *
     * The window has two phases: the offer, and the letter. In the
     * second phase `persona.graduate` has already set the persona's
     * status to "graduated" and written the letter — and the escape
     * key, the backdrop and the ✕ all called the same `dismiss`, which
     * recorded a refusal.
     *
     * So the persona was left in a contradictory state: declined, with
     * a farewell letter and a graduation date. It could not be
     * un-graduated any more — the "awaken" path refuses a persona that
     * is not graduated — and the farewell could be offered again.
     */
    if (phase === "letter") { onClose(); return; }
    if (!declinesOnCancel(variant)) { onClose(); return; }
    if (declineMutation.isPending) return;
    declineMutation.mutate({ id: personaId }, { onSettled: onClose });
  });

  // The window is always mounted — the chat page passes `open` rather
  // than unmounting it — so the phase of the last time it was opened
  // was still there when it was opened again. After a graduation, the
  // second opening showed the letter of the first one.
  useEffect(() => {
    if (!open) return;
    setPhase("suggest");
    setLetter("");
  }, [open]);

  /**
   * The focus.
   *
   * The window is hand-rolled rather than built on the project's own
   * dialog, so it had none of the focus handling a dialog needs: the
   * focus stayed on the chat input behind the overlay, Tab walked into
   * the chat page under the window, and on close the focus was not
   * returned to whatever opened it.
   */
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // Into the window, on the first thing in it.
    const first = dialog?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])",
    );
    (first ?? dialog)?.focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // And back to whatever opened the window.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Escape closes the window, and it counts as a refusal too.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={dismiss} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        /**
         * The dialog is named by its own heading.
         *
         * The name used to be fixed — so in the manual variant the
         * accessible name did not contain the visible label, and a
         * screen reader read something the reader could not see.
         */
        aria-labelledby="graduation-modal-title"
        tabIndex={-1}
        className="relative bg-card border border-border rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in"
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 id="graduation-modal-title" className="card-title">
            {variant === "manual" ? t("graduation.manualMoment") : t("graduation.moment")}
          </h3>
          <button onClick={dismiss} className="app-nav-icon" aria-label={t("common.close")}>
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
                    : t("graduation.farewellIntro") + " " + t("graduation.farewellBody", { name: personaName })}
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
                  onClick={dismiss}
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
