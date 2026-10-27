// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The window that offers the farewell.
 *
 * It has two phases: the offer, and the letter. In the first phase the
 * app is offering something and every way out of the window is a
 * refusal — that has to be recorded, or the app offers it again on the
 * next turn.
 *
 * In the second phase the letter has already been written and the
 * persona has already graduated, and closing the window is not a
 * refusal at all. It used to be recorded as one: the escape key, the
 * backdrop and the ✕ all called the same handler, so one Escape
 * keypress after the most important moment of the product left the
 * persona "declined" with a farewell letter and a graduation date — and
 * it could not be un-graduated any more.
 */
const graduate = vi.fn();
const decline = vi.fn();
const onClose = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      graduate: {
        useMutation: (opts: any) => ({
          mutate: (input: any) => {
            graduate(input);
            opts?.onSuccess?.({ farewellLetter: "亲爱的，这是信里的话。" });
          },
          isPending: false,
        }),
      },
      declineGraduation: {
        useMutation: (opts: any) => ({
          mutate: (input: any) => {
            decline(input);
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
}));

import GraduationModal from "./GraduationModal";

function renderModal(variant: "suggest" | "manual" = "suggest") {
  return render(
    <GraduationModal
      personaId={1}
      personaName="小A"
      open
      onClose={onClose}
      variant={variant}
    />,
  );
}

describe("the window that offers the farewell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a refusal when the offer is closed", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByLabelText(translate("zh", "common.close")));

    await waitFor(() => expect(decline).toHaveBeenCalledWith({ id: 1 }));
  });

  it("does not record a refusal when the backdrop is clicked", async () => {
    /**
     * A click on the backdrop is not a considered "no, thank you": it
     * is a mis-aimed click, or a click meant for something behind the
     * window. And the refusal is *recorded* — the persona is marked as
     * "declined", and the offer does not come back for a while.
     */
    const user = userEvent.setup();
    const { container } = renderModal();

    // The dimmed area behind the window.
    const backdrop = container.querySelector(".absolute.inset-0") as HTMLElement;
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(decline).not.toHaveBeenCalled();
  });

  it("does not record a refusal after the letter has been written", async () => {
    const user = userEvent.setup();
    renderModal();

    // The letter is written first.
    await user.click(screen.getByText(translate("zh", "graduation.begin")));
    await waitFor(() =>
      expect(screen.getByText(/亲爱的，这是信里的话。/)).toBeInTheDocument(),
    );

    // And then the window is closed. That is not a refusal.
    await user.click(screen.getByLabelText(translate("zh", "common.close")));

    expect(decline).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves the focus into the window and gives it back on close", async () => {
    const user = userEvent.setup();
    // Something outside the window that had the focus.
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    // The window is closed by the page, so the page is what owns it.
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <GraduationModal
          personaId={1}
          personaName="小A"
          open={open}
          onClose={() => setOpen(false)}
          variant="suggest"
        />
      );
    }
    render(<Harness />);

    // The focus is inside the window now, not on the page behind it.
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");

    // And it goes back where it came from.
    await waitFor(() => expect(document.activeElement).toBe(outside));
    outside.remove();
  });

  it("does not record a refusal when the escape key is pressed after the letter", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText(translate("zh", "graduation.begin")));
    await waitFor(() =>
      expect(screen.getByText(/亲爱的，这是信里的话。/)).toBeInTheDocument(),
    );

    await user.keyboard("{Escape}");

    expect(decline).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
