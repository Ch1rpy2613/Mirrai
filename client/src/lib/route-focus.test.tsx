// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { focusRouteHeading, useRouteFocus } from "./route-focus";

/**
 * The focus follows the route.
 *
 * A client-side navigation replaces the page without moving the focus:
 * so a keyboard user who pressed a link is left with the focus on a
 * link that is not there any more, and a screen reader is still
 * reading the page they came from.
 */

describe("the focus after a route change", () => {
  it("goes to the heading of the page that is on the screen", () => {
    document.body.innerHTML = `
      <main>
        <h1>大厅</h1>
        <p>something</p>
      </main>
    `;

    const moved = focusRouteHeading();

    expect(moved).toBe(true);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("大厅");
  });

  it("gives the heading somewhere to be focused", () => {
    document.body.innerHTML = `<main><h1>大厅</h1></main>`;

    focusRouteHeading();

    // A heading is not focusable by default — so it could not take the
    // focus at all.
    expect(document.querySelector("h1")?.getAttribute("tabindex")).toBe("-1");
  });

  it("does nothing when the page has no heading", () => {
    document.body.innerHTML = `<main><p>nothing here</p></main>`;

    expect(focusRouteHeading()).toBe(false);
  });
});

/** A page whose focus follows the route. */
function Page({ location }: { location: string }) {
  useRouteFocus(location);
  return (
    <main>
      <h1>大厅</h1>
    </main>
  );
}

describe("the focus while the route changes", () => {
  it("follows the route, and not the first render", () => {
    const { rerender } = render(<Page location="/lobby" />);

    // The page the person opened is not something they navigated to.
    expect(document.activeElement?.tagName).not.toBe("H1");

    rerender(<Page location="/diary" />);
    expect(document.activeElement?.tagName).toBe("H1");
  });
});
