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
