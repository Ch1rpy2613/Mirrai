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
/** What the server answered with when the letter was written. */
let writeResult: any = { success: true, letter: { kind: "letter", status: "private" } };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ letter: { list: { invalidate }, todos: { invalidate } } }),
    letter: {
      list: { useQuery: () => ({ data: { letters } }) },
      todos: { useQuery: () => ({ data: { todos } }) },
      write: {
        useMutation: (options: any) => ({
          mutate: (values: any) => {
            write(values);
            options?.onSuccess?.(writeResult);
          },
          isPending: false,
        }),
      },
      remove: { useMutation: () => ({ mutate: remove, isPending: false }) },
    },
    safety: {
      resources: {
        useQuery: () => ({
          data: {
            resources: [
              {
                id: "cn-national",
                region: "中国大陆",
                description: "全国心理援助热线",
                contact: "12356",
              },
            ],
          },
          isError: false,
          isLoading: false,
        }),
      },
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

/**
 * The user's own calendar.
 *
 * The dates on the letters were the browser's.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

import LetterBox from "./LetterBox";

describe("the letters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    letters = [];
    todos = [];
    writeResult = { success: true, letter: { kind: "letter", status: "private" } };
  });

  it("shows the date in the user's own calendar", () => {
    /**
     * Ten at night in New York is the next day in Shanghai — so the
     * date of a letter depends on whose calendar it is read in.
     */
    letters = [
      {
        id: 1,
        body: "一封信",
        kind: "letter",
        mood: null,
        status: "private",
        createdAt: "2026-01-02T03:04:00.000Z",
      },
    ];
    render(<LetterBox personaId={1} />);
    expect(screen.getByText("2026/1/1")).toBeInTheDocument();
    expect(screen.queryByText("2026/1/2")).toBeNull();
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

  it("offers the support resources when the letter says something alarming", async () => {
    /**
     * A letter is what a person writes when they cannot say it any
     * other way — so the server reads it, and when it finds crisis
     * language the resources are shown here, the way they are for the
     * mood check-in and the relationship timeline.
     */
    writeResult = {
      success: true,
      letter: { kind: "letter", status: "private" },
      crisis: true,
    };
    const user = userEvent.setup();
    render(<LetterBox personaId={1} />);

    await user.click(screen.getByText(translate("zh", "letters.write")));
    await user.type(screen.getByPlaceholderText(translate("zh", "letters.placeholder")), "我不想活了");
    await user.click(screen.getByText(translate("zh", "letters.keep")));

    await waitFor(() => {
      expect(screen.getByText("12356")).toBeInTheDocument();
    });
  });

  it("shows no resources for an ordinary letter", async () => {
    const user = userEvent.setup();
    render(<LetterBox personaId={1} />);

    await user.click(screen.getByText(translate("zh", "letters.write")));
    await user.type(screen.getByPlaceholderText(translate("zh", "letters.placeholder")), "今天天气不错。");
    await user.click(screen.getByText(translate("zh", "letters.keep")));

    await waitFor(() => {
      expect(write).toHaveBeenCalled();
    });
    expect(screen.queryByText("12356")).not.toBeInTheDocument();
  });
});
