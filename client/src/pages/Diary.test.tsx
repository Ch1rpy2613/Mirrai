// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The diary.
 *
 * "No personas yet — create one in the lobby first" is a claim about
 * the user's own data, and it was made while the list was still being
 * fetched: the query waits for the sign-in request to answer, so for
 * at least one network round trip there was nothing on the screen but
 * that sentence — and a button back to the lobby.
 */

/** The personas the server answers with, and whether the request is on its way. */
let personas: any[] = [];
let personasLoading = false;
let authLoading = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      list: {
        useQuery: () => ({
          data: personas,
          isError: false,
          isLoading: personasLoading,
          refetch: vi.fn(),
        }),
      },
    },
    diary: {
      getDates: { useQuery: () => ({ data: [], isError: false, refetch: vi.fn() }) },
      list: { useQuery: () => ({ data: [], isError: false, refetch: vi.fn() }) },
      getByDate: { useQuery: () => ({ data: undefined, isError: false, refetch: vi.fn() }) },
      hasMessages: { useQuery: () => ({ data: false, isError: false, refetch: vi.fn() }) },
      generate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 1, timezone: "Asia/Shanghai" }, loading: authLoading }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/diary", vi.fn()],
  useRoute: () => ["/diary", vi.fn()],
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import Diary from "./Diary";

describe("the diary", () => {
  beforeEach(() => {
    personas = [];
    personasLoading = false;
    authLoading = false;
  });

  it("does not claim the user has no personas while the list is on its way", () => {
    personasLoading = true;

    render(<Diary />);

    expect(screen.queryByText(translate("zh", "diary.emptyNoPersona"))).toBeNull();
    expect(screen.getByText(translate("zh", "common.loading"))).toBeInTheDocument();
  });

  it("does not claim the user has no personas before the sign-in is answered", () => {
    // The query waits for the sign-in request — so there is a moment
    // where nothing is known at all.
    authLoading = true;

    render(<Diary />);

    expect(screen.queryByText(translate("zh", "diary.emptyNoPersona"))).toBeNull();
  });

  it("says it when the user really has no personas", () => {
    render(<Diary />);

    expect(screen.getByText(translate("zh", "diary.emptyNoPersona"))).toBeInTheDocument();
  });

  it("asks the user to pick one when there are some", () => {
    personas = [{ id: 1, name: "小A" }];

    render(<Diary />);

    expect(screen.getByText(translate("zh", "diary.emptySelect"))).toBeInTheDocument();
  });
});
