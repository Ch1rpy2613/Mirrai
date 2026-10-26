import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The farewell letter.
 *
 * Two things are checked here. The first is that the letter is still
 * written when the model cannot be reached — the ritual does not fail
 * because a provider is misconfigured. The second is that the two-pass
 * letter is used when it can be, and that the fallback is written down
 * when it cannot: a fallback nobody can count is a fallback nobody can
 * notice.
 */
const getMemoriesByPersonaId = vi.fn();
const getLatestChatSummary = vi.fn();

vi.mock("../db", () => ({
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
}));

const retrieveMemories = vi.fn();
vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

// The two passes go through the service; the single-pass letter goes
// straight to the provider. Both are stubbed separately, because which
// one answered is the difference between the two paths.
const invokeWithProvider = vi.fn();
const defaultInvoke = vi.fn();
vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => defaultInvoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

const providerInvoke = vi.fn();
const resolveProviderForUser = vi.fn();
vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

/**
 * The two-pass path, behind a seam.
 *
 * The two passes catch their own failures, so the one failure they do
 * not catch — the caller has to survive it — can only be reached by
 * breaking the path itself. Everything else about it stays real.
 */
const twoPass = vi.hoisted(() => vi.fn());
const realTwoPass = vi.hoisted(() => ({
  value: null as null | typeof import("./farewell-candidates").writeFarewellLetterInTwoPasses,
}));

vi.mock("./farewell-candidates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./farewell-candidates")>();
  realTwoPass.value = actual.writeFarewellLetterInTwoPasses;
  return {
    ...actual,
    writeFarewellLetterInTwoPasses: (...a: unknown[]) => twoPass(...a),
  };
});

import {
  buildFarewellPrompt,
  writeFarewellLetter,
  writeFarewellLetterWithStatus,
  fallbackFarewellLetter,
} from "./farewell";
import { FAREWELL_TWO_PASS_TIMEOUT_MS } from "./farewell-candidates";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  llmProvider: null,
  personaData: {
    personality: "温柔",
    speakingStyle: "慢慢说",
    catchphrases: ["嗯"],
    nickname: "宝贝",
  },
} as any;

const CANDIDATE_LINES = ["我一直都知道。", "对不起，现在才说。"];

describe("the context the letter is written from", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twoPass.mockImplementation(realTwoPass.value as any);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: (...a: unknown[]) => providerInvoke(...a),
    });
  });

  it("is the same material the conversation would have had", async () => {
    retrieveMemories.mockResolvedValue([
      {
        id: 1,
        title: "她的生日",
        description: "11月3日",
        category: "memory",
        subject: "them",
      },
    ]);

    const prompt = await buildFarewellPrompt({ persona, userId: 1 });

    expect(prompt.systemPrompt).toContain("她的生日");
    expect(prompt.systemPrompt).toContain("温柔");
    expect(prompt.memoryCount).toBe(1);
    expect(prompt.userPrompt).toContain("小A");
  });

  it("is written in the language the letter is written in", async () => {
    const prompt = await buildFarewellPrompt({ persona, userId: 1, locale: "en" });

    expect(prompt.userPrompt).toContain("farewell letter");
    expect(prompt.userPrompt).toContain("小A");
  });
});

