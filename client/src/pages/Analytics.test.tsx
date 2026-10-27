// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The statistics page.
 *
 * It is a page about the user's own past, so a zero on it is a claim
 * about their history. The query is disabled until the sign-in request
 * answers — and when that request *fails*, it stays disabled for good,
 * and React Query reports neither "loading" nor "error": there is no
 * data and no attempt to get any.
 *
 * So the page said "0 messages" about a history it simply had not asked
 * for yet.
 */

/** What the query answers. */
const overview = {
  data: undefined as any,
  isLoading: false,
  isPending: false,
  isError: false,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    analytics: {
      overview: { useQuery: () => overview },
    },
  },
}));

/**
 * What the radar chart was given.
 *
 * The chart is asked for the hours of the day — and the hours it was
 * given were every *other* one. So a user who talks at one, three or
 * five in the morning was shown a chart that said they never talk then,
 * and the messages the server had counted were not on it.
 */
let radarData: { hour: string; count: number }[] = [];

vi.mock("recharts", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  const Actual = original.RadarChart;
  return {
    ...original,
    RadarChart: (props: any) => {
      radarData = props.data;
      return Actual ? <Actual {...props} /> : null;
    },
  };
});

/** The sign-in request's answer. */
let authError: Error | null = null;

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: !authError,
    loading: false,
    error: authError,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/analytics", vi.fn()],
  useParams: () => ({}),
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

import Analytics from "./Analytics";

describe("the statistics page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authError = null;
    overview.data = {
      stats: { totalMessages: 42, activeDays: 7, longestStreak: 3, avgPerDay: 6 },
      messageVolume: [],
      emotionTimeline: [],
      moods: [],
    };
    overview.isLoading = false;
    overview.isPending = false;
    overview.isError = false;
  });

  it("does not claim the user has no messages when the query never ran", () => {
    // The sign-in request failed, so the query stayed disabled.
    authError = new Error("the server is down");
    overview.data = undefined;
    overview.isPending = true;

    render(<Analytics />);

    // Not "0 messages".
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("still shows the numbers when the query answered", () => {
    render(<Analytics />);

    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("plots every hour of the day, not every other one", () => {
    /**
     * Messages sent at 1am, 3am and 5am.
     */
    overview.data = {
      stats: { totalMessages: 3, activeDays: 1, longestStreak: 1, avgPerDay: 3 },
      messageVolume: [],
      emotionTimeline: [],
      moods: [],
      hourlyDistribution: [
        { hour: 1, count: 4 },
        { hour: 3, count: 7 },
        { hour: 5, count: 2 },
      ],
    };

    render(<Analytics />);

    // Twenty-four hours.
    expect(radarData).toHaveLength(24);
    // And the odd ones are there, with the counts the server sent.
    expect(radarData.find((row) => row.hour === "1:00")?.count).toBe(4);
    expect(radarData.find((row) => row.hour === "3:00")?.count).toBe(7);
    expect(radarData.find((row) => row.hour === "5:00")?.count).toBe(2);
  });
});
