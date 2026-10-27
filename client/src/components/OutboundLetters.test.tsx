// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { translate } from "@/i18n";

/**
 * The way out.
 *
 * The contract this component has to keep is narrow and absolute: the
 * app collects the user's own words and hands them back, and it never
 * sends anything. There is no "send" button here — there is an "I said
 * it" button, which is a different thing — and there is somewhere for a
 * letter to go when the other person is not there any more.
 */
const collect = vi.fn();
const markSent = vi.fn();
const drop = vi.fn();
const keepForSelf = vi.fn();
const updateText = vi.fn();
const markStaleNotified = vi.fn();

let letters: any[] = [];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    outbound: {
      list: { useQuery: () => ({ data: { letters }, refetch: vi.fn() }) },
      collect: { useMutation: () => ({ mutate: collect, isPending: false }) },
      markSent: { useMutation: () => ({ mutate: markSent, isPending: false }) },
      drop: { useMutation: () => ({ mutate: drop, isPending: false }) },
      keepForSelf: { useMutation: () => ({ mutate: keepForSelf, isPending: false }) },
      markStaleNotified: { useMutation: () => ({ mutate: markStaleNotified, isPending: false }) },
      updateText: { useMutation: () => ({ mutate: updateText, isPending: false }) },
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

import OutboundLetters from "./OutboundLetters";
import { ConfirmProvider } from "@/components/ConfirmDialog";

describe("the way out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    letters = [];
  });

  it("says so when there is nothing to take back", () => {
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText(translate("zh", "outbound.empty"))).toBeInTheDocument();
  });

  it("shows the user's own words", () => {
    letters = [
      {
        id: 1,
        status: "ready",
        text: "我其实很害怕你离开我",
        sourceMessageId: 12,
        createdAt: new Date().toISOString(),
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText("我其实很害怕你离开我")).toBeInTheDocument();
  });

  it("never offers to send anything", () => {
    // The absence of a send button is the whole contract. The app
    // collects and hands back; the person in the conversation is the one
    // who says it.
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.queryByText(translate("zh", "outbound.markSent"))).toBeTruthy();
    expect(screen.queryByText(/发送|send/i)).toBeNull();
  });

  it("looks through the conversation for what was only said here", async () => {
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.collect")));
    await waitFor(() => expect(collect).toHaveBeenCalled());
    expect(collect.mock.calls[0][0]).toMatchObject({ personaId: 1 });
  });

  it("records that the user said it", async () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.markSent")));
    await waitFor(() => expect(markSent).toHaveBeenCalled());
    expect(markSent.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it("gives a letter somewhere to go when the other person is not there", async () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    await userEvent.click(screen.getByText(translate("zh", "outbound.forSelf")));
    await waitFor(() => expect(keepForSelf).toHaveBeenCalled());
  });

  it("mentions a letter that has been waiting too long", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [{ id: 1, status: "ready", text: "一句话", createdAt: old }];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.getByText(/不会自己消失/)).toBeInTheDocument();
  });

  it("says it once — and records that it said it", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [{ id: 1, status: "ready", text: "一句话", createdAt: old }];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);

    await waitFor(() => expect(markStaleNotified).toHaveBeenCalled());
    expect(markStaleNotified.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it("does not say it again once it has been said", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    letters = [
      {
        id: 1,
        status: "ready",
        text: "一句话",
        createdAt: old,
        staleNotifiedAt: new Date().toISOString(),
      },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    // It was said before, in another session. Saying it again would be
    // nagging, and nagging is the one thing this product promises not
    // to do.
    expect(screen.queryByText(/不会自己消失/)).toBeNull();
  });

  it("does not mention a letter that was just written", () => {
    letters = [
      { id: 1, status: "ready", text: "一句话", createdAt: new Date().toISOString() },
    ];
    render(<ConfirmProvider><OutboundLetters personaId={1} /></ConfirmProvider>);
    expect(screen.queryByText(/不会自己消失/)).toBeNull();
  });
});
