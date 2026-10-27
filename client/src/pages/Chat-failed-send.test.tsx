// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * A failed send, and what the screen does with it.
 *
 * The user's own message is stored before the model is called — and it
 * stays there, because the channels depend on it: a person who wrote a
 * message on WeChat cannot have it put back in a composer.
 *
 * So when the turn fails the bubble has to stay. Taking it away *and*
 * saying "the server did not store the message" was a claim that was
 * simply false — and twenty seconds later the poll brought the message
 * back on its own, or the user had retyped it and the transcript had
 * it twice.
 */

vi.mock("@/lib/trpc", () => ({
  trpc: {
    emotion: { getReport: { useQuery: () => ({ data: undefined, isError: false, isLoading: false }) } },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any) => key,
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

import { failedSendKeepsTheMessage } from "./Chat";

describe("a failed send", () => {
  it("leaves the message on the screen when the server stored it", () => {
    expect(failedSendKeepsTheMessage({ success: true, reply: "", failed: true })).toBe(true);
  });

  it("lets the text go back into the composer when nothing was stored", () => {
    // A turn that never started — the rate limit, a validation error.
    // There is nothing in the transcript, so the text has to go back.
    expect(failedSendKeepsTheMessage({ success: true, reply: "在的。" })).toBe(false);
    expect(failedSendKeepsTheMessage(undefined)).toBe(false);
    expect(failedSendKeepsTheMessage(null)).toBe(false);
    expect(failedSendKeepsTheMessage({ failed: false })).toBe(false);
  });
});
