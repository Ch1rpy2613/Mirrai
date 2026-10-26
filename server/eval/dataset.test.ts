import { describe, expect, it } from "vitest";
import {
  buildEvalCases,
  casesFromRows,
  describeCase,
  trainingTexts,
  type EvalSourceMessage,
} from "./dataset";

/**
 * Cutting the held-out cases.
 *
 * The rule is simple and the failure is quiet: if the held-out line is
 * still somewhere in the context, the persona can copy it and the
 * measurement means nothing. These tests are what stops that from
 * happening by accident.
 */
const conversation: EvalSourceMessage[] = [
  { role: "user", content: "在吗", timestamp: null },
  { role: "assistant", content: "在的", timestamp: null },
  { role: "user", content: "今天好累", timestamp: null },
  { role: "assistant", content: "怎么了", timestamp: null },
  { role: "user", content: "没什么", timestamp: null },
  { role: "assistant", content: "嗯嗯", timestamp: null },
  { role: "user", content: "你会离开我吗", timestamp: null },
  { role: "assistant", content: "你想多了", timestamp: null },
];

describe("cutting the cases", () => {
  it("holds out the other person's lines", () => {
    const cases = buildEvalCases(conversation);
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(item.expected.role).toBe("assistant");
    }
  });

  it("never leaves the held-out line in the context", () => {
    const cases = buildEvalCases(conversation, { contextSize: 6 });
    for (const item of cases) {
      const contents = item.context.map((m) => m.content);
      expect(contents).not.toContain(item.expected.content);
    }
  });

  it("keeps the context in the order it was said", () => {
    const cases = buildEvalCases(conversation, { contextSize: 3 });
    const item = cases.find((c) => c.expected.content === "怎么了");
    expect(item).toBeDefined();
    expect(item!.context.map((m) => m.content)).toEqual(["在吗", "在的", "今天好累"]);
  });

  it("skips a line that has no user message before it", () => {
    const cases = buildEvalCases([
      { role: "assistant", content: "一上来就说话的", timestamp: null },
      { role: "user", content: "你好", timestamp: null },
      { role: "assistant", content: "你好呀", timestamp: null },
    ]);
    expect(cases.length).toBe(1);
    expect(cases[0].expected.content).toBe("你好呀");
  });

  it("skips a line that is too short to be worth holding out", () => {
    const cases = buildEvalCases(
      [
        { role: "user", content: "说话", timestamp: null },
        { role: "assistant", content: "。", timestamp: null },
        { role: "user", content: "再说一次", timestamp: null },
        { role: "assistant", content: "好的", timestamp: null },
      ],
      { minExpectedChars: 2 },
    );
    expect(cases.map((c) => c.expected.content)).toEqual(["好的"]);
  });

  it("spreads the cases across the conversation", () => {
    const long: EvalSourceMessage[] = [];
    for (let i = 0; i < 40; i++) {
      long.push({ role: "user", content: `问题 ${i}`, timestamp: null });
      long.push({ role: "assistant", content: `回答 ${i}`, timestamp: null });
    }
    const cases = buildEvalCases(long, { maxCases: 5 });
    expect(cases.length).toBe(5);
    // The picks come from the beginning, the middle and the end, not
    // from five consecutive lines at the top.
    const positions = cases.map((c) => long.indexOf(c.expected));
    expect(positions[4] - positions[0]).toBeGreaterThan(20);
  });

  it("reads the emotion off the held-out line", () => {
    const cases = buildEvalCases([
      { role: "user", content: "好久不见", timestamp: null },
      { role: "assistant", content: "我也想你", timestamp: null },
      { role: "user", content: "最近还好吗", timestamp: null },
      { role: "assistant", content: "还行吧", timestamp: null },
    ]);
    const item = cases.find((c) => c.expected.content === "我也想你");
    expect(item?.expectedState).toBe("nostalgic");
  });

  it("has nothing to hold out when there is only one of their lines", () => {
    const cases = buildEvalCases([
      { role: "user", content: "好久不见", timestamp: null },
      { role: "assistant", content: "我也想你", timestamp: null },
    ]);
    expect(cases).toEqual([]);
  });

  it("has nothing to hold out in an empty conversation", () => {
    expect(buildEvalCases([])).toEqual([]);
  });

  it("keeps most of their lines behind for the model to learn from", () => {
    const cases = buildEvalCases(conversation, { maxCases: 100 });

    // The n-gram model is fitted on the lines that were not held out, so
    // holding out too much leaves it with nothing to learn from — and a
    // model fitted on one line rates every other line as unlikely,
    // including the real one. At most a quarter of their lines are held
    // out, so three of these four stay behind.
    expect(cases.length).toBe(1);
    expect(cases[0].expected.content).toBe("怎么了");
  });

  it("does not hold out a line whose context runs across a scene break", () => {
    // A night between two messages is a different conversation. A case
    // whose context is half of one and half of the other asks the
    // persona to answer a prompt that never happened.
    const at = (hour: number) => new Date(Date.UTC(2025, 2, 1, hour));
    const across = [
      { role: "user" as const, content: "在吗", timestamp: at(2) },
      { role: "assistant" as const, content: "在的", timestamp: at(2.1) },
      { role: "user" as const, content: "今天好累", timestamp: at(20) },
      { role: "assistant" as const, content: "怎么了", timestamp: at(20.1) },
      { role: "user" as const, content: "没什么", timestamp: at(20.2) },
      { role: "assistant" as const, content: "嗯嗯", timestamp: at(20.3) },
    ];
    const cases = buildEvalCases(across, { contextSize: 6, maxHoldoutFraction: 1 });
    for (const item of cases) {
      // The context never reaches back across the night.
      const hours = item.context.map((m) => m.timestamp!.getUTCHours());
      expect(Math.max(...hours) - Math.min(...hours)).toBeLessThan(6);
    }
  });

  it("holds out at most a quarter of their lines", () => {
    // Twelve of their lines: three are held out, nine stay behind.
    const many = Array.from({ length: 12 }, (_, i) => [
      { role: "user" as const, content: `问题 ${i}`, timestamp: null },
      { role: "assistant" as const, content: `回答 ${i}`, timestamp: null },
    ]).flat();
    expect(buildEvalCases(many, { maxCases: 100 })).toHaveLength(3);
  });

  it("still holds out one when there is only one to hold out", () => {
    // Two of their lines: a quarter of two is nothing, so the floor of
    // one applies — but one of the two still stays behind.
    const two = [
      { role: "user" as const, content: "在吗", timestamp: null },
      { role: "assistant" as const, content: "在的", timestamp: null },
      { role: "user" as const, content: "还好吗", timestamp: null },
      { role: "assistant" as const, content: "嗯嗯", timestamp: null },
    ];
    const cases = buildEvalCases(two);
    expect(cases.length).toBe(1);
  });

  it("keeps at least one case even when the caller asks for none", () => {
    expect(buildEvalCases(conversation, { maxCases: 0 })).toHaveLength(1);
  });

  it("gives the persona at least one line of context", () => {
    const cases = buildEvalCases(conversation, { contextSize: 0 });

    for (const item of cases) {
      expect(item.context.length).toBe(1);
    }
  });

  it("gives the persona only as much context as it was asked for", () => {
    const cases = buildEvalCases(conversation, { contextSize: 2 });
    const item = cases.find((c) => c.expected.content === "怎么了");

    expect(item).toBeDefined();
    expect(item!.context.map((m) => m.content)).toEqual([
      "在的",
      "今天好累",
    ]);
  });

  it("never holds out a line with nothing in it", () => {
    const cases = buildEvalCases(
      [
        { role: "user", content: "在吗", timestamp: null },
        { role: "assistant", content: "", timestamp: null },
        { role: "user", content: "你好", timestamp: null },
        { role: "assistant", content: "嗯", timestamp: null },
      ],
      { minExpectedChars: 0 },
    );

    expect(cases.map((c) => c.expected.content)).toEqual(["嗯"]);
  });
});

