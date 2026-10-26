// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The imperfection, per state.
 *
 * The point of this panel is that the six states are *different from
 * each other*. A persona that is imperfect in every state in the same
 * way is a persona with one personality wearing six hats, and the test
 * is what says the six boxes are really there.
 */
const save = vi.fn();

let stored: any[] = [];
let merged: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    imperfection: {
      get: { useQuery: () => ({ data: { stored, merged }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: save, isPending: false }) },
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

import ImperfectionEditor from "./ImperfectionEditor";

/** A complete profile, one entry per state. */
function fullProfile() {
  return [
    { state: "warm", deviations: ["句子更短"] },
    { state: "playful", deviations: ["语气词更多"] },
    { state: "nostalgic", deviations: ["用词更旧"] },
    { state: "melancholy", deviations: ["不解释自己"] },
    { state: "happy", deviations: ["连着发三条"] },
    { state: "distant", deviations: ["极短句"] },
  ];
}

describe("the imperfection, per state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = [];
    merged = fullProfile();
  });

  it("says that the defaults are not applied yet", () => {
    // The six states are filled in with generic defaults, but a default
    // that is only shown is not an active imperfection.
    render(<ImperfectionEditor personaId={1} />);
    expect(
      screen.getByText(translate("zh", "imperfection.notAppliedYet")),
    ).toBeInTheDocument();
  });

  it("stops saying it once the user has set a state", () => {
    stored = [{ state: "distant", deviations: ["极短句"] }];
    render(<ImperfectionEditor personaId={1} />);
    expect(
      screen.queryByText(translate("zh", "imperfection.notAppliedYet")),
    ).toBeNull();
  });

  it("shows a box for every state", () => {
    render(<ImperfectionEditor personaId={1} />);
    expect(screen.getByText(translate("zh", "emotions.warm.label"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "emotions.distant.label"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "emotions.nostalgic.label"))).toBeInTheDocument();
  });

  it("shows what each state looks like", () => {
    render(<ImperfectionEditor personaId={1} />);
    expect(screen.getByDisplayValue("极短句")).toBeInTheDocument();
    expect(screen.getByDisplayValue("连着发三条")).toBeInTheDocument();
  });

  it("does not show the same thing in every state", () => {
    render(<ImperfectionEditor personaId={1} />);
    const values = fullProfile().map((entry) => entry.deviations[0]);
    // Six different deviations, six different boxes.
    expect(new Set(values).size).toBe(6);
  });

  it("writes back what the user changed", async () => {
    render(<ImperfectionEditor personaId={1} />);

    // The value is set directly rather than typed: a full-width
    // semicolon does not survive userEvent's keyboard emulation
    // reliably, and the split on it is the thing under test.
    const box = screen.getByDisplayValue("极短句");
    fireEvent.change(box, { target: { value: "极短句；不解释" } });
    await userEvent.click(screen.getByText(translate("zh", "imperfection.save")));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    const distant = sent.profile.find((entry: any) => entry.state === "distant");
    expect(distant.deviations).toContain("不解释");
  });

  it("keeps the user's own words when the defaults are put back", async () => {
    render(<ImperfectionEditor personaId={1} />);
    // The user has something of their own in one of the states.
    expect(screen.getByDisplayValue("极短句")).toBeInTheDocument();

    await userEvent.click(screen.getByText(translate("zh", "imperfection.restoreDefaults")));

    // Their own words are still there.
    //
    // The button used to put the six generic defaults in the whole
    // draft — so what the user wrote was gone the moment the next Save
    // went through, with no undo. The defaults are a starting point
    // for the states the user has not written anything for; they are
    // not a replacement for what the user wrote.
    expect(screen.getByDisplayValue("极短句")).toBeInTheDocument();
  });

  it("fills a state the user has not written with the default", async () => {
    // The user has written one state, and left the other five empty.
    merged = [
      { state: "distant", deviations: ["极短句"] },
      { state: "warm", deviations: [] },
      { state: "playful", deviations: [] },
      { state: "nostalgic", deviations: [] },
      { state: "melancholy", deviations: [] },
      { state: "happy", deviations: [] },
    ];
    render(<ImperfectionEditor personaId={1} />);

    await userEvent.click(screen.getByText(translate("zh", "imperfection.restoreDefaults")));

    // The gap is filled with the generic default.
    expect(screen.getByDisplayValue(/短句/)).toBeInTheDocument();
  });
});
