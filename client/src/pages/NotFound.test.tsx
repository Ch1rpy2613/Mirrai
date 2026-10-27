// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The page that is not there.
 *
 * A link that leads nowhere is not a rare thing — a bookmark from
 * another device, a search result, a message someone sent months ago.
 * What matters is what the person who followed it gets.
 */

vi.mock("wouter", () => ({
  useLocation: () => ["/nowhere", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import NotFound from "./NotFound";

describe("the page that is not there", () => {
  it("has a heading the focus can land on", () => {
    /**
     * The focus follows the route: when the page changes, the focus
     * moves to the heading of the page that is on the screen.
     *
     * The heading was an `h2`, and there was no `main` around it — so
     * the focus could never move onto this page. A keyboard user who
     * followed a link to a page that is not there stayed focused on the
     * link they came from, and a screen reader read out the page
     * before, with nothing to say that the page had changed.
     */
    render(<NotFound />);

    const main = screen.getByRole("main");
    const heading = main.querySelector("h1");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe(translate("zh", "errors.notFoundHeading"));
  });

  it("says what happened and offers a way back", () => {
    render(<NotFound />);

    // The two lines are one paragraph, with a line break between them.
    expect(screen.getByText(/要找的页面或许被挪走了/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: translate("zh", "errors.backHome") }),
    ).toBeInTheDocument();
  });
});
