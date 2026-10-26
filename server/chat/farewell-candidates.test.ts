import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The farewell letter, written in two passes.
 *
 * The two passes are checked here rather than trusted: the first one has
 * to survive whatever shape the answer comes back in, and the second one
 * has to actually subtract. A second pass that quietly adds a paragraph
 * of new warmth is the failure this whole design exists to prevent, so
 * the test makes it fail loudly.
 */
const getMemoriesByPersonaId = vi.fn();
const getLatestChatSummary = vi.fn();

vi.mock("../db", () => ({
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
}));

// The retrieval reaches into the database; the formatters turn a memory
// into a line of prompt, and they are worth keeping real.
const retrieveMemories = vi.fn();
vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

const invokeWithProvider = vi.fn();
vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

const resolveProviderForUser = vi.fn();
vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  /**
   * The ownership matters: the environment-configured provider is the
   * operator's account, and it may only be used when the user has no
   * provider of their own. A provider that came back is the user's own.
   */
  resolveProviderForUserWithOwnership: async (params: unknown) => {
    const provider = await resolveProviderForUser(params as any);
    return { provider, owned: Boolean(provider) };
  },
}));

import {
  buildFarewellCandidates,
  editFarewellCandidates,
  writeFarewellLetterInTwoPasses,
  parseFarewellCandidates,
  parseFarewellEdit,
  introducesNewContent,
  describePersonaForCandidates,
  cleanCandidateText,
  extractBalanced,
  FAREWELL_TWO_PASS_TIMEOUT_MS,
} from "./farewell-candidates";

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
    catchphrases: ["嗯", "随便"],
    nickname: "宝贝",
  },
} as any;

const CANDIDATE_LINES = [
  "我一直都知道。",
  "对不起，现在才说。",
  "你笑起来很好看。",
];

