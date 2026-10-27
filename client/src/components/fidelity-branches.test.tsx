// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";
import { toast } from "sonner";

/**
 * The branches the interface takes.
 *
 * Every component here has a path where the answer is "nothing" — no
 * rules were mined, no letter was found, the timing could not be
 * measured. Those paths are the ones a user meets when something is
 * missing, which is exactly when the interface has to be clear.
 */
const mine = vi.fn();
const collect = vi.fn();
const measure = vi.fn();
const run = vi.fn();

let minedRules: any[] = [];
let collected = 0;
let measuredProfile: any = null;
let lastRun: any = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    // The panels refresh their own queries after a run.
    useUtils: () => ({
      eval: { latest: { invalidate: vi.fn() } },
      behavior: { get: { invalidate: vi.fn() } },
    }),
    microRule: {
      list: { useQuery: () => ({ data: { rules: [] }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      mine: {
        useMutation: (opts: any) => ({
          mutate: (args: any) => mine(args, opts),
          isPending: false,
        }),
      },
    },
    imperfection: {
      get: {
        useQuery: () => ({
          data: { stored: [], merged: [] },
          refetch: vi.fn(),
        }),
      },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    outbound: {
      list: { useQuery: () => ({ data: { letters: [] }, refetch: vi.fn() }) },
      collect: {
        useMutation: (opts: any) => ({
          mutate: (args: any) => collect(args, opts),
          isPending: false,
        }),
      },
      markSent: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      drop: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      keepForSelf: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markStaleNotified: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      updateText: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    behavior: {
      get: { useQuery: () => ({ data: { profile: null }, refetch: vi.fn() }) },
      measure: {
        useMutation: (opts: any) => ({
          mutate: (args: any) => measure(args, opts),
          isPending: false,
        }),
      },
    },
    eval: {
      latest: { useQuery: () => ({ data: { run: lastRun } }) },
      // The last runs, so the two variants can be compared.
      list: { useQuery: () => ({ data: { runs: lastRun ? [lastRun] : [] } }) },
      run: {
        useMutation: (opts: any) => ({
          mutate: (args: any) => run(args, opts),
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

import MicroRulesEditor from "./MicroRulesEditor";
import OutboundLetters from "./OutboundLetters";
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

import FidelityPanel from "./FidelityPanel";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the branches the interface takes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    minedRules = [];
    collected = 0;
    measuredProfile = null;
    lastRun = null;
    // The mutations answer through the component's own success handler,
    // so the mock has to invoke it.
    mine.mockImplementation((_args: any, opts: any) => {
      opts?.onSuccess?.({ rules: minedRules });
    });
    collect.mockImplementation((_args: any, opts: any) => {
      opts?.onSuccess?.({ saved: collected, note: "" });
    });
    measure.mockImplementation((_args: any, opts: any) => {
      opts?.onSuccess?.({ profile: measuredProfile });
    });
    run.mockImplementation((_args: any, opts: any) => {
      opts?.onSuccess?.({ metrics: { overlap: 0.3 } });
    });
  });

  it("says so when the mining found nothing", async () => {
    minedRules = [];
    render(<ConfirmProvider><MicroRulesEditor personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "microRules.mine")));
    await waitFor(() =>
      expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
        translate("zh", "microRules.minedNone"),
      ),
    );
  });

  it("says how many candidates the mining found", async () => {
    minedRules = [{ id: "auto-1" }];
    render(<ConfirmProvider><MicroRulesEditor personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "microRules.mine")));
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        translate("zh", "microRules.mined", { count: 1 }),
      ),
    );
  });

  it("says so when the search found nothing to take back", async () => {
    collected = 0;
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.collect")));
    await waitFor(() =>
      expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
        translate("zh", "outbound.collectedNone"),
      ),
    );
  });

  it("says how many words the search found", async () => {
    collected = 3;
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.collect")));
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        translate("zh", "outbound.collected", { count: 3 }),
      ),
    );
  });

  it("says so when the timing could not be measured", async () => {
    measuredProfile = null;
    render(<ConfirmProvider><FidelityPanel personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.behavior.measure")));
    await waitFor(() =>
      expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
        translate("zh", "fidelity.behavior.notMeasured"),
      ),
    );
  });

  it("says nothing when the timing was measured", async () => {
    measuredProfile = {
      replyGapMedianSec: 45,
      replyGapLogSigma: 0.6,
      burstSizes: [1],
      proactiveRate: 0.1,
      activeHours: [9],
      samples: 30,
    };
    render(<ConfirmProvider><FidelityPanel personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "fidelity.behavior.measure")));
    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(vi.mocked(toast.info)).not.toHaveBeenCalled();
  });

  it("reports a failure instead of pretending it worked", async () => {
    mine.mockImplementation((_args: any, opts: any) => {
      opts?.onError?.(new Error("provider exploded"));
    });
    render(<ConfirmProvider><MicroRulesEditor personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "microRules.mine")));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("provider exploded"),
    );
  });
});
