// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The emotion report.
 *
 * It is the one place that says how many days the user talked to their
 * persona — so a zero in it is a claim about their own history.
 */

const report: {
  data: any;
  isError: boolean;
  isLoading: boolean;
} = { data: undefined, isError: false, isLoading: false };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    emotion: {
      getReport: { useQuery: () => report },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { EmotionReport } from "./Chat";

describe("the emotion report", () => {
  beforeEach(() => {
    report.data = undefined;
    report.isError = false;
    report.isLoading = false;
  });

  it("does not claim the user never talked when the request failed", () => {
    // The error was only rendered further down, under the chart — so
    // the two big numbers at the top said "0 chat days" and "0
    // messages" about a conversation the user could see.
    report.isError = true;

    render(<EmotionReport personaId={1} personaName="小A" onClose={() => {}} />);

    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("does not claim the user never talked while the request is on its way", () => {
    report.isLoading = true;

    render(<EmotionReport personaId={1} personaName="小A" onClose={() => {}} />);

    expect(screen.queryByText("0")).toBeNull();
  });

  it("moves the focus with the selection in the range", async () => {
    // The buttons are a roving tabindex — so the one the focus was on
    // became tabIndex={-1} and aria-checked "false", and the newly
    // selected one became tabIndex={0} without being focused. The focus
    // ring stayed on the old option while the selection moved.
    const user = userEvent.setup();
    report.data = {
      totalDays: 12,
      totalMessages: 340,
      snapshots: [],
      distribution: [],
      trend: [],
    };

    render(<EmotionReport personaId={1} personaName="小A" onClose={() => {}} />);

    const options = screen.getAllByRole("radio");
    expect(options.length).toBe(2);
    // The 30-day range is the one that is chosen to begin with.
    expect(options[1].getAttribute("aria-checked")).toBe("true");
    options[1].focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => {
      const after = screen.getAllByRole("radio");
      // The selection moved to the 7-day range...
      expect(after[0].getAttribute("aria-checked")).toBe("true");
      // ...and the focus moved with it.
      expect(document.activeElement).toBe(after[0]);
    });
  });

  it("shows the numbers when the report arrives", () => {
    report.data = {
      totalDays: 12,
      totalMessages: 340,
      snapshots: [],
      distribution: [],
      trend: [],
    };

    render(<EmotionReport personaId={1} personaName="小A" onClose={() => {}} />);

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
  });
});
