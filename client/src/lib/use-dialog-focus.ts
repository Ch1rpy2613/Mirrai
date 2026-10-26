import { useEffect, useRef } from "react";

/**
 * The focus handling a dialog needs.
 *
 * A window that covers the page is a dialog, so it has to behave like
 * one: the focus goes into it when it opens and comes back to whatever
 * opened it when it closes; Tab walks inside it and not through the page
 * behind it; and Escape closes it.
 *
 * The pattern was hand-rolled in the graduation window, and the two
 * overlays in the chat — the memory timeline and the emotion report —
 * had none of it: the focus stayed on the chat input behind the
 * overlay, Tab walked into the conversation under the window, and
 * Escape did nothing.
 *
 * @param open    Whether the dialog is open.
 * @param onClose What Escape does.
 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose?: () => void,
) {
  const dialogRef = useRef<T | null>(null);

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

  // Escape closes the window.
  useEffect(() => {
    if (!open || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return dialogRef;
}
