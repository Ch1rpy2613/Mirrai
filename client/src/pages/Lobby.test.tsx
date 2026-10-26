// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

/** The personas the server sends back. */
let personas: any[];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    setup: { useQuery: () => ({ data: { hasLlmProvider: true, hasUserProvider: false } }) },
    persona: {
      list: { useQuery: () => ({ data: personas, refetch: listRefetch }) },
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
    user: { username: "测试" },
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
