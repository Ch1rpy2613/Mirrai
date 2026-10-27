// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * Editing a persona.
 *
 * Three of the controls on this page exist because the product says the
 * persona is a person and not an assistant, and none of them had a test:
 *
 *   - the **realism** slider — how much the persona writes like somebody
 *     typing rather than like an assistant answering;
 *   - the **proactive** dropdown — how often the persona may speak first,
 *     where zero is a real value;
 *   - the **presence** toggle — whether the persona reaches out at all.
 *
 * The page is a big one, so the test is about the controls rather than the
 * page: what the person sees, and what the server is told.
 */
const update = vi.fn();
const updatePersonaData = vi.fn();
const graduate = vi.fn();
const applyCorrection = vi.fn();
const exportCard = vi.fn();
const importCard = vi.fn();

/** The persona the server sends back. */
let persona: any;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      get: { useQuery: () => ({ data: persona, refetch: vi.fn() }) },
      getSystemPrompt: { useQuery: () => ({ data: { prompt: "【身份】\n你是 小A" } }) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      updatePersonaData: { useMutation: () => ({ mutate: updatePersonaData, isPending: false }) },
      graduate: { useMutation: () => ({ mutate: graduate, isPending: false }) },
      applyCorrection: { useMutation: () => ({ mutate: applyCorrection, isPending: false }) },
      correctionLog: { useQuery: () => ({ data: { entries: [] } }) },
      graduationMode: { useQuery: () => ({ data: { mode: "suggest" } }) },
    },
    personaCard: {
      export: { useMutation: () => ({ mutate: exportCard, isPending: false }) },
      import: { useMutation: () => ({ mutate: importCard, isPending: false }) },
    },
    llmConfig: { listProviders: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/persona/1/edit", vi.fn()],
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

// The two panels that bring their own data access with them.
vi.mock("@/components/RelationshipTimeline", () => ({
  default: () => <div data-testid="relationship-timeline" />,
}));
vi.mock("@/components/LetterBox", () => ({
  default: () => <div data-testid="letter-box" />,
}));
vi.mock("@/components/MicroRulesEditor", () => ({
  default: () => <div data-testid="micro-rules-editor" />,
}));
vi.mock("@/components/ImperfectionEditor", () => ({
  default: () => <div data-testid="imperfection-editor" />,
}));

import PersonaEdit from "./PersonaEdit";

describe("editing a persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persona = {
      id: 1,
      name: "小A",
      analysisStatus: "ready",
      graduationStatus: "active",
      relationshipDesc: "前女友",
      togetherFrom: "2023-01-01",
      togetherTo: null,
      llmProvider: "openai",
      remindersEnabled: true,
      graduationMode: "suggest",
      presence: "active",
      reachability: "reachable",
      proactiveFrequencyHours: 0,
      timezone: "Asia/Shanghai",
      personaData: {
        personality: "温柔",
        speakingStyle: "口语",
        catchphrases: ["嗯嗯"],
        nickname: "宝贝",
        memories: "一起看过的电影",
        attachmentStyle: "安全型",
        loveLanguage: "肯定",
        conflictStyle: "沉默",
        touchingMoments: "",
        customInstructions: "",
        starterQuestions: [],
        realismLevel: 30,
      },
    };
  });

  it("gives every field a name a screen reader can read out", () => {
    // Fifteen of the twenty-four controls on this page had no
    // accessible name at all: the label was not tied to the control, so
    // a screen reader announced "text field" and nothing else — on the
    // page that edits the persona.
    render(<PersonaEdit />);

    const unnamed: string[] = [];
    for (const field of screen.getAllByRole("textbox")) {
      const name = field.getAttribute("aria-label") ?? "";
      const id = field.getAttribute("id");
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      if (!name && !label?.textContent?.trim()) unnamed.push(field.outerHTML.slice(0, 80));
    }
    for (const field of screen.getAllByRole("combobox")) {
      const id = field.getAttribute("id");
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      if (!label?.textContent?.trim()) unnamed.push(field.outerHTML.slice(0, 80));
    }
    expect(unnamed).toEqual([]);
  });

  it("gives the add button a name of its own", () => {
    /**
     * The button that adds a tag had the same name as the field beside
     * it — so a screen reader announced a text field and a button,
     * both called 「口头禅」, with nothing to say that the button adds
     * a tag.
     */
    render(<PersonaEdit />);

    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    const duplicates = names.filter((name) => name && names.filter((n) => n === name).length > 1);
    expect(duplicates).toEqual([]);
    expect(screen.getAllByRole("button", { name: /添加/ }).length).toBeGreaterThan(0);
  });

  it("gives the tag remove button a target big enough to hit", () => {
    /**
     * It was a twelve-pixel cross with nothing around it — so the
     * thing that removes a tag was the smallest thing on the screen,
     * and it was hard to hit on a touch screen and hard to hit at all
     * with a hand that shakes.
     */
    render(<PersonaEdit />);

    const remove = screen.getByRole("button", { name: /嗯嗯/ });
    const size = window.getComputedStyle(remove);
    expect(parseFloat(size.minWidth)).toBeGreaterThanOrEqual(24);
    expect(parseFloat(size.minHeight)).toBeGreaterThanOrEqual(24);
  });

  it("shows the persona's own realism level", () => {
    render(<PersonaEdit />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("30");
    expect(screen.getByText(/真人感 · 30/)).toBeInTheDocument();
  });

  it("saves the realism level the person picked", async () => {
    const user = userEvent.setup();
    render(<PersonaEdit />);

    const slider = screen.getByRole("slider");
    // jsdom does not move a range input when an arrow key is pressed, so
    // the change is fired directly — which is what the browser does.
    fireEvent.change(slider, { target: { value: "35" } });
    expect((slider as HTMLInputElement).value).toBe("35");

    await user.click(screen.getByText(translate("zh", "personaEdit.saveData")));

    expect(updatePersonaData).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        personaData: expect.objectContaining({ realismLevel: 35 }),
      }),
    );
  });

  it("shows how often the persona may speak first", () => {
    render(<PersonaEdit />);
    const select = screen.getByDisplayValue(translate("zh", "proactive.off")) as HTMLSelectElement;
    expect(select.value).toBe("0");
  });

  it("saves the frequency the person picked", async () => {
    const user = userEvent.setup();
    render(<PersonaEdit />);

    await user.selectOptions(
      screen.getByDisplayValue(translate("zh", "proactive.off")),
      "168",
    );
    await user.click(screen.getByText(translate("zh", "personaEdit.saveBasic")));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ proactiveFrequencyHours: 168 }),
    );
  });

  it("keeps zero as a real answer for the frequency", async () => {
    const user = userEvent.setup();
    render(<PersonaEdit />);

    await user.selectOptions(
      screen.getByDisplayValue(translate("zh", "proactive.off")),
      "24",
    );
    await user.selectOptions(
      screen.getByDisplayValue(translate("zh", "proactive.daily")),
      "0",
    );
    await user.click(screen.getByText(translate("zh", "personaEdit.saveBasic")));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ proactiveFrequencyHours: 0 }),
    );
  });

  it("puts the persona on hold without waiting for the save", async () => {
    const user = userEvent.setup();
    render(<PersonaEdit />);

    await user.click(screen.getByText(translate("zh", "presence.hold")));

    // The hold is its own setting: it takes effect at once, so it does not
    // wait for the save button.
    expect(update).toHaveBeenCalledWith({ id: 1, presence: "quiet" });
  });

  it("brings the persona back from a hold", async () => {
    const user = userEvent.setup();
    persona.presence = "quiet";
    render(<PersonaEdit />);

    await user.click(screen.getByText(translate("zh", "presence.holdBack")));

    expect(update).toHaveBeenCalledWith({ id: 1, presence: "active" });
  });
});
