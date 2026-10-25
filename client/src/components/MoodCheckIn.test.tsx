// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The mood check-in.
 *
 * This is the first component test in the project. There were none,
 * because there was no DOM to run them in — which meant every piece of
 * interface behaviour was untested, including the parts that are the
 * product: that a person can say how they are in one tap, and that it
 * actually gets recorded.
 */
const mutate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    user: {
      setMood: {
        useMutation: () => ({ mutate, isPending: false }),
      },
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

import MoodCheckIn from "./MoodCheckIn";

describe("the mood check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers every mood, in a language the user can read", () => {
    render(<MoodCheckIn />);

    for (const label of ["很好", "还行", "有点低落", "很难过", "有点不安", "说不上来"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("records the mood with one tap", async () => {
    const user = userEvent.setup();
    render(<MoodCheckIn />);

    await user.click(screen.getByText("很难过"));

    expect(mutate).toHaveBeenCalledWith({ mood: "down", note: undefined });
  });

  it("sends the note along when there is one", async () => {
    const user = userEvent.setup();
    render(<MoodCheckIn />);

    await user.click(screen.getByText("加一句话"));
    await user.type(screen.getByPlaceholderText("想写点什么吗"), "今天有点累");
    await user.click(screen.getByText("有点不安"));

    expect(mutate).toHaveBeenCalledWith({ mood: "anxious", note: "今天有点累" });
  });

  it("does not send an empty note", async () => {
    const user = userEvent.setup();
    render(<MoodCheckIn />);

    await user.click(screen.getByText("加一句话"));
    await user.type(screen.getByPlaceholderText("想写点什么吗"), "   ");
    await user.click(screen.getByText("还行"));

    expect(mutate).toHaveBeenCalledWith({ mood: "okay", note: undefined });
  });

  it("hides the note box when the person changes their mind", async () => {
    const user = userEvent.setup();
    render(<MoodCheckIn />);

    await user.click(screen.getByText("加一句话"));
    expect(screen.getByPlaceholderText("想写点什么吗")).toBeInTheDocument();

    await user.click(screen.getByText("取消"));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("想写点什么吗")).toBeNull();
    });
  });

  it("does not nag in the compact version", () => {
    render(<MoodCheckIn compact />);
    expect(screen.queryByText(translate("zh", "moodCheckIn.hint"))).toBeNull();
  });
});
