// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The front page.
 *
 * It decides whether there is a model service to talk to, and sends the
 * user to the first-run wizard when there is none.
 *
 * The answer is cached, and the cache is not emptied when the user
 * configures a provider — so the page read the answer from *before* the
 * wizard and sent the user straight back into it. The wizard finishes by
 * sending them to the front page, so they went round and round, and
 * pressing "create and upload" again created a second persona.
 *
 * So the decision is made only on an answer that arrived after the page
 * was opened.
 */

const navigate = vi.fn();

/** What the server answers. */
let setupAnswer: { hasLlmProvider: boolean; hasUserProvider: boolean } | undefined;
/** Whether the answer arrived after the page was opened. */
let fetchedAfterMount = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    setup: {
      useQuery: () => ({
        data: setupAnswer,
        isFetchedAfterMount: fetchedAfterMount,
      }),
    },
  },
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

vi.mock("wouter", () => ({
  useLocation: () => ["/", navigate],
}));

vi.mock("@/lib/onboarding", () => ({
  onboardingDismissed: () => false,
}));

vi.mock("@/components/PageLoader", () => ({
  default: () => <div data-testid="loader" />,
}));

vi.mock("./Lobby", () => ({ default: () => <div data-testid="lobby" /> }));
vi.mock("./Landing", () => ({ default: () => <div data-testid="landing" /> }));

import HomePage from "./HomePage";

describe("the front page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAnswer = { hasLlmProvider: false, hasUserProvider: false };
    fetchedAfterMount = true;
  });

  it("sends the user to the wizard when there is no model service", async () => {
    render(<HomePage />);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
    });
  });

  it("leaves the user alone when they have a model service", async () => {
    setupAnswer = { hasLlmProvider: false, hasUserProvider: true };

    render(<HomePage />);

    await waitFor(() => {
      expect(screen_lobby()).toBeTruthy();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not decide on an answer that was already cached", async () => {
    /**
     * The answer the cache holds: no provider — which is what it said
     * before the user configured one.
     */
    setupAnswer = { hasLlmProvider: false, hasUserProvider: false };
    // The fresh answer has not arrived yet.
    fetchedAfterMount = false;

    render(<HomePage />);

    // Nothing was decided on the old answer.
    expect(navigate).not.toHaveBeenCalled();
  });
});

function screen_lobby() {
  return document.querySelector('[data-testid="lobby"]');
}