describe("the letter", () => {
  /** The console's warnings, so the fallback can be counted. */
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    twoPass.mockImplementation(realTwoPass.value as any);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: (...a: unknown[]) => providerInvoke(...a),
    });
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("is the letter the two passes wrote", async () => {
    invokeWithProvider
      .mockResolvedValueOnce(CANDIDATE_LINES.join("\n"))
      .mockResolvedValueOnce(
        JSON.stringify({
          letter: "我一直都知道。",
          kept: ["我一直都知道。"],
          removed: ["对不起，现在才说。"],
        }),
      );

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("我一直都知道。");
    // The single-pass letter is the fallback, not the answer.
    expect(providerInvoke).not.toHaveBeenCalled();
  });

  it("falls back to the single-pass letter, and says why", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    providerInvoke.mockResolvedValue("单遍写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("单遍写的信");
    // The fallback is written down, with its reason, so that how often it
    // happens can be counted.
    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(logged).toContain("Farewell fallback");
    expect(logged).toContain("model-failed");
  });

  it("writes the fallback down in a line that can be counted", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    providerInvoke.mockResolvedValue("单遍写的信");

    await writeFarewellLetter({ persona, userId: 1 });

    // The format is stable, so the reasons can be counted separately.
    expect(warn.mock.calls.map((call: unknown[]) => String(call[0]))).toContain(
      "[Graduation] Farewell fallback for persona 1: model-failed.",
    );
  });

  it("falls back when the first pass finds nothing, and says why", async () => {
    invokeWithProvider.mockResolvedValue("");
    providerInvoke.mockResolvedValue("单遍写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("单遍写的信");
    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(logged).toContain("empty-candidates");
  });

  it("still gives the user a letter when no provider answers", async () => {
    resolveProviderForUser.mockResolvedValue(undefined);
    invokeWithProvider.mockRejectedValue(new Error("no provider"));
    defaultInvoke.mockRejectedValue(new Error("no provider"));

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe(fallbackFarewellLetter(persona));
  });

  it("falls to the server's provider when the user's provider fails", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    providerInvoke.mockRejectedValue(new Error("the user's provider is down"));
    defaultInvoke.mockResolvedValue("服务器写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    // The user's key first, the server's second: a misconfigured provider
    // must not cost the goodbye its letter.
    expect(letter).toBe("服务器写的信");
  });

  it("writes the letter with the server's provider when the user has none", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    resolveProviderForUser.mockResolvedValue(undefined);
    defaultInvoke.mockResolvedValue("服务器写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("服务器写的信");
  });

  it("still gives the user a letter when every provider answers with nothing", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    providerInvoke.mockResolvedValue("   ");
    defaultInvoke.mockResolvedValue("");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    // The user is not handed an error page at the moment they said
    // goodbye.
    expect(letter).toBe(fallbackFarewellLetter(persona));
  });

  it("writes the letter without the memories when the context cannot be assembled", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    getMemoriesByPersonaId.mockResolvedValue(undefined as any);
    providerInvoke.mockResolvedValue("单遍写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("单遍写的信");
    // The short prompt is used: the letter still has to be written.
    const messages = providerInvoke.mock.calls[0][0];
    expect(messages[1].content).toContain("200-400字");
    expect(messages[1].content).not.toContain("走过了很长的路");
  });

  it("still writes the letter when the two-pass path blows up", async () => {
    twoPass.mockRejectedValue(new Error("the two-pass path exploded"));
    providerInvoke.mockResolvedValue("单遍写的信");

    const letter = await writeFarewellLetter({ persona, userId: 1 });

    expect(letter).toBe("单遍写的信");
    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(logged).toContain("two-pass-unavailable");
  });

  it("does not wait for a provider that never answers", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockImplementation(() => new Promise(() => {}));
      providerInvoke.mockResolvedValue("单遍写的信");

      const pending = writeFarewellLetter({ persona, userId: 1 });
      await vi.advanceTimersByTimeAsync(FAREWELL_TWO_PASS_TIMEOUT_MS + 10);
      const letter = await pending;

      expect(letter).toBe("单遍写的信");
      const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
      expect(logged).toContain("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes the fallback letter in the language the letter is written in", () => {
    expect(fallbackFarewellLetter(persona, "en")).toContain("Dear one");
    expect(fallbackFarewellLetter(persona, "en")).toContain("小A");
  });
});

describe("the letter and whether it is the full one", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    twoPass.mockImplementation(realTwoPass.value as any);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: (...a: unknown[]) => providerInvoke(...a),
    });
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("keeps what the second pass kept and what it cut", async () => {
    invokeWithProvider
      .mockResolvedValueOnce(CANDIDATE_LINES.join("\n"))
      .mockResolvedValueOnce(
        JSON.stringify({
          letter: "我一直都知道。",
          kept: ["我一直都知道。"],
          removed: ["对不起，现在才说。"],
        }),
      );

    const result = await writeFarewellLetterWithStatus({ persona, userId: 1 });

    // The subtraction is the interesting half of the writing, so it is
    // kept rather than dropped on the floor.
    expect(result.degraded).toBe(false);
    expect(result.letter).toBe("我一直都知道。");
    expect(result.draft).toEqual({
      kept: ["我一直都知道。"],
      removed: ["对不起，现在才说。"],
    });
  });

  it("says that the letter is the simplified one, and why", async () => {
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));
    providerInvoke.mockResolvedValue("单遍写的信");

    const result = await writeFarewellLetterWithStatus({ persona, userId: 1 });

    // The interface has to be able to say that the user is reading a
    // plainer thing, rather than quietly showing one.
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("model-failed");
    expect(result.letter).toBe("单遍写的信");
    expect(result.draft).toBeUndefined();
  });

  it("falls back to the simpler letter when the two passes answer with nothing", async () => {
    // The two passes are supposed to degrade themselves; this is the
    // shape of the answer when they do not, and the caller still has to
    // give the user a letter.
    twoPass.mockResolvedValue({ letter: "   ", draft: null, degraded: false });
    providerInvoke.mockResolvedValue("单遍写的信");

    const result = await writeFarewellLetterWithStatus({ persona, userId: 1 });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("two-pass-unavailable");
    expect(result.letter).toBe("单遍写的信");
  });
});
