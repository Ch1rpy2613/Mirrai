/**
 * PWA registration.
 *
 * The app is local-first, so the service worker only makes the shell load
 * without a network — it never caches conversations. See `public/sw.js`.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

/** True when the browser has offered to install the app. */
export function isInstallAvailable(): boolean {
  return deferredPrompt !== null;
}

/** Subscribes to install-availability changes. */
export function onInstallAvailabilityChange(
  listener: (available: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows the browser's install prompt.
 *
 * Returns true when the user accepted. A browser without the prompt (or a
 * user who dismissed it) returns false rather than throwing.
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    // The prompt is used up, whichever way it went.
    //
    // It was only cleared when the user accepted — and the browser's
    // `beforeinstallprompt` cannot fire again, so the second click
    // threw and was reported as "the install was rejected". The user
    // was told the install had failed when in fact the prompt was
    // simply exhausted.
    deferredPrompt = null;
    notify(false);
    return choice.outcome === "accepted";
  } catch {
    deferredPrompt = null;
    notify(false);
    return false;
  }
}

function notify(available: boolean) {
  for (const listener of Array.from(listeners)) listener(available);
}

/**
 * Registers the service worker.
 *
 * Registration is skipped in development, where Vite serves the modules and a
 * worker would only get in the way.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[PWA] Service worker registration failed:", e);
    });
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify(false);
  });
}

