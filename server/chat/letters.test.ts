import { describe, expect, it, vi, beforeEach } from "vitest";

const createLetter = vi.fn();
const getDueLetters = vi.fn();
const getLastLetterReplyAt = vi.fn();
const answerLetter = vi.fn();
const markLetterUnanswered = vi.fn();
const deferLetter = vi.fn();
const createMessage = vi.fn();
const getPersonaById = vi.fn();
const getUserById = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getUserLocale = vi.fn();

vi.mock("../db", () => ({
  createLetter: (...a: unknown[]) => createLetter(...a),
  getDueLetters: (...a: unknown[]) => getDueLetters(...a),
  getLastLetterReplyAt: (...a: unknown[]) => getLastLetterReplyAt(...a),
  answerLetter: (...a: unknown[]) => answerLetter(...a),
  markLetterUnanswered: (...a: unknown[]) => markLetterUnanswered(...a),
  deferLetter: (...a: unknown[]) => deferLetter(...a),
  createMessage: (...a: unknown[]) => createMessage(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  createSafetyEvent: vi.fn(async () => undefined),
}));

const invokeWithProvider = vi.fn();
vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: () => {
      throw new Error("not used");
    },
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

import { writeLetter, answerDueLetters } from "./letters";
import { resolveReplyAt, earliestAnswerAt, REPLY_DELAY_HOURS } from "@shared/letters";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
} as any;

describe("a letter that is only kept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLetter.mockImplementation(async (p: any) => ({ id: 7, ...p }));
  });

  it("is never answered and never enters the conversation", async () => {
    await writeLetter({
      persona,
      userId: 1,
      body: "有件事我一直没说。",
      deliver: false,
    });

    expect(createLetter).toHaveBeenCalledWith(expect.objectContaining({
      status: "private",
      replyAt: null,
    }));
    // It did not enter the thread. It is a letter in a drawer.
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("a note for later is kept, not delivered", async () => {
    await writeLetter({
      persona,
      userId: 1,
      body: "等你回来的时候我想说……",
      deliver: true,
      kind: "todo",
    });

    expect(createLetter).toHaveBeenCalledWith(expect.objectContaining({
      kind: "todo",
      status: "private",
    }));
    expect(createMessage).not.toHaveBeenCalled();
  });
});

describe("a letter that is handed over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLetter.mockImplementation(async (p: any) => ({ id: 7, ...p }));
  });

  it("is answered a day later, not in three seconds", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const replyAt = resolveReplyAt({ now });
    const hours = (replyAt.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBe(REPLY_DELAY_HOURS);
  });

  it("enters the conversation, so the reply has something to answer", async () => {
    await writeLetter({
      persona,
      userId: 1,
      body: "有件事我一直没说。",
      deliver: true,
    });

    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "user",
      content: "有件事我一直没说。",
      origin: "letter",
    }));
  });

  it("is recorded as waiting for an answer", async () => {
    await writeLetter({
      persona,
      userId: 1,
      body: "有件事我一直没说。",
      deliver: true,
    });

    expect(createLetter).toHaveBeenCalledWith(expect.objectContaining({
      status: "waiting",
    }));
    const letter = createLetter.mock.calls[0][0] as any;
    expect(letter.replyAt).toBeInstanceOf(Date);
  });
});

describe("the gap between two answers", () => {
  it("waits twelve hours after the last reply", () => {
    const last = new Date("2026-06-01T12:00:00Z");
    const now = new Date("2026-06-01T18:00:00Z");
    const earliest = earliestAnswerAt(last, now);
    expect(earliest).not.toBeNull();
    expect(earliest!.getTime()).toBe(last.getTime() + 12 * 3_600_000);
  });

  it("does not wait when enough time has passed", () => {
    const last = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-06-01T18:00:00Z");
    expect(earliestAnswerAt(last, now)).toBeNull();
  });
});

describe("answering the letters that are due", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeWithProvider.mockResolvedValue("我知道了。");
    getPersonaById.mockResolvedValue(persona);
    getUserById.mockResolvedValue(null);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLastLetterReplyAt.mockResolvedValue(null);
    getUserLocale.mockResolvedValue("zh");
  });

  it("writes the answer into the conversation, marked as an answer", async () => {
    getDueLetters.mockResolvedValue([{
      id: 7,
      userId: 1,
      personaId: 1,
      body: "有件事我一直没说。",
      kind: "letter",
      status: "waiting",
      replyAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-31T00:00:00Z"),
    }]);

    const answered = await answerDueLetters(new Date("2026-06-02T12:00:00Z"));

    expect(answered).toBe(1);
    expect(answerLetter).toHaveBeenCalledWith(7, 1, "我知道了。", expect.any(Date));
    // The answer lands in the thread, and it is marked as an answer.
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: "我知道了。",
      origin: "letter",
    }));
  });

  it("answers a letter in the language the user reads", async () => {
    getUserLocale.mockResolvedValue("en");
    getPersonaById.mockResolvedValue({ ...persona, name: "Alex" });
    getDueLetters.mockResolvedValue([{
      id: 7,
      userId: 1,
      personaId: 1,
      body: "There is something I never said.",
      kind: "letter",
      status: "waiting",
      replyAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-31T00:00:00Z"),
    }]);

    await answerDueLetters(new Date("2026-06-02T12:00:00Z"));

    // The answer used to be written in Chinese, always.
    expect(invokeWithProvider).toHaveBeenCalled();
    const messages = invokeWithProvider.mock.calls[0][0].messages;
    const system = messages.find((m: any) => m.role === "system");
    expect(system.content).not.toMatch(/[一-鿿]/);
  });

  it("does not answer a letter that says something it cannot answer", async () => {
    // A letter is the most personal thing the app holds, and the one a
    // person writes when they cannot say it any other way. The chat path
    // has always checked the words first; this one did not, so the same
    // sentence got a warm in-character letter and no support resources.
    getDueLetters.mockResolvedValue([{
      id: 7,
      userId: 1,
      personaId: 1,
      body: "我想死。",
      kind: "letter",
      status: "waiting",
      replyAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-31T00:00:00Z"),
    }]);

    const answered = await answerDueLetters(new Date("2026-06-02T12:00:00Z"));

    expect(answered).toBe(1);
    // The model was never asked.
    expect(invokeWithProvider).not.toHaveBeenCalled();
    // The answer carries the resources instead of the persona's voice.
    const reply = answerLetter.mock.calls[0][2] as string;
    expect(reply).toContain("12356");
  });

  it("holds a letter back when the last answer was too recent", async () => {
    getDueLetters.mockResolvedValue([{
      id: 7,
      userId: 1,
      personaId: 1,
      body: "有件事我一直没说。",
      kind: "letter",
      status: "waiting",
      replyAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-31T00:00:00Z"),
    }]);
    getLastLetterReplyAt.mockResolvedValue(new Date("2026-06-02T06:00:00Z"));

    const answered = await answerDueLetters(new Date("2026-06-02T12:00:00Z"));

    expect(answered).toBe(0);
    expect(deferLetter).toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("does not answer a letter for a persona that is gone", async () => {
    getPersonaById.mockResolvedValue(null);
    getDueLetters.mockResolvedValue([{
      id: 7,
      userId: 1,
      personaId: 1,
      body: "有件事我一直没说。",
      kind: "letter",
      status: "waiting",
      replyAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-31T00:00:00Z"),
    }]);

    const answered = await answerDueLetters(new Date("2026-06-02T12:00:00Z"));

    expect(answered).toBe(0);
    expect(markLetterUnanswered).toHaveBeenCalled();
  });
});
