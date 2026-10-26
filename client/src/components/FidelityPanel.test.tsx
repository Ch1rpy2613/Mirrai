// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The ruler, and the timing.
 *
 * Two numbers the user cannot otherwise see: whether the rebuilt persona
 * still sounds like the person, and whether the waiting between their
 * messages is theirs or the app's. The panel's job is to show both, and
 * to let the A/B run — because a rule that does not move the numbers
 * does not belong in the prompt.
 */
const measure = vi.fn();
const run = vi.fn();

let profile: any = null;
let lastRun: any = null;

const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    // The panel refreshes the numbers after a run.
    useUtils: () => ({
      eval: { latest: { invalidate: (...a: unknown[]) => invalidate(...a) } },
    }),
    behavior: {
      get: { useQuery: () => ({ data: { profile }, refetch: vi.fn() }) },
      measure: { useMutation: () => ({ mutate: measure, isPending: false }) },
    },
    eval: {
      latest: { useQuery: () => ({ data: { run: lastRun } }) },
      // The last runs, so the two variants can be compared.
      list: { useQuery: () => ({ data: { runs: lastRun ? [lastRun] : [] } }) },
      // The mutation calls its own `onSuccess`, the way the real one
      // does — that is where the numbers are refreshed.
      run: {
        useMutation: (opts: any) => ({
          mutate: (input: any, callbacks?: any) => {
            run(input, callbacks);
            opts?.onSuccess?.({ run: lastRun }, callbacks);
          },
          isPending: false,
        }),
      },
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

import FidelityPanel from "./FidelityPanel";

describe("the ruler and the timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile = null;
    lastRun = null;
  });

  it("says so when the timing has not been measured", () => {
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText(translate("zh", "fidelity.behavior.notMeasured"))).toBeInTheDocument();
  });

  it("shows the timing once it has been measured", () => {
    profile = {
      replyGapMedianSec: 45,
      replyGapLogSigma: 0.6,
      burstSizes: [1, 2],
      proactiveRate: 0.25,
      activeHours: [9],
      samples: 30,
    };
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText("45s")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("measures the timing again on request", async () => {
    render(<FidelityPanel personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.behavior.measure")));
    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(measure.mock.calls[0][0]).toMatchObject({ personaId: 1 });
  });

  it("says so when the ruler has never been run", () => {
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText(translate("zh", "fidelity.noRun"))).toBeInTheDocument();
  });

  it("shows the last run's numbers", () => {
    lastRun = {
      metricsJson: {
        cases: 12,
        overlap: 0.312,
        likelihoodGap: -1.25,
        lengthDistance: 14.5,
        emotionAccuracy: 0.75,
        perState: {},
        scores: [],
      },
    };
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText("0.312")).toBeInTheDocument();
    expect(screen.getByText("-1.250")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("says in words what the likelihood number means", () => {
    // The number is a difference of log-probabilities, and its sign
    // runs the other way from the other three numbers on the panel. A
    // reader who sees "-1.250" next to a label that says "how much like
    // them" would read it as a bad number.
    lastRun = {
      metricsJson: {
        cases: 12,
        overlap: 0.312,
        likelihoodGap: -1.25,
        lengthDistance: 14.5,
        emotionAccuracy: 0.75,
        perState: {},
        scores: [],
      },
    };
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText(translate("zh", "fidelity.likelihoodMore"))).toBeInTheDocument();
  });

  it("says so when the two cannot be told apart", () => {
    lastRun = {
      metricsJson: {
        cases: 12,
        overlap: 0.312,
        likelihoodGap: 0.02,
        lengthDistance: 14.5,
        emotionAccuracy: 0.75,
        perState: {},
        scores: [],
      },
    };
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText(translate("zh", "fidelity.likelihoodSame"))).toBeInTheDocument();
  });

  it("says so when the rebuild falls short", () => {
    lastRun = {
      metricsJson: {
        cases: 12,
        overlap: 0.312,
        likelihoodGap: 2.4,
        lengthDistance: 14.5,
        emotionAccuracy: 0.75,
        perState: {},
        scores: [],
      },
    };
    render(<FidelityPanel personaId={1} />);
    expect(screen.getByText(translate("zh", "fidelity.likelihoodLess"))).toBeInTheDocument();
  });

  it("runs the ruler with the rules on", async () => {
    render(<FidelityPanel personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.run")));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({ personaId: 1, variant: "default" });
  });

  it("shows the numbers of the run it has just made", async () => {
    // The run was never invalidated, so the toast said "done" while the
    // four tiles still showed the run before it — the user had no way
    // to see the result of the run they had just paid for.
    render(<FidelityPanel personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.run")));
    await waitFor(() => expect(run).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ personaId: 1 }));
  });

  it("runs the control — the same persona without its rules", async () => {
    render(<FidelityPanel personaId={1} />);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.withRules")));
    await userEvent.click(screen.getByText(translate("zh", "fidelity.run")));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({ variant: "withoutRules" });
  });
});
