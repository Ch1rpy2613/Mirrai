// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The command palette.
 *
 * ⌘K is a promise: everything, in one place. A person looking for
 * something they said six months ago does not remember which
 * conversation it was in — so the search has to cross conversations, and
 * it has to say what kind of thing each result is, because a message and
 * a memory look nothing alike once they are in a list.
 */
const navigate = vi.fn();
let personas: any[] = [];
let results: any[] = [];

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: { list: { useQuery: () => ({ data: personas }) } },
    chat: { searchAll: { useQuery: () => ({ data: results }) } },
  },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import CommandPalette from "./CommandPalette";

describe("the command palette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personas = [];
    results = [];
  });

  it("stays out of the way until it is asked for", () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeNull();
  });

  it("opens on the keyboard shortcut", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(translate("zh", "commandPalette.placeholder"))).toBeNull();
    });
  });

  it("shows what kind of thing each result is", async () => {
    const user = userEvent.setup();
    results = [
      { id: 1, kind: "message", title: "", content: "在吗", personaName: "小A" },
      { id: 2, kind: "memory", title: "第一次见面", content: "在图书馆门口", personaName: "小A" },
    ];
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByPlaceholderText(translate("zh", "commandPalette.placeholder")), "见");

    await waitFor(() => {
      expect(screen.getByText("第一次见面")).toBeInTheDocument();
    });
    // A memory and a message are different things. A message is the
    // expected one and needs no label; anything else is marked, so the
    // list cannot be mistaken for a list of things that were said.
    expect(screen.getByText(translate("zh", "commandPalette.kinds.memory"))).toBeInTheDocument();
    expect(screen.queryByText(translate("zh", "commandPalette.kinds.message"))).toBeNull();
  });

  it("lists the personas when there is nothing to search for", async () => {
    const user = userEvent.setup();
    personas = [{ id: 1, name: "小A", relationshipDesc: "前女友" }];
    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    await waitFor(() => {
      expect(screen.getByText("小A")).toBeInTheDocument();
    });
  });
});
