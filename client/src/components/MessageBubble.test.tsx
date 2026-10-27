// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The message bubble.
 *
 * A message is the user's own. Being able to copy it, quote it, fix it,
 * repeat it and remove it is what makes a conversation a conversation rather
 * than a transcript — and none of that was tested, because the component
 * used to live inside a two-thousand-line page where it could not be
 * reached.
 *
 * What is worth testing here is the behaviour a person can see: which
 * buttons a message has (they are not the same for the two sides), that
 * editing hands back the new text and can be abandoned, and that the
 * persona's side can be repeated while the user's side cannot.
 */
vi.mock("@/lib/trpc", () => ({
  trpc: {
    chat: {
      tts: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      voices: { useQuery: () => ({ data: { voices: [] } }) },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The markdown renderer pulls in a stylesheet, which the test environment
// cannot load. The bubble only needs it to render the persona's words, so
// it is stood in for.
//
// The plugin chain is exported as well, because the safe chain is built
// from it — see `client/src/lib/safe-markdown.ts`.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
  defaultRehypePlugins: { harden: {}, raw: {}, katex: {} },
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

/**
 * The user's own clock.
 *
 * The times on the messages were the browser's — so on a machine whose
 * zone is not the user's, every message carried a different time from
 * the dates around it.
 */
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, timezone: "America/New_York" },
    isAuthenticated: true,
    loading: false,
    logout: vi.fn(),
  }),
}));

import { MessageBubble, type Message } from "./MessageBubble";

/** A message, in the shape the chat page builds it. */
function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    role: "assistant",
    content: "在的。",
    createdAt: new Date("2026-01-02T03:04:00Z"),
    ...overrides,
  };
}

/** Every callback, so a test can assert on the one it cares about. */
function callbacks() {
  return {
    onRegenerate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onQuote: vi.fn(),
  };
}

describe("the message bubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the time in the user's own clock", () => {
    /**
     * Ten at night in New York is three in the morning there, and two
     * in the afternoon in Shanghai.
     */
    render(
      <MessageBubble
        msg={makeMessage({ createdAt: new Date("2026-01-02T03:04:00Z") })}
        personaName="小A"
        showMood={false}
      />,
    );
    // The interface is in Chinese here, so the clock is a 24-hour one.
    expect(screen.getByText("22:04")).toBeInTheDocument();
  });

  it("shows what was said", () => {
    render(
      <MessageBubble msg={makeMessage({ content: "今天过得怎么样？" })} personaName="小A" showMood={false} />,
    );
    expect(screen.getByText("今天过得怎么样？")).toBeInTheDocument();
  });

  it("copies the message", async () => {
    const user = userEvent.setup();
    // `userEvent.setup()` installs its own clipboard stub, so the mock has
    // to go in afterwards. `navigator.clipboard` is a read-only property in
    // jsdom, so it has to be defined rather than assigned.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <MessageBubble msg={makeMessage({ content: "在的。" })} personaName="小A" showMood={false} />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.copy")));

    expect(writeText).toHaveBeenCalledWith("在的。");
  });

  it("quotes the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage()}
        personaName="小A"
        showMood={false}
        onQuote={handlers.onQuote}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.quote")));

    expect(handlers.onQuote).toHaveBeenCalled();
  });

  it("offers to repeat the persona's reply, and not the user's", () => {
    const handlers = callbacks();

    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "assistant" })}
        personaName="小A"
        showMood={false}
        onRegenerate={handlers.onRegenerate}
      />,
    );
    expect(screen.getByLabelText(translate("zh", "chat.regenerate"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user" })}
        personaName="小A"
        showMood={false}
        onRegenerate={handlers.onRegenerate}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.regenerate"))).toBeNull();
  });

  it("offers to edit the user's own message, and not the persona's", () => {
    const handlers = callbacks();

    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "user" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );
    expect(screen.getByLabelText(translate("zh", "chat.edit"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "assistant" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.edit"))).toBeNull();
  });

  it("hands back the edited text", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "在吗？");
    await user.click(screen.getByText(translate("zh", "common.save")));

    expect(handlers.onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ content: "在吗" }),
      "在吗？",
    );
  });

  it("gives up the edit when the user changes their mind", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    await user.click(screen.getByText(translate("zh", "common.cancel")));

    expect(handlers.onEdit).not.toHaveBeenCalled();
    // The original text is back.
    expect(screen.getByText("在吗")).toBeInTheDocument();
  });

  it("will not save an edit that emptied the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage({ role: "user", content: "在吗" })}
        personaName="小A"
        showMood={false}
        onEdit={handlers.onEdit}
      />,
    );

    await user.click(screen.getByLabelText(translate("zh", "chat.edit")));
    await user.clear(screen.getByRole("textbox"));

    expect(screen.getByText(translate("zh", "common.save"))).toBeDisabled();
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it("removes the message", async () => {
    const user = userEvent.setup();
    const handlers = callbacks();

    render(
      <MessageBubble
        msg={makeMessage()}
        personaName="小A"
        showMood={false}
        onDelete={handlers.onDelete}
      />,
    );
    await user.click(screen.getByLabelText(translate("zh", "chat.delete")));

    expect(handlers.onDelete).toHaveBeenCalled();
  });

  it("shows what the message is quoting", () => {
    render(
      <MessageBubble
        msg={makeMessage({ replyToContent: "你昨天说的那家店" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText("你昨天说的那家店")).toBeInTheDocument();
  });

  it("shows which memories were recalled", () => {
    render(
      <MessageBubble
        msg={makeMessage({
          recalled: [
            { id: 1, title: "你们第一次看的那部电影", subject: "them" },
            { id: 2, title: "她养的那只猫", subject: "them" },
          ],
        })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.recalled", { count: 2 }))).toBeInTheDocument();
    // The memory is listed with a bullet in front of it.
    expect(screen.getByText(/你们第一次看的那部电影/)).toBeInTheDocument();
    expect(screen.getByText(/她养的那只猫/)).toBeInTheDocument();
  });

  it("says where an ordinary-looking message really came from", () => {
    // A reply to a letter, and a message the persona started, look like
    // any other turn unless the bubble says so.
    const { unmount } = render(
      <MessageBubble
        msg={makeMessage({ role: "user", origin: "letter" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.letterSent"))).toBeInTheDocument();
    unmount();

    render(
      <MessageBubble
        msg={makeMessage({ role: "assistant", origin: "proactive" })}
        personaName="小A"
        showMood={false}
      />,
    );
    expect(screen.getByText(translate("zh", "chat.spokeFirst"))).toBeInTheDocument();
  });

  it("does not offer the actions while the message is still arriving", () => {
    render(
      <MessageBubble
        msg={makeMessage({ isStreaming: true, createdAt: undefined })}
        personaName="小A"
        showMood={false}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(translate("zh", "chat.delete"))).toBeNull();
  });
});
