// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The goodbye, and the way out.
 *
 * Two things have to be true on this page at the same time: the farewell
 * is there, and the exit is there. A goodbye that only seals the door
 * leaves the user with the words they never said and nowhere to take
 * them.
 */
let persona: any;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: { get: { useQuery: () => ({ data: persona }) } },
    relationship: { list: { useQuery: () => ({ data: { events: [] } }) } },
    memory: { list: { useQuery: () => ({ data: { items: [] } }) } },
    diary: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/graduation", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

// The panel brings its own data access with it.
vi.mock("@/components/OutboundLetters", () => ({
  default: () => <div data-testid="outbound-letters" />,
}));

import Graduation from "./Graduation";

describe("the goodbye", () => {
  beforeEach(() => {
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      farewellLetter: "我一直都知道，只是没说。",
      graduatedAt: new Date("2026-03-01T00:00:00Z"),
      farewellDegraded: false,
      personaData: null,
    };
  });

  it("shows the farewell", () => {
    render(<Graduation />);
    expect(screen.getByText("我一直都知道，只是没说。")).toBeInTheDocument();
  });

  it("has the exit", () => {
    render(<Graduation />);
    expect(screen.getByTestId("outbound-letters")).toBeInTheDocument();
  });

  it("does not claim the letter is simplified when it is not", () => {
    render(<Graduation />);
    expect(screen.queryByText(translate("zh", "graduationPage.simplified"))).toBeNull();
  });

  it("shows what the second pass kept, and what it cut", () => {
    // The letter is written in two passes, and the subtraction is the
    // interesting half. It used to be computed and thrown away.
    persona.farewellDraft = {
      kept: ["我一直都知道，只是没说。"],
      removed: ["我希望你一切都好。"],
    };
    render(<Graduation />);
    expect(screen.getByText(translate("zh", "graduationPage.keptHeading"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "graduationPage.removedHeading"))).toBeInTheDocument();
    expect(screen.getByText("我希望你一切都好。")).toBeInTheDocument();
  });

  it("says so when the letter is the simplified one", () => {
    // The letter comes from two passes, and when the second one cannot
    // finish, the older single-pass letter is used. The reader has to be
    // able to tell the two apart.
    persona.farewellDegraded = true;
    render(<Graduation />);
    expect(screen.getByText(translate("zh", "graduationPage.simplified"))).toBeInTheDocument();
  });
});