describe("the emotion of a held-out line", () => {
  it("reads it in the language the record is in", () => {
    // The state is read off the words, so an English record has to be
    // read with the English table — otherwise every held-out line
    // carries no state, and every per-state bucket is empty.
    const cases = buildEvalCases(
      [
        { id: 1, role: "user", content: "do you remember when we met?", timestamp: null },
        { id: 2, role: "assistant", content: "i miss you", timestamp: null },
        { id: 3, role: "user", content: "are you serious?", timestamp: null },
        { id: 4, role: "assistant", content: "i miss you so much", timestamp: null },
      ],
      { locale: "en" },
    );
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0].expectedState).toBe("nostalgic");
  });

  it("reads a Chinese record with the Chinese table", () => {
    const cases = buildEvalCases([
      { id: 1, role: "user", content: "你还记得吗", timestamp: null },
      { id: 2, role: "assistant", content: "想你", timestamp: null },
      { id: 3, role: "user", content: "真的吗", timestamp: null },
      { id: 4, role: "assistant", content: "很想你", timestamp: null },
    ]);
    expect(cases[0].expectedState).toBe("nostalgic");
  });
});

describe("reading the stored cases back", () => {
  it("reads a stored case", () => {
    const cases = casesFromRows([
      {
        contextJson: [
          { id: 1, role: "user", content: "在吗", timestamp: "2025-03-01T12:00:00Z" },
        ],
        expectedJson: { id: 2, role: "assistant", content: "在的", timestamp: null },
        expectedState: "nostalgic",
      },
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0].expected.content).toBe("在的");
    expect(cases[0].expected.role).toBe("assistant");
    expect(cases[0].expectedState).toBe("nostalgic");
    expect(cases[0].context[0].timestamp).toBeInstanceOf(Date);
  });

  it("skips a row it cannot read", () => {
    // The stored cases were written by an earlier version of the code.
    // A row that cannot be read is skipped, not a crash.
    const cases = casesFromRows([
      { contextJson: null, expectedJson: null, expectedState: null },
      { contextJson: [], expectedJson: { role: "assistant", content: "在的" } },
      { contextJson: [{ role: "user", content: "在吗" }], expectedJson: { content: "" } },
    ]);
    expect(cases).toEqual([]);
  });

  it("reads a row with no timestamp", () => {
    const cases = casesFromRows([
      {
        contextJson: [{ id: 1, role: "user", content: "在吗" }],
        expectedJson: { role: "assistant", content: "在的" },
      },
    ]);
    expect(cases[0].expected.timestamp).toBeNull();
    expect(cases[0].context[0].timestamp).toBeNull();
  });

  it("reads a row whose timestamp is already a date", () => {
    const cases = casesFromRows([
      {
        contextJson: [
          { id: 1, role: "user", content: "在吗", timestamp: new Date(0) },
        ],
        expectedJson: {
          role: "assistant",
          content: "在的",
          timestamp: new Date("2025-03-01T12:00:00Z"),
        },
      },
    ]);
    expect(cases[0].context[0].timestamp).toBeInstanceOf(Date);
    expect(cases[0].expected.timestamp).toBeInstanceOf(Date);
  });

  it("reads a row whose timestamp could not be a date as no date", () => {
    const cases = casesFromRows([
      {
        contextJson: [
          { id: 1, role: "user", content: "在吗", timestamp: "not a date" },
        ],
        expectedJson: { role: "assistant", content: "在的" },
      },
    ]);
    expect(cases[0].context[0].timestamp).toBeNull();
  });

  it("skips a stored line whose text is not text", () => {
    const cases = casesFromRows([
      {
        contextJson: [{ role: "user", content: "在吗" }],
        expectedJson: { role: "assistant", content: 42 },
      },
    ]);
    expect(cases).toEqual([]);
  });
});

