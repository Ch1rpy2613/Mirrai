// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The onboarding.
 *
 * The provider list is fetched when the page opens. While it is on its
 * way there is nothing to choose from — so the choice must not be
 * offered yet.
 */

const providers: { data: any; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      setup: { invalidate: vi.fn().mockResolvedValue(undefined) },
    }),
    setup: { useQuery: () => ({ data: { hasLlmProvider: false, hasUserProvider: false } }) },
    llmConfig: {
      listProviders: { useQuery: () => providers },
      list: { useQuery: () => ({ data: [] }) },
      upsert: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    persona: {
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, username: "tester" },
    isAuthenticated: true,
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/onboarding", () => ({
  dismissOnboarding: vi.fn(),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Onboarding from "./Onboarding";

describe("the onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providers.data = undefined;
    providers.isLoading = false;
    providers.isError = false;
  });

  it("does not offer a choice while the list of providers is on its way", () => {
    /**
     * The dropdown was enabled then — so on a slow connection the user
     * pressed "save and continue" and was told "please choose a
     * provider", as if their choice had been wrong, when no choice had
     * ever been offered.
     */
    providers.isLoading = true;

    render(<Onboarding />);

    const select = screen.getByLabelText(translate("zh", "onboarding.providerLabel"))
      ?? screen.getByRole("combobox");
    expect(select).toBeDisabled();
  });

  it("offers the providers once they are there", () => {
    providers.data = [{ name: "openai" }, { name: "deepseek" }];

    render(<Onboarding />);

    const selects = screen.getAllByRole("combobox");
    expect(selects.some((s) => !s.hasAttribute("disabled"))).toBe(true);
  });
});
