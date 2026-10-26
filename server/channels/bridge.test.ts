import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The bridge between a channel and a persona.
 *
 * It is the one place that knows how a conversation behaves outside the
 * web interface, and it is where the two notes about the farewell used
 * to collide: the bridge appended one and each channel appended another,
 * so the user received two instructions to type "/毕业" at the end of
 * one message.
 */
const getPersonaById = vi.fn();
const runConversation = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("../chat/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat/service")>();
  return {
    ...actual,
    runConversation: (...a: unknown[]) => runConversation(...a),
  };
});

import { handleChannelChat } from "./bridge";
import { copy } from "@shared/copy";

/** The events a conversation yields when it answers. */
async function* answers(text: string, graduationSuggested = false) {
  yield { type: "delta", text };
  yield { type: "done", messageId: 1, graduationSuggested };
}

describe("the bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 7,
      name: "小A",
      analysisStatus: "ready",
      graduationStatus: null,
    });
  });

  it("mentions the ritual once when the app has decided a farewell is due", async () => {
    runConversation.mockImplementation(() => answers("在的。", true));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    const note = copy("zh", "channels.graduationNote");
    expect(reply).toContain(note);
    expect(reply!.split(note).length - 1).toBe(1);
  });

  it("mentions the ritual once when the persona is already waiting for one", async () => {
    getPersonaById.mockResolvedValue({
      id: 7,
      name: "小A",
      analysisStatus: "ready",
      graduationStatus: "suggested",
    });
    runConversation.mockImplementation(() => answers("在的。"));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    const note = copy("zh", "channels.graduationNote");
    expect(reply).toContain(note);
    expect(reply!.split(note).length - 1).toBe(1);
  });

  it("says nothing about the ritual when no farewell is due", async () => {
    runConversation.mockImplementation(() => answers("在的。"));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    expect(reply).toBe("在的。");
  });
});
