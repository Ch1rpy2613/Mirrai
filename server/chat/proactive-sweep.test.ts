import { describe, expect, it, vi, beforeEach } from "vitest";

const getProactivePersonas = vi.fn();
const getPersonaById = vi.fn();
const createMessage = vi.fn();
const updatePersona = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const getLastMessageAt = vi.fn();
const getRecentUserMood = vi.fn();
const getUserById = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getLastExtractionAt = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();

vi.mock("../db", () => ({
  getProactivePersonas: (...a: unknown[]) => getProactivePersonas(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createMessage: (...a: unknown[]) => createMessage(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
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
    getPersonaById.mockResolvedValue(persona);
    getUserById.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLastMessageAt.mockResolvedValue(null);
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
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: "wechat",
    }));
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
