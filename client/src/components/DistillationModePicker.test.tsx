// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The distillation preset picker.
 *
 * The presets are a radio group, so the arrow keys are what moves
 * inside it. The buttons are marked unavailable rather than switched
 * off — so they keep the focus and the arrow keys keep working — and
 * that meant the arrow keys had to be guarded like the click was.
 */

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import DistillationModePicker from "./DistillationModePicker";

describe("the distillation preset picker", () => {
  it("does not change the preset while a write is in flight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DistillationModePicker value="standard" onChange={onChange} disabled />,
    );

    const selected = screen.getByRole("radio", { checked: true });
    selected.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");

    // The click is guarded, and so is the keyboard.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still moves with the arrow keys when it is not disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <DistillationModePicker value="standard" onChange={onChange} />,
    );

    screen.getByRole("radio", { checked: true }).focus();
    await user.keyboard("{ArrowDown}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).not.toBe("standard");
  });
});
