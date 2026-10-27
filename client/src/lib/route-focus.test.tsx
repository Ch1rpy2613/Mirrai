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

  it("does nothing when the page has no heading at all", () => {
    document.body.innerHTML = `<div><p>nothing here</p></div>`;

    expect(focusRouteHeading()).toBe(false);
  });

  it("goes to a heading that is not inside a main", () => {
    /**
     * The selector used to ask for a heading *inside* a `<main>` — and
     * only three of the thirteen pages have a `<main>` at all. So on a
     * page without one the focus did not follow the route: it stayed on
     * the link that had just been unmounted.
     */
    document.body.innerHTML = `<div><h1>聊天</h1></div>`;

    expect(focusRouteHeading()).toBe(true);
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("goes to the element the page says is its heading", () => {
    document.body.innerHTML = `
      <header><p data-route-heading role="heading" aria-level="1">小满</p></header>
      <div><h1>别处</h1></div>
    `;

    expect(focusRouteHeading()).toBe(true);
    expect(document.activeElement?.textContent).toBe("小满");
  });

  it("goes to the main region when the page has no heading", () => {
    document.body.innerHTML = `<main><p>nothing here</p></main>`;

    expect(focusRouteHeading()).toBe(true);
    expect(document.activeElement?.tagName).toBe("MAIN");
  });
});

/** A page that arrives late — the lazy chunk, and its fallback. */
function LatePage({ location, ready }: { location: string; ready: boolean }) {
  useRouteFocus(location);
  if (!ready) return <div>加载中…</div>;
  return (
    <main>
      <h1>聊天</h1>
    </main>
  );
}

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

  it("follows the route even when the page arrives late", async () => {
    /**
     * Every route is a lazy chunk behind the `<Suspense>` — so on the
     * first visit the chunk is still being fetched and what is
     * committed is the fallback. The effect ran against the fallback,
     * found no heading, and never tried again: so the focus followed
     * the route from the *second* visit onwards, and not the first.
     */
    const { rerender } = render(<LatePage location="/lobby" ready={false} />);
    rerender(<LatePage location="/chat" ready={false} />);

    // The page is still the fallback — there is no heading yet.
    expect(document.activeElement?.tagName).not.toBe("H1");

    // And now the real page arrives.
    rerender(<LatePage location="/chat" ready={true} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.activeElement?.tagName).toBe("H1");
  });
});
