// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The portrait.
 *
 * The page is what the app thinks this person is. Two things were added
 * to it and both are about honesty:
 *
 *   the rules the user confirmed are shown as *the user's* decisions,
 *   and the candidates they never confirmed are not shown at all —
 *   presenting a guess as a decision is the one thing this page must
 *   not do.
 */
let persona: any;
/** Whether the query is still on its way. */
let personaLoading = false;
/** Whether the query failed. */
let personaFailed = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: {
        useQuery: () => ({
          data: persona,
          isLoading: personaLoading,
          isError: personaFailed,
          error: null,
          refetch: () => {},
        }),
      },
    },
    memory: { list: { useQuery: () => ({ data: { items: [] } }) } },
    relationship: { list: { useQuery: () => ({ data: { events: [] } }) } },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1", vi.fn()],
}));

/** The language the page is read in. */
let locale: "zh" | "en" = "zh";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate(locale, key, params),
    locale,
    localeName: locale === "en" ? "English" : "中文",
    setLocale: () => {},
  }),
}));

// The panel brings its own data access with it.
vi.mock("@/components/FidelityPanel", () => ({
  default: () => <div data-testid="fidelity-panel" />,
}));

import PersonaProfile from "./PersonaProfile";

describe("the portrait", () => {
  beforeEach(() => {
    locale = "zh";
  });

  it("does not print a Chinese identifier in the English interface", () => {
    /**
     * What is stored is a Chinese *identifier* — "安全型", "肯定的言辞" —
     * and it was printed as it was. So an English user read
     * "肯定的言辞" under "Love language", while the same persona's
     * lobby card read "Words of affirmation".
     */
    locale = "en";
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      analysisStatus: "ready",
      emotionalState: "warm",
      personaData: {
        attachmentStyle: "安全型",
        loveLanguage: "肯定的言辞",
        personality: "温柔",
      },
    };

    render(<PersonaProfile />);

    expect(screen.getByText("Words of affirmation")).toBeInTheDocument();
    expect(screen.getByText("Secure")).toBeInTheDocument();
    expect(screen.queryByText("肯定的言辞")).toBeNull();
    expect(screen.queryByText("安全型")).toBeNull();
  });

  it("does not spin for ever when the persona cannot be read", () => {
    // The sign-in request failed, so the persona query stayed disabled:
    // no persona, no error, and the loader the page showed for ever.
    // There has to be a way back.
    persona = undefined as any;
    personaLoading = false;
    personaFailed = false;

    render(<PersonaProfile />);

    expect(screen.getByText(translate("zh", "common.retry"))).toBeInTheDocument();
  });


  beforeEach(() => {
    personaLoading = false;
    personaFailed = false;
    persona = {
      id: 1,
      userId: 1,
      name: "小A",
      relationshipDesc: "前女友",
      togetherFrom: "2021-06-15",
      togetherTo: null,
      timezone: null,
      personaData: {
        personality: "温柔",
        speakingStyle: "短句",
        catchphrases: ["嗯嗯"],
        microRules: [
          {
            id: "r1",
            trigger: ["随便你"],
            meaning: "她真的生气了",
            rendering: "更短、更冷",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          },
          {
            id: "r2",
            trigger: ["嗯"],
            meaning: "在听",
            rendering: "回一个嗯",
            confidence: 0.6,
            source: "auto",
            verified: false,
            evidence: [],
          },
        ],
      },
    };
  });

  it("shows the rules the user confirmed", () => {
    render(<PersonaProfile />);
    expect(screen.getByText(translate("zh", "profile.rules"))).toBeInTheDocument();
    expect(screen.getByText(/她真的生气了/)).toBeInTheDocument();
  });

  it("does not show the candidates the user never confirmed", () => {
    render(<PersonaProfile />);
    // The unconfirmed rule's meaning must not appear on the page.
    expect(screen.queryByText(/在听/)).toBeNull();
  });

  it("shows the ruler", () => {
    render(<PersonaProfile />);
    expect(screen.getByTestId("fidelity-panel")).toBeInTheDocument();
  });

  it("has no rules section when there are no rules", () => {
    persona.personaData.microRules = [];
    render(<PersonaProfile />);
    expect(screen.queryByText(translate("zh", "profile.rules"))).toBeNull();
  });
});
