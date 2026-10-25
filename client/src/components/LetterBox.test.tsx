// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The letters.
 *
 * The distinction the whole feature rests on is that a letter you keep
 * and a letter you hand over are not the same act. The interface has to
 * make that visible, and the test is what says so.
 */
const write = vi.fn();
const remove = vi.fn();
const invalidate = vi.fn();

let letters: any[] = [];
let todos: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ letter: { list: { invalidate } } }),
    letter: {
      list: { useQuery: () => ({ data: { letters } }) },
      todos: { useQuery: () => ({ data: { todos } }) },
      write: { useMutation: () => ({ mutate: write, isPending: false }) },
      remove: { useMutation: () => ({ mutate: remove, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import LetterBox from "./LetterBox";

describe("the letters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    letters = [];
    todos = [];
  });

  it("says so when there is nothing written yet", () => {
    render(<LetterBox personaId={1} />);
    expect(screen.getByText(translate("zh", "letters.empty"))).toBeInTheDocument();
  });

  it("keeps a letter and a note for later apart", () => {
    // A kept letter is never answered, and a note for later is never
    // even delivered. The interface has to say which is which.
    todos = [
      { id: 9, body: "等你回来的时候我想说……", kind: "todo", status: "private" },
    ];
    render(<LetterBox personaId={1} />);

    expect(screen.getByText(/等你回来的时候我想说/)).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "letters.todoTitle"))).toBeInTheDocument();
  });

  it("does not offer the same letter twice", () => {
    letters = [{ id: 1, body: "有件事我一直没说。", kind: "letter", status: "waiting" }];
    todos = [{ id: 1, body: "有件事我一直没说。", kind: "todo", status: "private" }];
    render(<LetterBox personaId={1} />);

    // The delivered letter appears once, not twice.
    expect(screen.getAllByText("有件事我一直没说。")).toHaveLength(1);
  });

  it("hands a letter over rather than keeping it, when the person says so", async () => {
    const user = userEvent.setup();
    render(<LetterBox personaId={1} />);

    await user.click(screen.getByText(translate("zh", "letters.write")));
    await user.type(screen.getByPlaceholderText(translate("zh", "letters.placeholder")), "有件事我一直没说。");
    await user.click(screen.getByText(translate("zh", "letters.deliver")));

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "有件事我一直没说。",
        deliver: true,
      }),
    );
  });

  it("keeps a note for later as a note, not as a letter", async () => {
    const user = userEvent.setup();
    render(<LetterBox personaId={1} />);

    await user.click(screen.getByText(translate("zh", "letters.write")));
    await user.type(screen.getByPlaceholderText(translate("zh", "letters.placeholder")), "等你回来的时候我想说……");
    // The toggle picks the kind; the button saves it.
    await user.click(screen.getByText(translate("zh", "letters.kindTodo")));
    await user.click(screen.getByText(translate("zh", "letters.saveTodo")));

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "todo",
        // A note for later is never delivered, and never answered.
        deliver: false,
      }),
    );
  });
});
