// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * What actually happened in the relationship.
 *
 * These entries are the user's own record of reality — that they fought, got
 * back together, broke up, or are simply out of touch. The app does not
 * guess them; guessing would mean inventing a relationship the user did not
 * have.
 *
 * So the behaviour worth testing is the record itself: what gets saved, what
 * gets removed, and the fact that the user can change their mind before
 * anything is written.
 */
const addEvent = vi.fn();
const removeEvent = vi.fn();
const invalidate = vi.fn();

const query = { data: undefined as any };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      relationship: { list: { invalidate } },
    }),
    relationship: {
      list: { useQuery: () => query },
      add: { useMutation: () => ({ mutate: addEvent, isPending: false }) },
      remove: { useMutation: () => ({ mutate: removeEvent, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/**
 * The user's own calendar.
 *
 * The date of an event is read in the zone the user has chosen — so
 * the browser's own zone is not the rule.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    error: null,
  }),
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

import RelationshipTimeline from "./RelationshipTimeline";
import { ConfirmProvider } from "@/components/ConfirmDialog";

/** A relationship event, in the shape the server sends it. */
function makeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    kind: "breakup",
    title: "我们分手了",
    detail: "在一个很普通的晚上",
    happenedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("the relationship timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.data = undefined;
  });

  it("says so when nothing has been recorded", () => {
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);
    expect(screen.getByText(translate("zh", "relationship.empty"))).toBeInTheDocument();
  });

  it("shows the date in the user's own calendar", () => {
    /**
     * Three in the morning in Greenwich is ten at night the day before
     * in New York — so the day an event is filed on depends on whose
     * calendar it is read in.
     */
    query.data = { events: [makeEvent({ happenedAt: "2026-01-02T03:00:00.000Z" })] };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    expect(screen.getByText("2026/1/1")).toBeInTheDocument();
  });

  it("caps the date at the user's own today", () => {
    /**
     * The cap was the UTC day.
     *
     * So for a user whose day is ahead of Greenwich, the last
     * selectable date was yesterday for the first hours of the day —
     * and an event that happened today could not be recorded on the
     * day it happened.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Two in the morning in Greenwich is ten at night the day before
    // in New York.
    vi.setSystemTime(new Date("2026-03-14T02:00:00Z"));
    try {
      render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);
      // The form is behind the button that opens it.
      const open = screen.getByRole("button", { name: translate("zh", "relationship.add") });
      fireEvent.click(open);
      const input = screen.getByLabelText(translate("zh", "relationship.happenedAt"));
      expect(input).toHaveAttribute("max", "2026-03-13");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says how many entries are not shown", () => {
    /**
     * The list is capped at the newest two hundred, and it said
     * nothing — so a user with three hundred entries saw two hundred
     * and had no way of knowing that a hundred of the oldest were
     * behind them. The record of their own relationship looked
     * complete.
     */
    query.data = {
      events: [makeEvent()],
      total: 300,
    };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    expect(
      screen.getByText(translate("zh", "relationship.moreEntries", { count: 299 })),
    ).toBeInTheDocument();
  });

  it("says nothing about missing entries when there are none", () => {
    query.data = {
      events: [makeEvent()],
      total: 1,
    };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    expect(
      screen.queryByText(translate("zh", "relationship.moreEntries", { count: 0 })),
    ).toBeNull();
  });

  it("shows what has been recorded, with its kind", () => {
    query.data = { events: [makeEvent()] };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    expect(screen.getByText(translate("zh", "relationship.kinds.breakup"))).toBeInTheDocument();
    expect(screen.getByText("我们分手了")).toBeInTheDocument();
    expect(screen.getByText("在一个很普通的晚上")).toBeInTheDocument();
  });

  it("opens a form when the user asks to record something", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByText(translate("zh", "relationship.add")));

    expect(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(translate("zh", "relationship.detailPlaceholder"))).toBeInTheDocument();
  });

  it("saves what the user wrote", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.type(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder")), "上周复合了");
    await user.selectOptions(
      screen.getByRole("combobox"),
      translate("zh", "relationship.kinds.reunion"),
    );
    await user.type(screen.getByPlaceholderText(translate("zh", "relationship.detailPlaceholder")), "在楼下说的");
    await user.click(screen.getByText(translate("zh", "common.save")));

    expect(addEvent).toHaveBeenCalledWith({
      personaId: 7,
      kind: "reunion",
      title: "上周复合了",
      detail: "在楼下说的",
    });
  });

  it("leaves the detail out when there is none", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.type(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder")), "  出差两周  ");
    await user.click(screen.getByText(translate("zh", "common.save")));

    expect(addEvent).toHaveBeenCalledWith({
      personaId: 7,
      kind: "news",
      title: "出差两周",
      detail: undefined,
    });
  });

  it("will not save an entry with no title", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.type(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder")), "   ");

    expect(screen.getByText(translate("zh", "common.save"))).toBeDisabled();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("closes the form without saving when the user changes their mind", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.click(screen.getByText(translate("zh", "common.cancel")));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(translate("zh", "relationship.titlePlaceholder")),
      ).toBeNull();
    });
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("gives the remove button a target big enough to hit", () => {
    /**
     * It was twenty-two pixels across — two short of what the
     * accessibility rules ask for, and the thing that removes a record
     * of the user's own life is not the place to save two pixels.
     */
    query.data = { events: [makeEvent({ id: 9 })] };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    const button = screen.getByLabelText(translate("zh", "relationship.remove"));
    const size = window.getComputedStyle(button);
    expect(parseFloat(size.minWidth)).toBeGreaterThanOrEqual(24);
    expect(parseFloat(size.minHeight)).toBeGreaterThanOrEqual(24);
  });

  it("removes an entry the user asks to remove", async () => {
    const user = userEvent.setup();
    query.data = { events: [makeEvent({ id: 9 })] };
    // The record is the user's own; it is not thrown away by one click
    // with nothing said.
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByLabelText(translate("zh", "relationship.remove")));
    // The app's own dialog, and the person says yes.
    await user.click(screen.getByRole("button", { name: translate("zh", "common.confirm") }));

    await waitFor(() => expect(removeEvent).toHaveBeenCalledWith({ id: 9 }));
  });

  it("keeps an entry when the user says no", async () => {
    const user = userEvent.setup();
    query.data = { events: [makeEvent({ id: 9 })] };
    render(<ConfirmProvider><RelationshipTimeline personaId={7} /></ConfirmProvider>);

    await user.click(screen.getByLabelText(translate("zh", "relationship.remove")));
    // The person says no.
    await user.click(screen.getByRole("button", { name: translate("zh", "common.cancel") }));

    expect(removeEvent).not.toHaveBeenCalled();
  });
});
