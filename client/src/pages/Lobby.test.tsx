// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSyncExternalStore } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The lobby, and the pin.
 *
 * Pinning is the one thing a person can do to say "this one first" — and
 * it is not a sort option, it is a property of the persona. A pinned
 * persona sits at the top whatever the list is sorted by, and the sort
 * only decides the order of the ones that are not pinned.
 *
 * That is a small rule and an easy one to break, so it is worth a test.
 */
const update = vi.fn();
const listRefetch = vi.fn();

/**
 * The personas the server sends back.
 *
 * The list is a store of its own, so a test can change it and have
 * the page notice — the way the server's answer changes it.
 */
let personas: any[];
let personasVersion = 0;
const personaListeners = new Set<() => void>();
function subscribePersonas(listener: () => void) {
  personaListeners.add(listener);
  return () => {
    personaListeners.delete(listener);
  };
}
function setPersonas(next: any[]) {
  personas = next;
  personasVersion += 1;
  for (const listener of personaListeners) listener();
}
/** Whether the list is still on its way. */
let personasLoading = false;
/** Whether the list could not be read. */
let personasFailed = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    setup: { useQuery: () => ({ data: { hasLlmProvider: true, hasUserProvider: false } }) },
    persona: {
      list: {
        useQuery: () => {
          // The page notices when the list changes.
          useSyncExternalStore(subscribePersonas, () => personasVersion);
          return {
            data: personas,
            refetch: listRefetch,
            isLoading: personasLoading,
            isError: personasFailed,
          };
        },
      },
      stats: { useQuery: () => ({ data: { totalPersonas: 2, totalChats: 10, todayChats: 1 } }) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createSandbox: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      awaken: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      dailyActivity: { useQuery: () => ({ data: [] }) },
      recentActivity: { useQuery: () => ({ data: [] }) },
    },
    reminder: {
      list: { useQuery: () => ({ data: [] }) },
      dismiss: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    template: {
      list: { useQuery: () => ({ data: [] }) },
      instantiate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    // The user's own zone — the page reads the clock in it.
    user: { username: "测试", timezone: "Asia/Shanghai" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

// The theme comes from a provider the test does not need.
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

// The panels that bring their own data access with them.
vi.mock("@/components/MoodCheckIn", () => ({ default: () => <div /> }));

import Lobby from "./Lobby";

/** A persona, in the shape the server sends it. */
function makePersona(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: "小A",
    relationshipDesc: "前女友",
    analysisStatus: "ready",
    graduationStatus: "active",
    isPinned: false,
    chatCount: 0,
    createdAt: new Date("2026-01-01").toISOString(),
    ...overrides,
  };
}

describe("the lobby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personas = [];
    personasLoading = false;
    personasFailed = false;
  });

  it("does not say the user has no personas while the list is on its way", () => {
    // The query has no answer yet, so there is no list — and "no list"
    // used to mean "no personas", so the page said the user had none
    // and offered to make one. On a slow connection every visit began
    // with an invitation to create a duplicate.
    personas = undefined as any;
    personasLoading = true;

    render(<Lobby />);

    expect(screen.queryByText(translate("zh", "lobby.emptyState.title"))).toBeNull();
  });

  it("says the user has no personas when there are none", () => {
    render(<Lobby />);

    // The empty state is the truth here — the list came back and it was
    // empty.
    expect(screen.getByText(translate("zh", "lobby.emptyState.title"))).toBeInTheDocument();
  });

  it("puts a pinned persona first, whatever the sort is", () => {
    // The unpinned one is the newer of the two, so a plain "recent" sort
    // would put it first. The pin has to beat that.
    personas = [
      makePersona({ id: 1, name: "没置顶的", isPinned: false, createdAt: new Date("2026-06-01").toISOString() }),
      makePersona({ id: 2, name: "置顶的", isPinned: true, createdAt: new Date("2026-01-01").toISOString() }),
    ];

    render(<Lobby />);

    // The name appears in more than one panel, so the card headings are
    // what the order of the list is read from.
    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => text === "置顶的" || text === "没置顶的");
    expect(names).toEqual(["置顶的", "没置顶的"]);
  });

  it("pins and unpins a persona", async () => {
    const user = userEvent.setup();
    personas = [makePersona({ id: 5, name: "小A", isPinned: false })];

    render(<Lobby />);
    await user.click(screen.getByTitle(translate("zh", "lobby.card.pin")));

    expect(update).toHaveBeenCalledWith({ id: 5, isPinned: true });
  });

  it("unpins a persona that was pinned", async () => {
    const user = userEvent.setup();
    personas = [makePersona({ id: 5, name: "小A", isPinned: true })];

    render(<Lobby />);
    await user.click(screen.getByTitle(translate("zh", "lobby.card.pin")));

    expect(update).toHaveBeenCalledWith({ id: 5, isPinned: false });
  });

  it("keeps the order of the ones that are not pinned", () => {
    // The list is sorted by the last conversation by default, so the one
    // you spoke to most recently comes first — and the pinned one comes
    // before both.
    personas = [
      makePersona({
        id: 1,
        name: "甲",
        isPinned: false,
        lastChatAt: new Date("2026-01-01").toISOString(),
      }),
      makePersona({
        id: 2,
        name: "乙",
        isPinned: false,
        lastChatAt: new Date("2026-05-01").toISOString(),
      }),
      makePersona({
        id: 3,
        name: "丙",
        isPinned: true,
        lastChatAt: new Date("2026-03-01").toISOString(),
      }),
    ];

    render(<Lobby />);

    const names = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent)
      .filter((text) => ["甲", "乙", "丙"].includes(text));
    // 丙 is pinned, so it is first even though it was spoken to before 乙.
    // The rest keep the order the sort gave them.
    expect(names).toEqual(["丙", "乙", "甲"]);
  });

  it("puts the focus into the sort menu when it opens", async () => {
    /**
     * The items are reached with the arrow keys, the way a menu's items
     * are — so the focus has to be in the menu.
     *
     * It was not: nothing moved it there, so the arrow-key handler
     * (which lives on the menu) never received a key event, and Tab
     * skipped the items. The order could not be changed at all without
     * a mouse — while the button announced a menu.
     */
    const user = userEvent.setup();
    personas = [makePersona()];

    render(<Lobby />);

    /**
     * The sort button, and not another one whose name happens to
     * contain the same two characters — the persona's quote is one of
     * twelve, and one of them says 「你最近在想什么呢？」.
     */
    const sortButton = screen
      .getAllByRole("button", { name: /最近|recent/i })
      .find((button) => button.getAttribute("aria-haspopup") === "menu");
    expect(sortButton).toBeTruthy();
    await user.click(sortButton!);

    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    // The focus is inside the menu.
    await waitFor(
      () => {
        expect(
          screen.getAllByRole("menuitem").some((item) => document.activeElement === item),
        ).toBe(true);
      },
      { timeout: 3000 },
    );

    // And the arrow keys move between the items.
    await user.keyboard("{ArrowDown}");
    const after = screen.getAllByRole("menuitem");
    expect(after.some((item) => document.activeElement === item)).toBe(true);
  });

  it("greets the user in their own clock", () => {
    /**
     * The hour was the machine's.
     *
     * So the greeting was wrong for up to eight hours a day for
     * anybody whose own zone is not the machine's — and the same page
     * uses the user's stored zone for the heatmap, the streak and the
     * calendar, so the screen disagreed with itself.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Ten at night in Shanghai is two in the afternoon in Greenwich.
    vi.setSystemTime(new Date("2026-03-14T14:00:00Z"));
    // And the machine's own zone is Greenwich, so the machine's hour
    // and the user's hour are not the same.
    const machineZone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      personas = [makePersona()];
      render(<Lobby />);
      // Ten at night in Shanghai — so the night greeting, while the
      // machine's own clock says it is the afternoon.
      expect(screen.getByText(new RegExp(translate("zh", "lobby.greetings.night.text")))).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(translate("zh", "lobby.greetings.afternoon.text")))).toBeNull();
    } finally {
      if (machineZone === undefined) delete process.env.TZ;
      else process.env.TZ = machineZone;
      vi.useRealTimers();
    }
  });

  it("keeps a tab stop in the filter list when the chosen filter disappears", async () => {
    /**
     * A filter whose count fell to zero stopped being drawn — and the
     * selection stayed on it. So no drawn tab had a tab stop, the whole
     * list was skipped by the Tab key, and the directory below showed
     * nothing with no tab looking selected.
     */
    const user = userEvent.setup();
    personas = [
      makePersona({ id: 1, analysisStatus: "analyzing" }),
      makePersona({ id: 2, analysisStatus: "ready" }),
      makePersona({ id: 3, analysisStatus: "ready" }),
    ];

    render(<Lobby />);

    const analysing = screen.getByRole("tab", { name: /解析中/ });
    await user.click(analysing);

    // The one analysing persona is done, so the tab is gone.
    setPersonas([
      makePersona({ id: 1, analysisStatus: "ready" }),
      makePersona({ id: 2, analysisStatus: "ready" }),
      makePersona({ id: 3, analysisStatus: "ready" }),
    ]);
    /**
     * The selection falls back to a tab that is still there — so the
     * list has a tab stop, and the directory below is not empty with
     * no tab looking selected.
     */
    await waitFor(() => {
      const all = screen
        .getAllByRole("tab")
        .find((tab) => /全部/.test(tab.textContent ?? ""));
      expect(all?.getAttribute("aria-selected")).toBe("true");
      expect(all?.getAttribute("tabindex")).toBe("0");
    });
  });

  it("folds the graduated ones away until they are asked for", async () => {
    const user = userEvent.setup();
    personas = [
      makePersona({ id: 1, name: "还在的", graduationStatus: "active" }),
      makePersona({ id: 2, name: "已经毕业的", graduationStatus: "graduated" }),
    ];

    render(<Lobby />);

    // The graduated one is not in the list yet — it is folded away.
    expect(screen.queryByText("已经毕业的")).toBeNull();
    expect(screen.getAllByText("还在的").length).toBeGreaterThan(0);

    // But there is a way to reach it, and it says how many are folded away.
    const toggle = screen.getByText(
      translate("zh", "lobby.directory.graduated", { count: 1 }),
    );
    await user.click(toggle);

    expect(screen.getByText("已经毕业的")).toBeInTheDocument();
  });
});
