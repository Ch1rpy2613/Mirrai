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
export function focusRouteHeading(root: ParentNode = document): boolean {
  const heading = root.querySelector("main h1, main [role='heading'][aria-level='1']");
  if (!(heading instanceof HTMLElement)) return false;
  /**
   * The heading is focusable.
   *
   * A heading is not focusable by default — so it could not take the
   * focus. The attribute is added once and stays: it is what makes the
   * page's heading a place the keyboard can be, which is the point.
   */
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus();
  return document.activeElement === heading;
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
    focusRouteHeading();
  }, [location]);
}
