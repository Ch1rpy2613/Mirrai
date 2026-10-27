/**
 * The setup for the component tests.
 *
 * The interface had no component tests at all, because there was no DOM
 * to run them in and no testing library to run them with. That is now
 * fixed, and this file is the fix's front door: the DOM matchers are
 * registered here, once, for every component test.
 *
 * It is safe to load in the node environment too — the matchers are just
 * extra assertions, and they only fail when a test uses them.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The observer the charts need.
 *
 * The charting library measures its container with a `ResizeObserver`,
 * and jsdom has none — so a page with a chart on it could not be
 * rendered in a test at all. The stub reports a size and never fires,
 * which is all a chart needs to draw itself.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = StubResizeObserver;
}

/**
 * The observer the scroll effects need.
 *
 * The same as the resize observer above: jsdom has none, and the pages
 * that watch for an element coming into view cannot be rendered in a
 * test without it.
 */
if (typeof globalThis.IntersectionObserver === "undefined") {
  class StubIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as any).IntersectionObserver = StubIntersectionObserver;
}

/**
 * Unmount everything between tests.
 *
 * The testing library does this by itself when the test framework has
 * global hooks enabled. This project does not, so it is done here —
 * without it, one test's render is still on the page for the next one,
 * and every query finds two elements instead of one.
 */
afterEach(() => {
  cleanup();
});
