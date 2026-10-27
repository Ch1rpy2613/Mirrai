// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    render(<RelationshipTimeline personaId={7} />);
    expect(screen.getByText(translate("zh", "relationship.empty"))).toBeInTheDocument();
  });

  it("shows the date in the user's own calendar", () => {
    /**
     * Three in the morning in Greenwich is ten at night the day before
     * in New York — so the day an event is filed on depends on whose
     * calendar it is read in.
     */
    query.data = { events: [makeEvent({ happenedAt: "2026-01-02T03:00:00.000Z" })] };
    render(<RelationshipTimeline personaId={7} />);

    expect(screen.getByText("2026/1/1")).toBeInTheDocument();
  });

  it("shows what has been recorded, with its kind", () => {
    query.data = { events: [makeEvent()] };
    render(<RelationshipTimeline personaId={7} />);

    expect(screen.getByText(translate("zh", "relationship.kinds.breakup"))).toBeInTheDocument();
    expect(screen.getByText("我们分手了")).toBeInTheDocument();
    expect(screen.getByText("在一个很普通的晚上")).toBeInTheDocument();
  });

  it("opens a form when the user asks to record something", async () => {
    const user = userEvent.setup();
    render(<RelationshipTimeline personaId={7} />);

    await user.click(screen.getByText(translate("zh", "relationship.add")));

    expect(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(translate("zh", "relationship.detailPlaceholder"))).toBeInTheDocument();
  });

  it("saves what the user wrote", async () => {
    const user = userEvent.setup();
    render(<RelationshipTimeline personaId={7} />);

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
    render(<RelationshipTimeline personaId={7} />);

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
    render(<RelationshipTimeline personaId={7} />);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.type(screen.getByPlaceholderText(translate("zh", "relationship.titlePlaceholder")), "   ");

    expect(screen.getByText(translate("zh", "common.save"))).toBeDisabled();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("closes the form without saving when the user changes their mind", async () => {
    const user = userEvent.setup();
    render(<RelationshipTimeline personaId={7} />);

    await user.click(screen.getByText(translate("zh", "relationship.add")));
    await user.click(screen.getByText(translate("zh", "common.cancel")));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(translate("zh", "relationship.titlePlaceholder")),
      ).toBeNull();
    });
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("removes an entry the user asks to remove", async () => {
    const user = userEvent.setup();
    query.data = { events: [makeEvent({ id: 9 })] };
    // The record is the user's own; it is not thrown away by one click
    // with nothing said.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RelationshipTimeline personaId={7} />);

    await user.click(screen.getByLabelText(translate("zh", "relationship.remove")));

    expect(removeEvent).toHaveBeenCalledWith({ id: 9 });
    confirm.mockRestore();
  });

  it("keeps an entry when the user says no", async () => {
    const user = userEvent.setup();
    query.data = { events: [makeEvent({ id: 9 })] };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RelationshipTimeline personaId={7} />);

    await user.click(screen.getByLabelText(translate("zh", "relationship.remove")));

    expect(removeEvent).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
