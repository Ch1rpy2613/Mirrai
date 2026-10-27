// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { translate } from "@/i18n";

/**
 * The questionnaire, and the answers it keeps.
 *
 * The answers are kept in the browser so that a reload does not throw
 * ten steps of work away. They are kept under a key that belongs to
 * the person who answered — two people on the same browser used to
 * answer each other's questionnaire.
 *
 * The key can only be that person's once the app knows who they are —
 * and the app did not know on the first render. So the restore ran
 * before the key was right, and the saved answers were never read: a
 * reload started the questionnaire again from nothing.
 */

const createFromQuestionnaire = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    persona: {
      createFromQuestionnaire: {
        useMutation: () => ({ mutateAsync: createFromQuestionnaire, isPending: false }),
      },
    },
  },
}));

/** The signed-in user, as the app sees them. */
let authUser: { id: number } | null = null;

/**
 * The sign-in request answers *after* the first render.
 *
 * That is the ordinary case: the page is drawn, and the answer comes a
 * moment later. The test has to reproduce it, because the whole bug
 * lives in that moment.
 */
vi.mock("@/_core/hooks/useAuth", async () => {
  const React = await import("react");
  return {
    useAuth: () => {
      const [answered, setAnswered] = React.useState(false);
      React.useEffect(() => {
        const timer = setTimeout(() => setAnswered(true), 0);
        return () => clearTimeout(timer);
      }, []);
      const user = answered ? authUser : null;
      return { user, isAuthenticated: Boolean(user), loading: !answered };
    },
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/persona/new/questionnaire", vi.fn()],
  useParams: () => ({}),
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

import Questionnaire from "./Questionnaire";

const KEY = "mirrai-questionnaire";

/** What is in the name field. */
function nameField(): string {
  return (screen.getByLabelText(translate("zh", "questionnaire.fieldName")) as HTMLInputElement).value;
}

describe("the questionnaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authUser = { id: 7 };
  });

  it("reads back the answers the user saved", async () => {
    localStorage.setItem(
      `${KEY}:7`,
      JSON.stringify({ step: 0, answers: { name: "小A" } }),
    );

    render(<Questionnaire />);

    await waitFor(() => {
      expect(nameField()).toBe("小A");
    });
  });

  it("keeps the answers of one person away from another's", async () => {
    localStorage.setItem(
      `${KEY}:7`,
      JSON.stringify({ step: 0, answers: { name: "小A" } }),
    );
    authUser = { id: 8 };

    render(<Questionnaire />);

    await waitFor(() => {
      expect(nameField()).toBe("");
    });
  });

  it("does not read the browser-wide key", async () => {
    // The answers typed before the sign-in request answered were kept
    // under a key that belonged to nobody, and the next person to use
    // the same browser read them back. The per-user key was introduced
    // to close that, and it has to close it completely.
    localStorage.setItem(
      KEY,
      JSON.stringify({ step: 0, answers: { name: "小A" } }),
    );

    render(<Questionnaire />);

    await waitFor(() => {
      expect(nameField()).toBe("");
    });
    // And the browser-wide key is not written to either.
    expect(localStorage.getItem(KEY)).toContain("小A");
    expect(localStorage.getItem(`${KEY}:7`)).toBeNull();
  });
});