describe("the first pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: vi.fn(),
    });
    invokeWithProvider.mockResolvedValue(CANDIDATE_LINES.join("\n"));
  });

  it("reads a numbered list", async () => {
    invokeWithProvider.mockResolvedValue(
      "1. 我一直都知道。\n2. 对不起，现在才说。\n3. 你笑起来很好看。",
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("reads a JSON array", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify([
        "我一直都知道。",
        "对不起，现在才说。",
        "你笑起来很好看。",
      ]),
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("reads a JSON array that carries a confidence", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify([{ text: "我一直都知道。", confidence: 0.8 }]),
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("我一直都知道。");
    expect(candidates[0].confidence).toBeCloseTo(0.8);
  });

  it("reads one sentence per line", async () => {
    invokeWithProvider.mockResolvedValue(CANDIDATE_LINES.join("\n"));

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("strips the packaging around a sentence", async () => {
    invokeWithProvider.mockResolvedValue(
      '"我一直都知道。",\n2）对不起，现在才说。',
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual([
      "我一直都知道。",
      "对不起，现在才说。",
    ]);
  });

  it("finds nothing in an answer that is not there", async () => {
    invokeWithProvider.mockResolvedValue("");
    expect(await buildFarewellCandidates({ persona, userId: 1 })).toEqual([]);

    invokeWithProvider.mockResolvedValue("   \n  ");
    expect(await buildFarewellCandidates({ persona, userId: 1 })).toEqual([]);

    // An empty list is an answer: there is nothing to write from.
    invokeWithProvider.mockResolvedValue("[]");
    expect(await buildFarewellCandidates({ persona, userId: 1 })).toEqual([]);
  });

  it("finds nothing in an answer that is broken", async () => {
    invokeWithProvider.mockResolvedValue('[{"text": "我一直都知道。"');
    expect(await buildFarewellCandidates({ persona, userId: 1 })).toEqual([]);
  });

  it("writes the letter with the provider the user chose", async () => {
    await buildFarewellCandidates({
      persona: { ...persona, llmProvider: "OpenAI" },
      userId: 1,
    });

    // A letter written with a key the user never set is a letter the user
    // did not pay for.
    expect(resolveProviderForUser.mock.calls[0][0].providerName).toBe("OpenAI");
  });

  it("writes the candidates from the memories and the persona", async () => {
    retrieveMemories.mockResolvedValue([
      {
        id: 1,
        title: "她的生日",
        description: "11月3日",
        category: "memory",
        subject: "them",
      },
    ]);

    await buildFarewellCandidates({ persona, userId: 1 });

    const messages = invokeWithProvider.mock.calls[0][1].messages;
    const system = messages.find((m: any) => m.role === "system")
      .content as string;
    expect(system).toContain("她的生日");
    expect(system).toContain("温柔");
    // The first pass runs hot. A candidate that could have been said any
    // day is not worth a farewell.
    expect(
      invokeWithProvider.mock.calls[0][1].options.temperature,
    ).toBeGreaterThanOrEqual(1);
  });

  it("reads the same sentence twice as one sentence", () => {
    const candidates = parseFarewellCandidates(
      "我一直都知道。\n我一直都知道。\n你笑起来很好看。",
    );
    expect(candidates.map((c) => c.text)).toEqual([
      "我一直都知道。",
      "你笑起来很好看。",
    ]);
  });

  it("reads the same sentence written with different spaces as one sentence", () => {
    // The spaces are the model's formatting, not the sentence, so the two
    // are the same sentence and one of them is enough.
    const candidates = parseFarewellCandidates("我 一直都知道。\n我一直都知道。");
    expect(candidates.map((c) => c.text)).toEqual(["我 一直都知道。"]);
  });

  it("reads a JSON array that came in a code fence", async () => {
    invokeWithProvider.mockResolvedValue(
      "```json\n" + JSON.stringify(CANDIDATE_LINES) + "\n```",
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    // The fence is packaging; the sentences under it are the answer.
    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("reads a JSON array that came with some prose around it", async () => {
    invokeWithProvider.mockResolvedValue(
      `好的，这是五句：\n${JSON.stringify(CANDIDATE_LINES)}\n希望有用。`,
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("reads the sentences out of a JSON object", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ candidates: CANDIDATE_LINES }),
    );

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("reads the sentences out of a JSON object whose first bracket is inside a string", () => {
    // The bracket in the note is the first one a reader sees, and it is
    // not the list — so the object has to be dug out as a whole before
    // the list inside it can be read.
    for (const key of ["candidates", "lines", "items"]) {
      const candidates = parseFarewellCandidates(
        `{"note": "[", "${key}": ["我一直都知道。"]}`,
      );
      expect(candidates.map((c) => c.text)).toEqual(["我一直都知道。"]);
    }
  });

  it("finds nothing in an answer that only tried to be JSON", () => {
    // A trailing comma is what a model writes when it is in a hurry.
    expect(parseFarewellCandidates('["我一直都知道。",]')).toEqual([]);
    expect(parseFarewellCandidates("[不是 JSON]")).toEqual([]);
    expect(parseFarewellCandidates('{"letter": "我一直都知道。",}')).toEqual([]);
  });

  it("finds nothing in an answer that is not there at all", () => {
    expect(parseFarewellCandidates(null as any)).toEqual([]);
    expect(parseFarewellCandidates(undefined as any)).toEqual([]);
  });

  it("finds nothing when the provider answers with nothing at all", async () => {
    invokeWithProvider.mockResolvedValue(undefined);

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates).toEqual([]);
  });

  it("reads the same sentence twice in a JSON array as one sentence", () => {
    const candidates = parseFarewellCandidates(
      '["我一直都知道。","我一直都知道。","你笑起来很好看。"]',
    );
    expect(candidates.map((c) => c.text)).toEqual([
      "我一直都知道。",
      "你笑起来很好看。",
    ]);
  });

  it("drops a line that carries no words", () => {
    // A line of punctuation is the model's formatting, not something she
    // said, and it has no business in the letter.
    const candidates = parseFarewellCandidates(
      "……\n我一直都知道。\n---\n",
    );
    expect(candidates.map((c) => c.text)).toEqual(["我一直都知道。"]);
  });

  it("reads a sentence the model wrapped in an object of its own", () => {
    const candidates = parseFarewellCandidates(
      '[{"line":"我一直都知道。"},{"sentence":"对不起，现在才说。"},{"content":"你笑起来很好看。"}]',
    );
    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
    // An object with nothing in it is not a sentence.
    expect(parseFarewellCandidates('[""]')).toEqual([]);
    expect(parseFarewellCandidates('[{"text":42}]')).toEqual([]);
  });

  it("keeps a confidence inside the scale it is on", () => {
    expect(
      parseFarewellCandidates('[{"text":"我一直都知道。","confidence":5}]')[0]
        .confidence,
    ).toBe(1);
    expect(
      parseFarewellCandidates('[{"text":"我一直都知道。","confidence":-1}]')[0]
        .confidence,
    ).toBe(0);
  });

  it("gives a flat confidence to a candidate whose confidence is not a number", () => {
    // The prompt asks for the sentences alone, so most answers carry no
    // confidence at all, and a fabricated ranking would look like a
    // measurement without being one.
    expect(
      parseFarewellCandidates('[{"text":"我一直都知道。"}]')[0].confidence,
    ).toBe(0.5);
    expect(
      parseFarewellCandidates('[{"text":"我一直都知道。","confidence":"high"}]')[0]
        .confidence,
    ).toBe(0.5);
  });

  it("does not keep two candidates that are the same sentence twice", () => {
    // Five of the same sentence is not five sentences, and a letter made
    // of them is a letter with nothing in it.
    const candidates = parseFarewellCandidates(
      ["我一直都知道。", "我一直都知道", "我一直都知道。", "对不起，现在才说。"].join("\n"),
    );
    const texts = candidates.map((c) => c.text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain("我一直都知道。");
    expect(texts).toContain("对不起，现在才说。");
  });

  it("reads a list that is numbered in square brackets", () => {
    // A farewell that failed on formatting would be a silly way to lose
    // one. A list numbered "[1]" is the same list as one numbered "1.",
    // and it used to be lost whole: the JSON reader claimed the answer
    // before the line reader got a chance, and the line reader could not
    // have read it either, because "[1]" was not a number it knew.
    const candidates = parseFarewellCandidates("[1] 我一直都知道。\n[2] 对不起。");
    expect(candidates.map((c) => c.text)).toEqual(["我一直都知道。", "对不起。"]);
  });

  it("still gives up on an answer that only tried to be JSON", () => {
    // The two are told apart: a line that opens with a bracketed number
    // is a numbered list, and anything else that opens with a bracket is
    // a broken JSON — and reading the brackets as a sentence would put
    // noise into the letter.
    const candidates = parseFarewellCandidates('[{"text": "我一直都知道。"');
    expect(candidates).toEqual([]);
  });

  it("still gives up on a JSON answer that is not a list of sentences", () => {
    expect(parseFarewellCandidates("[1,2,3]")).toEqual([]);
  });
});

describe("the material the letter is written from", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: vi.fn(),
    });
    invokeWithProvider.mockResolvedValue(CANDIDATE_LINES.join("\n"));
  });

  it("asks for the milestones by name", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        title: "她的生日",
        description: "11月3日",
        category: "milestone",
        subject: "them",
      },
      {
        id: 2,
        title: "第一次见面",
        description: null,
        category: "anniversary",
        subject: "them",
      },
      {
        id: 3,
        title: "普通的一页",
        description: null,
        category: "memory",
        subject: "them",
      },
    ]);

    await buildFarewellCandidates({ persona, userId: 1 });

    // A farewell that only mentions the catchphrases is not a letter, so
    // the milestones are asked for by name.
    const query = retrieveMemories.mock.calls[0][0].userMessage as string;
    expect(query).toContain("她的生日");
    expect(query).toContain("第一次见面");
    expect(query).not.toContain("普通的一页");
  });

  it("writes the letter when the database will not answer", async () => {
    getMemoriesByPersonaId.mockRejectedValue(new Error("the database is down"));

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    // The milestones are a part of the letter, not a part of the ritual:
    // a database that is down must not cost the goodbye its letter.
    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("writes the letter when the retrieval fails", async () => {
    retrieveMemories.mockRejectedValue(new Error("the retrieval is down"));

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("writes the letter when the summary will not answer", async () => {
    getLatestChatSummary.mockRejectedValue(new Error("the summary is down"));

    const candidates = await buildFarewellCandidates({ persona, userId: 1 });

    expect(candidates.map((c) => c.text)).toEqual(CANDIDATE_LINES);
  });

  it("puts the summary of earlier conversations into the prompt", async () => {
    getLatestChatSummary.mockResolvedValue({ summary: "你们一起过了三个生日。" });

    await buildFarewellCandidates({ persona, userId: 1 });

    const system = invokeWithProvider.mock.calls[0][1].messages.find(
      (m: any) => m.role === "system",
    ).content as string;
    expect(system).toContain("你们一起过了三个生日。");
  });
});

describe("the second pass", () => {
  const candidates = CANDIDATE_LINES.map((text) => ({ text, confidence: 0.5 }));

  beforeEach(() => {
    vi.clearAllMocks();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: vi.fn(),
    });
  });

  it("reads the letter, and what it kept and what it cut", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: ["我一直都知道。"],
        removed: ["对不起，现在才说。", "你笑起来很好看。"],
      }),
    );

    const draft = await editFarewellCandidates({
      persona,
      userId: 1,
      candidates,
    });

    expect(draft.letter).toBe("我一直都知道。");
    expect(draft.kept).toEqual(["我一直都知道。"]);
    expect(draft.removed).toEqual(["对不起，现在才说。", "你笑起来很好看。"]);
  });

  it("reads the letter out of a code fence", () => {
    const draft = parseFarewellEdit(
      '```json\n{"letter":"我一直都知道。","kept":["我一直都知道。"],"removed":[]}\n```',
      candidates,
    );
    expect(draft.letter).toBe("我一直都知道。");
    expect(draft.kept).toEqual(["我一直都知道。"]);
  });

  it("refuses a letter that says something the candidates never said", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        letter: "我一直都知道。我会永远记得你笑起来的样子。",
        kept: ["我一直都知道。"],
        removed: ["对不起，现在才说。", "你笑起来很好看。"],
      }),
    );

    const draft = await editFarewellCandidates({
      persona,
      userId: 1,
      candidates,
    });

    // The second pass may only cut. A letter that adds is not a shorter
    // letter, it is a different letter.
    expect(draft.letter).toBe("我一直都知道。");
    expect(draft.letter).not.toContain("永远记得");
  });

  it("keeps the candidates when the answer cannot be read", () => {
    const draft = parseFarewellEdit("我不知道该怎么写。", candidates);
    expect(draft.letter).toBe(CANDIDATE_LINES.join("\n"));
    expect(draft.kept).toEqual(CANDIDATE_LINES);
    expect(draft.removed).toEqual([]);
  });

  it("tells a new sentence from a rewording", () => {
    // A rewording keeps most of what the candidates already contained.
    expect(
      introducesNewContent("我一直都知道，只是没说。", ["我一直都知道。"]),
    ).toBe(false);
    // A sentence from nowhere does not.
    expect(
      introducesNewContent("我会永远记得你笑起来的样子。", [
        "我一直都知道。",
        "对不起，现在才说。",
      ]),
    ).toBe(true);
  });

  it("does not call a letter that is only whitespace new", () => {
    // There is nothing in it, so there is nothing new in it.
    expect(introducesNewContent("   ", CANDIDATE_LINES)).toBe(false);
    expect(introducesNewContent("...", CANDIDATE_LINES)).toBe(false);
  });

  it("does not call a letter that is one of the candidates new", () => {
    expect(introducesNewContent("我一直都知道。", CANDIDATE_LINES)).toBe(false);
  });

  it("does not call a letter that reorders the candidates new", () => {
    // The order is the model's business; what matters is that every
    // sentence in it was already said.
    expect(
      introducesNewContent("你笑起来很好看。我一直都知道。", CANDIDATE_LINES),
    ).toBe(false);
  });

  it("does not call a letter new when one candidate is inside another", () => {
    // The shorter one is covered by the longer one, so it adds nothing.
    expect(
      introducesNewContent("我一直都知道。", ["我一直都知道，一直没敢说。"]),
    ).toBe(false);
  });

  it("does not call a single word new when the candidates contain it", () => {
    // A stretch of one word has no pairs to compare, so it is compared
    // word by word.
    expect(introducesNewContent("我", CANDIDATE_LINES)).toBe(false);
    expect(introducesNewContent("goodbye", CANDIDATE_LINES)).toBe(true);
  });

  it("drops a kept line that is not among the candidates", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: ["一句她从来没有说过的话"],
        removed: [],
      }),
      candidates,
    );

    // A "kept" line that matches nothing is new material wearing a
    // candidate's clothes, and it is dropped rather than reported.
    expect(draft.kept).toEqual([]);
  });

  it("reports the candidate, not the model's wording, for a line that is close enough", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: ["我一直都知道了"],
        removed: [],
      }),
      candidates,
    );

    expect(draft.kept).toEqual(["我一直都知道。"]);
  });

  it("does not report a line as removed when it was kept as well", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: ["我一直都知道。"],
        removed: ["我一直都知道。"],
      }),
      candidates,
    );

    expect(draft.kept).toEqual(["我一直都知道。"]);
    expect(draft.removed).toEqual([]);
  });

  it("keeps the candidates when the answer has no letter", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({ kept: [], removed: [] }),
      candidates,
    );

    expect(draft.letter).toBe(CANDIDATE_LINES.join("\n"));
    expect(draft.kept).toEqual([]);
  });

  it("keeps the candidates when the letter is only whitespace", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({ letter: "   ", kept: [], removed: [] }),
      candidates,
    );

    expect(draft.letter).toBe(CANDIDATE_LINES.join("\n"));
  });

  it("keeps the candidates when the letter is not a letter", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({ letter: 42, kept: [], removed: [] }),
      candidates,
    );

    expect(draft.letter).toBe(CANDIDATE_LINES.join("\n"));
  });

  it("reads no kept line out of a list that is not a list", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: "我一直都知道。",
        removed: 3,
      }),
      candidates,
    );

    expect(draft.kept).toEqual([]);
    expect(draft.removed).toEqual([]);
  });

  it("reads no kept line out of a list of things that are not lines", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: [123, null, "   "],
        removed: [],
      }),
      candidates,
    );

    expect(draft.kept).toEqual([]);
  });

  it("keeps the candidates when the answer cannot be read even a little", () => {
    // The block is there and it is not JSON: an answer that cannot be
    // read cannot be cut, so the candidates are the letter.
    const draft = parseFarewellEdit('{"letter": }', candidates);

    expect(draft.letter).toBe(CANDIDATE_LINES.join("\n"));
    expect(draft.kept).toEqual(CANDIDATE_LINES);
    expect(draft.removed).toEqual([]);
  });

  it("keeps the same candidate once when it is named twice", () => {
    const draft = parseFarewellEdit(
      JSON.stringify({
        letter: "我一直都知道。",
        kept: ["我一直都知道。", "我一直都知道。"],
        removed: [],
      }),
      candidates,
    );

    expect(draft.kept).toEqual(["我一直都知道。"]);
  });
});

