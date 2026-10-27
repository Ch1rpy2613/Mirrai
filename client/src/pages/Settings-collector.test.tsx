// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The collector panels.
 *
 * Both of them make a claim about what the user has: what has been
 * collected, and what happened to a job. A request that failed says
 * nothing about either — so the panels have to say that they failed.
 */

const preview: { data: any; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const job: { data: any; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    collector: {
      preview: { useQuery: () => preview },
      getJob: { useQuery: () => job },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/**
 * The user's own calendar.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { CollectorPreview, CollectorJobDetail } from "./Settings";

describe("the collector preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.data = undefined;
    preview.isLoading = false;
    preview.isError = false;
  });

  it("does not say nothing has been collected when the request failed", () => {
    // It did: a failed request left the data undefined, and the panel
    // read that as "this persona has collected nothing" — a false
    // claim about the user's own data, with no error and no way to
    // try again.
    preview.isError = true;

    render(<CollectorPreview personaId={1} />);

    expect(screen.queryByText("这个分身还没有采集到任何记录。")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("says nothing has been collected when nothing has", () => {
    preview.data = { total: 0, items: [] };

    render(<CollectorPreview personaId={1} />);

    expect(screen.getByText("这个分身还没有采集到任何记录。")).toBeInTheDocument();
  });
});

describe("the detail of a collection job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    job.data = undefined;
    job.isLoading = false;
    job.isError = false;
  });

  it("does not say it is loading for ever when the request failed", () => {
    // The data stays undefined after a failure — so the panel said
    // "loading…" and kept saying it.
    job.isError = true;

    render(<CollectorJobDetail jobId="job-1" />);

    expect(screen.queryByText("加载中…")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the times in the user's own calendar", () => {
    /**
     * The times were the browser's — so the settings were in a
     * different calendar from the app they belong to.
     */
    job.data = {
      id: "job-1",
      source: "email",
      status: "completed",
      progress: 100,
      messageCount: 12,
      startedAt: "2026-01-02T03:04:00.000Z",
      finishedAt: "2026-01-02T03:05:00.000Z",
    };

    render(<CollectorJobDetail jobId="job-1" />);

    // Ten at night in New York is the next day in Shanghai.
    expect(screen.getAllByText(/2026\/1\/1/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/2026\/1\/2/)).toBeNull();
  });

  it("shows the job when it arrives", () => {
    job.data = {
      id: "job-1",
      source: "email",
      status: "completed",
      progress: 100,
      messageCount: 12,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
    };

    render(<CollectorJobDetail jobId="job-1" />);

    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
