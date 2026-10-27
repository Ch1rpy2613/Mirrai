import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The app's own confirmation.
 *
 * It was the browser's own dialog (`window.confirm`) — which is not the
 * app's: the buttons say "OK" and "Cancel" in the *browser's* language,
 * not the language the person is reading the app in, and in an
 * embedded view the native dialog is not shown at all — the promise
 * never settles, and so the thing the person was asked about simply
 * never happens, with no word about why.
 *
 * This one is in the app's language, in the app's own shape, and it
 * always settles.
 */

/** What a confirmation asks. */
export type ConfirmOptions = {
  /** The short heading of the dialog. */
  title?: string;
  /** The question itself. */
  description: string;
  /** The button that does it. */
  confirmLabel?: string;
  /** The button that does not. */
  cancelLabel?: string;
  /** Whether the thing being confirmed cannot be undone. */
  destructive?: boolean;
};

/** A question that is waiting for an answer. */
type PendingConfirm = ConfirmOptions & { resolve: (answer: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * The provider.
 *
 * It sits at the top of the app, so any page can ask a question and
 * get an answer.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (answer: boolean) => {
      setPending((current) => {
        current?.resolve(answer);
        return null;
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // The dialog was closed — by the escape key, or by clicking
          // outside it. That is an answer, and it is "no".
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description && (
              <AlertDialogDescription>{pending.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => settle(true)}>
              {pending?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Asks the person a question, and waits for the answer.
 *
 * The labels come from the app's own language — so a person reading
 * the app in Chinese is not asked in the browser's English.
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ask = useContext(ConfirmContext);
  const { t } = useLocale();
  if (!ask) {
    // The app forgot to put the provider in. Better a clear message
    // than a dialog that never opens.
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return useCallback(
    (options: ConfirmOptions) =>
      ask({
        title: t("common.confirmTitle"),
        confirmLabel: t("common.confirm"),
        cancelLabel: t("common.cancel"),
        ...options,
      }),
    [ask, t],
  );
}
