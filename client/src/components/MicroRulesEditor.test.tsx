// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The rules.
 *
 * The rule that matters here is the one the user can refuse: a rule the
 * model mined and the person never looked at must not go into the
 * prompt, and a rule the person deleted must not come back. The test is
 * what says so.
 */
const save = vi.fn();
const mine = vi.fn();

let rules: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    microRule: {
      list: { useQuery: () => ({ data: { rules }, refetch: vi.fn() }) },
      save: { useMutation: () => ({ mutate: save, isPending: false }) },
      mine: { useMutation: () => ({ mutate: mine, isPending: false }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/** The language the editor is read in. */
let locale: "zh" | "en" = "zh";

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate(locale, key, params),
    locale,
    localeName: locale === "en" ? "English" : "中文",
    setLocale: () => {},
  }),
}));

import MicroRulesEditor from "./MicroRulesEditor";

describe("the rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rules = [];
    locale = "zh";
  });

  it("does not put Chinese punctuation into the English interface", async () => {
    /**
     * The confirmation joined the triggers with the Chinese separator —
     * in every language. So an English reader was asked to delete a
     * rule whose triggers were listed as "a、b".
     */
    locale = "en";
    rules = [
      {
        id: "r1",
        trigger: [" raining", "rain"],
        meaning: "talks about the weather",
        rendering: "answers with the forecast",
        verified: true,
        source: "manual",
      },
    ];
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<MicroRulesEditor personaId={1} />);

    await user.click(screen.getByLabelText(translate("en", "microRules.delete")));

    expect(confirm).toHaveBeenCalled();
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain(", ");
    expect(message).not.toContain("、");
  });

  it("does not let the user write past what the server takes", async () => {
    /**
     * The fields had no limits of their own: so a person wrote six
     * hundred characters into a field the server takes five hundred,
     * and the save was refused with a message about a validation error
     * rather than about their own text.
     */
    const user = userEvent.setup();
    render(<MicroRulesEditor personaId={1} />);

    await user.click(screen.getByRole("button", { name: translate("zh", "microRules.add") }));

    const meaning = screen.getByLabelText(translate("zh", "microRules.meaning")) as HTMLTextAreaElement;
    expect(meaning.maxLength).toBe(500);

    const rendering = screen.getByLabelText(translate("zh", "microRules.rendering")) as HTMLTextAreaElement;
    expect(rendering.maxLength).toBe(500);
  });

  it("says so when there are no rules yet", () => {
    render(<MicroRulesEditor personaId={1} />);
    expect(screen.getByText(translate("zh", "microRules.empty"))).toBeInTheDocument();
  });

  it("shows a rule and the message it was read off", () => {
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷，不解释",
        confidence: 0.8,
        source: "auto",
        verified: false,
        evidence: [{ at: "2024-03-02", snippet: "随便你" }],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    expect(screen.getByText("她真的生气了")).toBeInTheDocument();
    expect(screen.getByText(/更短、更冷/)).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "microRules.unverified"))).toBeInTheDocument();
  });

  it("lets the user confirm a mined rule", async () => {
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短",
        confidence: 0.8,
        source: "auto",
        verified: false,
        evidence: [],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    await userEvent.click(
      screen.getByText(translate("zh", "microRules.confirm")),
    );

    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.rules[0].verified).toBe(true);
  });

  it("does not lose the first change when two changes come in quick succession", async () => {
    // The list comes from the server, and the server is only refreshed
    // after a save has come back — so the second request was built from
    // the list as it was *before* the first change, and the first change
    // was undone. The user was told "saved" twice.
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短",
        confidence: 0.8,
        source: "auto",
        verified: false,
        evidence: [],
      },
      {
        id: "r2",
        trigger: ["随便"],
        meaning: "她只是累了",
        rendering: "更软",
        confidence: 0.8,
        source: "auto",
        verified: false,
        evidence: [],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    const confirmButtons = screen.getAllByText(translate("zh", "microRules.confirm"));
    await userEvent.click(confirmButtons[0]);
    await userEvent.click(confirmButtons[1]);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const first = save.mock.calls[0][0].rules;
    const second = save.mock.calls[1][0].rules;
    // The second request carries both changes.
    expect(second.find((r: any) => r.id === "r1").verified).toBe(true);
    expect(second.find((r: any) => r.id === "r2").verified).toBe(true);
  });

  it("lets the user change a rule they already confirmed", async () => {
    // A rule the user confirmed is a rule the user wrote — and a rule
    // they wrote is one they can change. Without this, a mined rule they
    // half agree with can only be confirmed whole or thrown away.
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    await userEvent.click(screen.getByLabelText(translate("zh", "microRules.edit")));
    const meaning = await screen.findByDisplayValue("她真的生气了");
    await userEvent.clear(meaning);
    await userEvent.type(meaning, "她只是在赌气");
    await userEvent.click(screen.getByText(translate("zh", "microRules.save")));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    // The rule is replaced, not duplicated, and it keeps its id.
    expect(sent.rules).toHaveLength(1);
    expect(sent.rules[0].id).toBe("r1");
    expect(sent.rules[0].meaning).toBe("她只是在赌气");
  });

  it("lets the user delete a rule", async () => {
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [],
      },
      {
        id: "r2",
        trigger: ["嗯嗯"],
        meaning: "心情好",
        rendering: "连发三条",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    const deleteButtons = screen.getAllByRole("button", {
      name: translate("zh", "microRules.delete"),
    });
    expect(deleteButtons).toHaveLength(2);

    // A rule is removed after the user is asked — everywhere else in
    // the app a destructive click asks first.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(deleteButtons[0]);
    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent.rules).toHaveLength(1);
    expect(sent.rules[0].id).toBe("r2");
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("keeps the rule when the user says no", async () => {
    rules = [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [],
      },
    ];
    render(<MicroRulesEditor personaId={1} />);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: translate("zh", "microRules.delete") }));

    expect(save).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("refuses to save a rule that is missing half of itself", async () => {
    render(<MicroRulesEditor personaId={1} />);

    await userEvent.click(screen.getByText(translate("zh", "microRules.add")));
    await userEvent.click(screen.getByText(translate("zh", "microRules.save")));

    expect(save).not.toHaveBeenCalled();
  });

  it("mines new candidates from the records", async () => {
    render(<MicroRulesEditor personaId={1} />);

    await userEvent.click(screen.getByText(translate("zh", "microRules.mine")));

    await waitFor(() => expect(mine).toHaveBeenCalled());
    expect(mine.mock.calls[0][0]).toMatchObject({ personaId: 1 });
  });
});
