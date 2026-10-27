// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The data tab.
 *
 * It is the one place where the app says what it is about to destroy —
 * so the numbers in it have to be true. A request that failed says
 * nothing about what the user has.
 */

const accountStats: { data: any; isError: boolean } = { data: undefined, isError: false };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      getAccountStats: { useQuery: () => accountStats },
      deleteAccount: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    chat: {
      exportAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false, logout: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/pwa", () => ({
  isInstallAvailable: () => false,
  onInstallAvailabilityChange: () => () => {},
  promptInstall: vi.fn(),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { DataManagementTab } from "./Settings";

describe("the data tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountStats.data = undefined;
    accountStats.isError = false;
  });

  it("does not say the user has nothing when the counts could not be read", () => {
    /**
     * The one dialog that must not lie about what is about to be
     * destroyed said "0 personas, 0 messages, 0 files" when the
     * request failed.
     */
    accountStats.isError = true;

    render(<DataManagementTab />);

    fireEvent.click(screen.getByRole("button", { name: translate("zh", "settings.data.deleteTitle") }));

    const dialog = screen.getByText(translate("zh", "settings.data.confirmBodyUnknown"));
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "settings.data.confirmBody", {
      personas: 0, messages: 0, files: 0,
    }))).toBeNull();
  });

  it("says what is about to be destroyed", () => {
    accountStats.data = { totalPersonas: 3, totalMessages: 120, totalFiles: 2 };

    render(<DataManagementTab />);

    fireEvent.click(screen.getByRole("button", { name: translate("zh", "settings.data.deleteTitle") }));

    expect(
      screen.getByText(translate("zh", "settings.data.confirmBody", {
        personas: 3, messages: 120, files: 2,
      })),
    ).toBeInTheDocument();
  });
});
