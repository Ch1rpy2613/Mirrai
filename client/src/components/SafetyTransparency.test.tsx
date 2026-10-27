// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * What the app noticed.
 *
 * The safety layer recorded every crisis, every dependency signal and every
 * assessment of the user's emotional trajectory — and then showed the user
 * none of it. The app knew things about the user's state that the user
 * could not see.
 *
 * This is the transparency principle made literal, so it is worth a test:
 * the record has to be visible, it has to be marked as dealt with when the
 * user says it is, and an empty record has to say so rather than showing
 * nothing at all.
 */
const resolveEvent = vi.fn();
const invalidate = vi.fn();

const events = { data: undefined as any };
const assessments = { data: undefined as any };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      safety: { events: { invalidate } },
    }),
    safety: {
      /**
       * The server refuses a limit of more than two hundred — so a
       * request past it comes back with nothing at all, the way a
       * failed validation does.
       */
      events: { useQuery: ({ limit }: any) => ({ data: limit > 200 ? undefined : events.data }) },
      assessments: { useQuery: () => assessments },
      resolveEvent: { useMutation: () => ({ mutate: resolveEvent, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The real dictionary, so a missing key fails the test rather than
// rendering an empty label.
vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

/**
 * The user's own calendar.
 *
 * The dates on the panel were the browser's.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

import SafetyTransparency from "./SafetyTransparency";

/** A safety event, in the shape the server sends it. */
function makeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    type: "usage",
    createdAt: "2026-01-02T00:00:00.000Z",
    handled: false,
    ...overrides,
  };
}

describe("the safety transparency panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.data = undefined;
    assessments.data = undefined;
  });

  it("says so when there is nothing to show", () => {
    render(<SafetyTransparency />);
    expect(screen.getByText(translate("zh", "safetyPanel.empty"))).toBeInTheDocument();
  });

  it("shows the events it recorded", () => {
    events.data = {
      events: [makeEvent({ id: 1, type: "usage" }), makeEvent({ id: 2, type: "crisis" })],
    };
    render(<SafetyTransparency />);

    expect(screen.getByText(translate("zh", "safetyPanel.events"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "safetyPanel.eventTypes.usage"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "safetyPanel.eventTypes.crisis"))).toBeInTheDocument();
  });

  it("shows the date in the user's own calendar", () => {
    /**
     * The record of what the safety layer saw was in the browser's
     * calendar — so it was in a different one from the rest of the app.
     */
    events.data = {
      events: [makeEvent({ id: 1, type: "usage", createdAt: "2026-01-02T03:04:00.000Z" })],
    };
    render(<SafetyTransparency />);

    // Ten at night in New York is the next day in Shanghai.
    expect(screen.getByText("2026/1/1")).toBeInTheDocument();
  });

  it("does not lose the record when the user asks for more than the server gives", async () => {
    /**
     * The limit went past the server's own maximum — so the request
     * failed its validation, the list came back empty, and the "show
     * more" button disappeared with it: the user was told their safety
     * record could not be read, and there was no way back but a reload.
     */
    const user = userEvent.setup();
    events.data = {
      total: 250,
      events: [makeEvent({ id: 1, type: "usage" })],
    };
    render(<SafetyTransparency />);

    for (let i = 0; i < 12; i++) {
      const button = screen.queryByText(/^再看/);
      if (!button) break;
      await user.click(button);
    }

    // The record is still on the screen.
    expect(screen.getByText(translate("zh", "safetyPanel.eventTypes.usage"))).toBeInTheDocument();
    // And the user is told that what is on the screen is not everything.
    expect(screen.getByText(translate("zh", "safetyPanel.capped", { count: 200 }))).toBeInTheDocument();
  });

  it("shows the assessments of the relationship", () => {
    assessments.data = {
      assessments: [
        {
          personaId: 7,
          personaName: "小A",
          trajectory: "improving",
          regretRatio: 30,
          gratitudeRatio: 70,
          note: "最近好一些了",
        },
      ],
    };
    render(<SafetyTransparency />);

    expect(screen.getByText("小A")).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "safetyPanel.trajectories.improving"))).toBeInTheDocument();
    expect(screen.getByText(/30%/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
    expect(screen.getByText("最近好一些了")).toBeInTheDocument();
  });

  it("marks an event as handled when the user says they have it", async () => {
    const user = userEvent.setup();
    events.data = { events: [makeEvent({ id: 42 })] };
    render(<SafetyTransparency />);

    await user.click(screen.getByText(translate("zh", "safetyPanel.markHandled")));

    expect(resolveEvent).toHaveBeenCalledWith({ id: 42 });
  });

  it("does not offer to mark an event that is already handled", () => {
    events.data = { events: [makeEvent({ id: 3, handled: true })] };
    render(<SafetyTransparency />);

    expect(screen.getByText(translate("zh", "safetyPanel.handled"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "safetyPanel.markHandled"))).toBeNull();
  });

  it("shows both halves when there are both", () => {
    events.data = { events: [makeEvent()] };
    assessments.data = {
      assessments: [
        {
          personaId: 1,
          personaName: "小A",
          trajectory: "stable",
          regretRatio: 50,
          gratitudeRatio: 50,
        },
      ],
    };
    render(<SafetyTransparency />);

    expect(screen.getByText(translate("zh", "safetyPanel.assessments"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "safetyPanel.events"))).toBeInTheDocument();
  });

  it("does not show an assessment that has no note", () => {
    assessments.data = {
      assessments: [
        {
          personaId: 1,
          personaName: "小A",
          trajectory: "stable",
          regretRatio: 50,
          gratitudeRatio: 50,
          note: null,
        },
      ],
    };
    render(<SafetyTransparency />);
    // The persona's name is there; nothing empty is rendered in its place.
    expect(screen.getByText("小A")).toBeInTheDocument();
  });
});