describe("what the model is fitted on", () => {
  it("leaves the held-out lines out of the training text", () => {
    const cases = buildEvalCases(conversation);
    const texts = trainingTexts(conversation, cases);
    for (const item of cases) {
      expect(texts).not.toContain(item.expected.content);
    }
  });

  it("keeps the person's other lines", () => {
    const cases = buildEvalCases(conversation);
    const texts = trainingTexts(conversation, cases);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });

  it("does not train the model on a line the person never said", () => {
    const record: EvalSourceMessage[] = [
      { role: "user", content: "在吗", timestamp: null },
      { role: "assistant", content: "", timestamp: null },
      { role: "user", content: "你好", timestamp: null },
      { role: "assistant", content: "你好呀", timestamp: null },
    ];
    const cases = buildEvalCases(record);
    const texts = trainingTexts(record, cases);
    // The empty line is nothing to learn from, and the held-out line is
    // the answer.
    expect(texts).toEqual([]);
  });

  it("takes an identical line out of the training text as well", () => {
    const record: EvalSourceMessage[] = [
      { role: "user", content: "在吗", timestamp: null },
      { role: "assistant", content: "在的", timestamp: null },
      { role: "user", content: "再说一次", timestamp: null },
      { role: "assistant", content: "在的", timestamp: null },
    ];
    const cases = buildEvalCases(record);
    const texts = trainingTexts(record, cases);
    // The same line said twice is the answer twice: the model must not
    // have seen either copy.
    expect(cases.length).toBe(1);
    expect(texts).not.toContain("在的");
  });
});

describe("describing a case for a human", () => {
  it("shows the line before and the line held out", () => {
    const cases = buildEvalCases(conversation);
    const text = describeCase(cases[0]);
    expect(text).toContain("→");
  });

  it("describes a case that has no context at all", () => {
    const text = describeCase({
      context: [],
      expected: { role: "assistant", content: "嗯嗯", timestamp: null },
      expectedState: null,
    });
    expect(text).toBe("… → 嗯嗯");
  });

  it("keeps the description short enough to read", () => {
    const long = "长".repeat(60);
    const text = describeCase({
      context: [{ role: "user", content: long, timestamp: null }],
      expected: { role: "assistant", content: long, timestamp: null },
      expectedState: null,
    });
    expect(text).toBe(`…${long.slice(0, 40)} → ${long.slice(0, 40)}`);
  });
});