describe("the packaging around a sentence", () => {
  it("is taken off the numbering, in every shape it comes in", () => {
    expect(
      ["1. a", "2）b", "(3) c", "- d", "* e", "• f", "— g", "1、h"].map((s) =>
        cleanCandidateText(s),
      ),
    ).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("is taken off the quotes", () => {
    expect(cleanCandidateText("“我一直都知道。”")).toBe("我一直都知道。");
    expect(cleanCandidateText('"我一直都知道。"')).toBe("我一直都知道。");
  });

  it("is taken off a closing bracket that was never opened", () => {
    expect(cleanCandidateText("我一直都知道。）")).toBe("我一直都知道。");
  });

  it("is taken off a line that has nothing on it", () => {
    expect(cleanCandidateText("   ")).toBe("");
  });
});

describe("the block that is dug out of the answer", () => {
  it("is the whole object, braces inside quoted sentences and all", () => {
    expect(extractBalanced('{"letter":"我说{这里}。"}', "{", "}")).toBe(
      '{"letter":"我说{这里}。"}',
    );
  });

  it("keeps an escaped quote inside the string", () => {
    expect(extractBalanced('{"letter":"我说\\"这里\\"。"}', "{", "}")).toBe(
      '{"letter":"我说\\"这里\\"。"}',
    );
  });

  it("is not there when the answer has no braces", () => {
    expect(extractBalanced("我不知道该怎么写。", "{", "}")).toBeNull();
  });

  it("is not there when the braces never close", () => {
    expect(extractBalanced('{"letter":"我一直都知道。"', "{", "}")).toBeNull();
  });
});

describe("the two passes together", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    retrieveMemories.mockResolvedValue([]);
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      invoke: vi.fn(),
    });
  });

  it("writes the letter", async () => {
    invokeWithProvider
      .mockResolvedValueOnce(CANDIDATE_LINES.join("\n"))
      .mockResolvedValueOnce(
        JSON.stringify({
          letter: "我一直都知道。",
          kept: ["我一直都知道。"],
          removed: ["对不起，现在才说。", "你笑起来很好看。"],
        }),
      );

    const result = await writeFarewellLetterInTwoPasses({ persona, userId: 1 });

    expect(result.degraded).toBe(false);
    expect(result.letter).toBe("我一直都知道。");
    expect(result.draft?.removed).toEqual([
      "对不起，现在才说。",
      "你笑起来很好看。",
    ]);
  });

  it("degrades when the second pass fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeWithProvider
      .mockResolvedValueOnce(CANDIDATE_LINES.join("\n"))
      .mockRejectedValueOnce(new Error("the provider is down"));

    const result = await writeFarewellLetterInTwoPasses({ persona, userId: 1 });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("model-failed");
    // What the first pass managed is still worth having.
    expect(result.letter).toBe(CANDIDATE_LINES.join("\n"));
    warn.mockRestore();
  });

  it("degrades when the first pass finds nothing", async () => {
    invokeWithProvider.mockResolvedValue("");

    const result = await writeFarewellLetterInTwoPasses({ persona, userId: 1 });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("empty-candidates");
    expect(result.letter).toBe("");
  });

  it("does not wait for a provider that never answers", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      invokeWithProvider.mockImplementation(() => new Promise(() => {}));

      const pending = writeFarewellLetterInTwoPasses({ persona, userId: 1 });
      await vi.advanceTimersByTimeAsync(FAREWELL_TWO_PASS_TIMEOUT_MS + 10);
      const result = await pending;

      expect(result.degraded).toBe(true);
      expect(result.reason).toBe("timeout");
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("asks the provider to stop when the budget runs out", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      invokeWithProvider.mockImplementation(() => new Promise(() => {}));

      const pending = writeFarewellLetterInTwoPasses({ persona, userId: 1 });
      await vi.advanceTimersByTimeAsync(FAREWELL_TWO_PASS_TIMEOUT_MS + 10);
      await pending;

      // The provider is asked to stop, and the caller is released either
      // way: a request that never comes back must not be able to hold
      // the goodbye hostage.
      const signal = invokeWithProvider.mock.calls[0][1].options
        .signal as AbortSignal;
      expect(signal.aborted).toBe(true);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("degrades when the first pass fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));

    const result = await writeFarewellLetterInTwoPasses({ persona, userId: 1 });

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("model-failed");
    // There was nothing to write from, so there is nothing to write.
    expect(result.letter).toBe("");
    warn.mockRestore();
  });

  it("keeps the candidates when the budget runs out during the second pass", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      invokeWithProvider
        .mockResolvedValueOnce(CANDIDATE_LINES.join("\n"))
        .mockImplementation(() => new Promise(() => {}));

      const pending = writeFarewellLetterInTwoPasses({ persona, userId: 1 });
      await vi.advanceTimersByTimeAsync(FAREWELL_TWO_PASS_TIMEOUT_MS + 10);
      const result = await pending;

      expect(result.degraded).toBe(true);
      expect(result.reason).toBe("timeout");
      // The first pass managed something, and it is still worth having:
      // the budget runs out, not the material.
      expect(result.letter).toBe(CANDIDATE_LINES.join("\n"));
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not cut the work off before the budget runs out", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockResolvedValue(CANDIDATE_LINES.join("\n"));

      const pending = writeFarewellLetterInTwoPasses({ persona, userId: 1 });
      await vi.advanceTimersByTimeAsync(FAREWELL_TWO_PASS_TIMEOUT_MS - 1000);
      const result = await pending;

      // The budget is a ceiling, not a deadline the work is cut off at.
      expect(result.degraded).toBe(false);
      expect(result.letter).toBe(CANDIDATE_LINES.join("\n"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the persona the candidates are written in", () => {
  it("leaves out what the persona does not have", () => {
    const described = describePersonaForCandidates({
      ...persona,
      personaData: {},
    } as any);

    // A prompt that describes everything describes nothing, so only what
    // she has is put in it.
    expect(described).not.toContain("【性格特质】");
    expect(described).not.toContain("【说话方式】");
  });

  it("says so when there are no catchphrases", () => {
    const described = describePersonaForCandidates({
      ...persona,
      personaData: { personality: "温柔", speakingStyle: "慢慢说", catchphrases: [] },
    } as any);

    expect(described).toContain("无");
  });

  it("writes the imperfection of the state she is in", () => {
    const described = describePersonaForCandidates({
      ...persona,
      personaData: {
        ...persona.personaData,
        imperfectionProfile: [{ state: "warm", deviations: ["说话会拖长音"] }],
      },
    } as any);

    // The imperfection of the state she is in right now: one of the two
    // things that make a sentence sound like her rather than like a
    // person in general.
    expect(described).toContain("说话会拖长音");
  });

  it("writes the rules she discriminates by", () => {
    const described = describePersonaForCandidates({
      ...persona,
      personaData: {
        ...persona.personaData,
        microRules: [
          {
            id: "rule-1",
            trigger: ["随便"],
            meaning: "真的生气了",
            rendering: "只说随便",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          },
        ],
      },
    } as any);

    expect(described).toContain("随便");
  });

  it("writes the catchphrases the way the language writes them", () => {
    const described = describePersonaForCandidates(persona, "en");

    expect(described).toContain("嗯, 随便");
  });
});

describe("the budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is long enough for two model calls and short enough to wait for", () => {
    expect(FAREWELL_TWO_PASS_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(FAREWELL_TWO_PASS_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});
