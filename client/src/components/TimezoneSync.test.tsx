// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The server's idea of the user's clock.
 *
 * The app used the server's clock, so a user in Shanghai was told it
 * was the middle of the night at three in the afternoon. The browser
 * already knows the answer; this sends it once.
 *
 * And when the request fails, it is tried again — the comment promised
 * "a few times", and the code stopped after the first failure.
 */

const mutate = vi.fn();

let authenticated = true;
let timezone: string | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      updateProfile: { useMutation: () => ({ mutate }) },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: authenticated ? { id: 1, timezone } : null,
    isAuthenticated: authenticated,
    loading: false,
  }),
}));

import TimezoneSync from "./TimezoneSync";

describe("the timezone sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated = true;
    timezone = null;
    mutate.mockReset();
  });

  it("sends the browser's own zone", () => {
    render(<TimezoneSync />);

    expect(mutate).toHaveBeenCalledTimes(1);
    const zone = mutate.mock.calls[0][0]?.timezone as string;
    expect(zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("does not send anything when the zone is already known", () => {
    timezone = "Asia/Shanghai";

    render(<TimezoneSync />);

    expect(mutate).not.toHaveBeenCalled();
  });

  it("tries again when the request fails", async () => {
    /**
     * The flag was set the other way round: so the *first* failure
     * stopped the retries, and the promise of "tried a few times" was
     * never kept. The user was left with the server's clock — the
     * midnight problem this component exists to solve — and no second
     * attempt.
     */
    mutate.mockImplementation((_values: unknown, callbacks: any) => {
      callbacks?.onError?.(new Error("the server does not know that zone"));
    });

    render(<TimezoneSync />);

    await waitFor(() => {
      expect(mutate.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("gives up after three attempts", async () => {
    mutate.mockImplementation((_values: unknown, callbacks: any) => {
      callbacks?.onError?.(new Error("the server does not know that zone"));
    });

    render(<TimezoneSync />);

    await waitFor(() => {
      expect(mutate.mock.calls.length).toBe(3);
    });
    // And then it stops.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mutate.mock.calls.length).toBe(3);
  });
});
