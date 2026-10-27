// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
