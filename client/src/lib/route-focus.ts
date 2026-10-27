import { useEffect, useRef } from "react";

/**
 * The focus follows the route.
 *
 * A client-side navigation replaces the page without moving the focus:
 * so a keyboard user who pressed a link is left with the focus on a
 * link that is not there any more, and a screen reader is still
 * reading the page they came from.
 *
 * The new page's own heading takes the focus — it is the first thing
 * on the page, it says what the page is, and it is what a screen
 * reader should read next.
 */

/**
 * Moves the focus to the heading of the page that is on the screen.
 *
 * Returns whether there was a heading to move to.
 */
/**
 * The heading of the page that is on the screen.
 *
 * The selector used to ask for a heading *inside* a `<main>` — and
 * only three of the thirteen pages have a `<main>` at all, and the
 * chat page has neither a `<main>` nor an `<h1>`. So on the app's main
 * page the focus did not follow the route at all: it stayed on the
 * link that had just been unmounted, fell to `<body>`, and a keyboard
 * user had to tab from the top of the document again.
 *
 * So the heading is looked for anywhere, and a page may say which
 * element is its heading with `data-route-heading`.
 */
export function findRouteHeading(root: ParentNode = document): HTMLElement | null {
  const heading =
    root.querySelector("[data-route-heading]") ??
    root.querySelector("h1") ??
    root.querySelector("[role='heading'][aria-level='1']");
  return heading instanceof HTMLElement ? heading : null;
}

export function focusRouteHeading(root: ParentNode = document): boolean {
  const heading = findRouteHeading(root);
  if (heading) return focusIt(heading);
  /**
   * A page with no heading at all.
   *
   * The main region is still a place for the focus to be, and a screen
   * reader still says what it is. It is the last resort: the heading
   * is what a screen reader should read next, and this is not it.
   */
  const main = root.querySelector("main");
  if (main instanceof HTMLElement) return focusIt(main);
  return false;
}

/** Puts the focus on an element, and says whether it took. */
function focusIt(element: HTMLElement): boolean {
  /**
   * The heading is focusable.
   *
   * A heading is not focusable by default — so it could not take the
   * focus. The attribute is added once and stays: it is what makes the
   * page's heading a place the keyboard can be, which is the point.
   */
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus();
  return document.activeElement === element;
}

/**
 * Moves the focus when the route changes.
 *
 * The first render is not a route change: the page the person opened
 * is not something they navigated to, so the focus stays where the
 * browser put it.
 */
export function useRouteFocus(location: string): void {
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    /**
     * The page may not be on the screen yet.
     *
     * Every route is a lazy chunk behind the `<Suspense>` — so on the
     * *first* visit to a page the chunk is still being fetched, and
     * what is committed is the fallback. The effect ran against the
     * fallback, found no heading, and never tried again: `location` had
     * not changed by the time the real page was committed. So the focus
     * followed the route from the second visit onwards, and not the
     * first.
     */
    let done = false;
    const attempt = () => {
      if (done) return;
      /**
       * Only a *heading* ends the watch.
       *
       * The main region is the last resort, and the heading may still
       * be on its way — so finding the main region does not stop the
       * waiting. Otherwise the focus lands on the region and the
       * heading that arrives a moment later is never focused.
       */
      const heading = findRouteHeading();
      if (!heading) return;
      if (focusIt(heading)) done = true;
    };
    attempt();

    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(attempt);
      observer.observe(document.body, { childList: true, subtree: true });
      // And it gives up rather than watching for ever: a page that
      // never gets a heading should not keep an observer alive.
      const stop = window.setTimeout(() => {
        observer.disconnect();
      }, 5000);
      return () => {
        window.clearTimeout(stop);
        observer.disconnect();
      };
    }
    return undefined;
  }, [location]);
}
