import { describe, expect, it, vi, beforeEach } from "vitest";

const getProactivePersonas = vi.fn();
const getPersonaById = vi.fn();
const createMessage = vi.fn();
const updateMessageChannel = vi.fn();
const updatePersona = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const getLastMessageAt = vi.fn();
const getLastUserMessageAt = vi.fn();
const getRecentUserMood = vi.fn();
const getUserById = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getLastExtractionAt = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();

vi.mock("../db", () => ({
  getProactivePersonas: (...a: unknown[]) => getProactivePersonas(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createMessage: (...a: unknown[]) => createMessage(...a),
  updateMessageChannel: (...a: unknown[]) => updateMessageChannel(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getLastUserMessageAt: (...a: unknown[]) => getLastUserMessageAt(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getLastExtractionAt: (...a: unknown[]) => getLastExtractionAt(...a),
  getUserMessageCountForPersonaSince: (...a: unknown[]) => getUserMessageCountForPersonaSince(...a),
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
}));

const getUserLocale = vi.fn();
getUserLocale.mockResolvedValue("zh");
const getUserTimezone = vi.fn();
getUserTimezone.mockResolvedValue(null);

const invokeWithProvider = vi.fn();
vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: () => { throw new Error("not used"); },
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => null,
  /**
   * The ownership matters: the environment-configured provider is the
   * operator's account, and it may only be used when the user has no
   * provider of their own.
   */
  resolveProviderForUserWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
}));

const send = vi.fn();
vi.mock("../channels", () => ({
  getChannelAdapter: (id: string) => (id === "wechat" ? { id, send } : undefined),
}));

import { runProactiveSweep } from "./proactive-sweep";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
  analysisStatus: "ready",
  presence: "active",
  graduationStatus: null,
  timezone: "Europe/London",
  personaData: {},
} as any;

describe("the sweep that lets the persona speak first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeWithProvider.mockResolvedValue("今天怎么样？");
    createMessage.mockResolvedValue(1);
    updateMessageChannel.mockResolvedValue(undefined);
    getPersonaById.mockResolvedValue(persona);
    getUserById.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLastMessageAt.mockResolvedValue(null);
    getLastUserMessageAt.mockResolvedValue(null);
    getChannelBindingsByUserId.mockResolvedValue([]);
    getLastExtractionAt.mockResolvedValue(null);
    getUserMessageCountForPersonaSince.mockResolvedValue(0);
  });

  it("says nothing when the user never asked it to", async () => {
    getProactivePersonas.mockResolvedValue([]);
    const sent = await runProactiveSweep(new Date("2026-06-01T12:00:00Z"));
    expect(sent).toBe(0);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("writes a message when it is due", async () => {
    getProactivePersonas.mockResolvedValue([{
      id: 1,
      userId: 1,
      name: "小A",
      lastChatAt: new Date("2026-05-01T12:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    }]);

    const sent = await runProactiveSweep(new Date("2026-06-01T12:00:00Z"));

    expect(sent).toBe(1);
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: "今天怎么样？",
      origin: "proactive",
      channel: "web",
    }));
  });

  it("stays quiet when the time has not come", async () => {
    getProactivePersonas.mockResolvedValue([{
      id: 1,
      userId: 1,
      name: "小A",
      lastChatAt: new Date("2026-06-01T11:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    }]);

    const sent = await runProactiveSweep(new Date("2026-06-01T12:00:00Z"));

    expect(sent).toBe(0);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("goes out over the channel that is bound, not only the web", async () => {
    // A message the user only finds by opening the app is a message that
    // arrives too late to matter.
    getProactivePersonas.mockResolvedValue([{
      id: 1,
      userId: 1,
      name: "小A",
      lastChatAt: new Date("2026-05-01T12:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    }]);
    getChannelBindingsByUserId.mockResolvedValue([{
      id: 1,
      userId: 1,
      channel: "wechat",
      targetId: "chat-42",
      personaId: 1,
      isActive: true,
    }]);

    await runProactiveSweep(new Date("2026-06-01T12:00:00Z"));

    expect(send).toHaveBeenCalledWith(1, "chat-42", "今天怎么样？", "zh");
    // The message is stored before it is sent — so that a failure to
    // store it cannot leave a message that was sent but never counted.
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: "今天怎么样？",
      origin: "proactive",
    }));
    // And the channel it went out on is recorded afterwards.
    expect(updateMessageChannel).toHaveBeenCalledWith(expect.any(Number), 1, "wechat");
  });

  it("stays quiet in the quiet hours", async () => {
    // A message that wakes somebody at three in the morning is not the
    // persona being thoughtful — it is the app being inconsiderate, and
    // the quiet hours are the user's own decision about when that is
    // acceptable.
    getProactivePersonas.mockResolvedValue([{
      id: 1,
      userId: 1,
      name: "小A",
      lastChatAt: new Date("2026-05-01T12:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    }]);

    const threeInTheMorning = new Date(2026, 5, 1, 3, 0, 0);
    const sent = await runProactiveSweep(threeInTheMorning);

    expect(sent).toBe(0);
    expect(createMessage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("writes one message, not one a minute, for ever", async () => {
    /**
     * The flood.
     *
     * The sweep measured the silence from the user's last message, and
     * wrote its own message into a *different* column — so the moment
     * it measured from never moved. The deadline stayed in the past,
     * the persona was due again on the very next tick, and it wrote
     * again: a fresh model call, a fresh message, every minute, for
     * ever.
     *
     * The rule it broke is the one the purchase states: the app may
     * not speak first more often than the window the user bought.
     */
    const row: any = {
      id: 1,
      userId: 1,
      name: "小A",
      // The user spoke a long time ago.
      lastUserMessageAt: new Date("2026-05-01T12:00:00Z"),
      // The app has not spoken for even longer.
      lastChatAt: new Date("2026-04-01T12:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    };
    getProactivePersonas.mockResolvedValue([row]);
    // The sweep writes the moment it spoke into the persona's row.
    updatePersona.mockImplementation(async (_id: number, _userId: number, patch: any) => {
      if (patch.lastChatAt) row.lastChatAt = patch.lastChatAt;
    });

    // Ten ticks, a minute apart.
    let written = 0;
    for (let i = 0; i < 10; i++) {
      written += await runProactiveSweep(new Date(Date.UTC(2026, 5, 1, 12, i)));
    }

    // One message, not ten.
    expect(written).toBe(1);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("does not use a channel that carries a different persona", async () => {
    getProactivePersonas.mockResolvedValue([{
      id: 1,
      userId: 1,
      name: "小A",
      lastChatAt: new Date("2026-05-01T12:00:00Z"),
      presence: "active",
      graduationStatus: null,
      proactiveFrequencyHours: 24,
    }]);
    getChannelBindingsByUserId.mockResolvedValue([{
      id: 1,
      userId: 1,
      channel: "wechat",
      targetId: "chat-42",
      personaId: 99,
      isActive: true,
    }]);

    await runProactiveSweep(new Date("2026-06-01T12:00:00Z"));

    expect(send).not.toHaveBeenCalled();
  });
});
