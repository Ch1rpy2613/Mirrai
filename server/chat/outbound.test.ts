import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The way out.
 *
 * The guarantees these tests defend are the ones the exit cannot afford to
 * lose: the words handed back are the user's own, and they were actually
 * said by them. A persona's sentence on that list would mean the app
 * putting somebody else's mouth in the user's; a paraphrased line would
 * mean the app putting its own mouth in it.
 */

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const resolveProviderForUser = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

import {
  selectOutboundCandidatesLocally,
  collectOutboundCandidates,
  type OutboundMessage,
} from "./outbound";

/** A provider that is configured enough to be handed to the LLM service. */
const fakeProvider = {
  name: "Test",
  isConfigured: () => true,
  invoke: async () => "",
  capabilities: {
    streaming: false,
    vision: false,
    tools: false,
    jsonMode: false,
  },
};

/** A conversation at a fixed hour, so the vulnerable-hour signal is decided. */
const afternoon = new Date(2026, 4, 1, 15, 0, 0);
const lateAtNight = new Date(2026, 4, 1, 23, 30, 0);

function user(
  id: number,
  content: string,
  createdAt: Date | null = null,
): OutboundMessage {
  return { id, role: "user", content, createdAt };
}

function persona(
  id: number,
  content: string,
  createdAt: Date | null = null,
): OutboundMessage {
  return { id, role: "assistant", content, createdAt };
}

beforeEach(() => {
  invoke.mockReset();
  invokeWithProvider.mockReset();
  resolveProviderForUser.mockReset();
  resolveProviderForUser.mockResolvedValue(fakeProvider);
  invokeWithProvider.mockResolvedValue('{"items":[],"note":""}');
});

describe("picking the user's own words", () => {
  it("never returns a persona message, even when the persona's message scores highest", () => {
    const messages = [
      user(1, "我害怕"),
      // A persona message that would outscore everything: a question, a
      // feeling in the first person, and long.
      persona(
        2,
        "我会离开我吗？我好想你。我真的很孤独。这是一段很长很长很长很长的话。",
      ),
    ];

    const result = selectOutboundCandidatesLocally(messages);

    expect(result.map((c) => c.messageId)).toEqual([1]);
    expect(result.every((c) => c.text !== messages[1].content)).toBe(true);
  });

  it("finds a question of the user's that nobody answered", () => {
    const messages = [
      user(1, "今天怎么样？"),
      persona(2, "还行呀。"),
      user(3, "你会离开我吗？"),
    ];

    const result = selectOutboundCandidatesLocally(messages);

    // The answered question is not a candidate; the one left hanging is.
    expect(result.map((c) => c.messageId)).toEqual([3]);
  });

  it("finds a question the persona answered with a deflection", () => {
    const messages = [user(1, "你会离开我吗？"), persona(2, "你又想多了。")];

    const result = selectOutboundCandidatesLocally(messages);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("finds a fear the user stated in the first person", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "我害怕"),
      persona(2, "别怕，我在。"),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("finds a fear stated in English too", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "I'm scared"),
      persona(2, "I'm here."),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("leaves a third party's fear alone", () => {
    const result = selectOutboundCandidatesLocally([user(1, "他好孤独")]);

    expect(result).toEqual([]);
  });

  it("keeps the text byte for byte identical to the input", () => {
    const original = "我 害怕   你会离开我吗？  \n";
    const result = selectOutboundCandidatesLocally([user(1, original)]);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(original);
    expect(result[0].text.length).toBe(original.length);
  });

  it("respects max", () => {
    const messages = [
      user(1, "我害怕"),
      user(2, "我很孤独"),
      user(3, "我好想你"),
      user(4, "我很难过"),
    ];

    expect(selectOutboundCandidatesLocally(messages, { max: 2 })).toHaveLength(
      2,
    );
    expect(selectOutboundCandidatesLocally(messages, { max: 0 })).toHaveLength(
      0,
    );
    // Five is the default ceiling.
    expect(
      selectOutboundCandidatesLocally(
        Array.from({ length: 9 }, (_, i) => user(i + 1, `我害怕${i}`)),
      ),
    ).toHaveLength(5);
  });

  it("does not turn chit-chat into a confession", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "今天天气不错"),
      user(2, "在吗"),
      user(3, "吃了吗"),
    ]);

    expect(result).toEqual([]);
  });

  it("finds a message the user rewrote before sending", () => {
    const messages: OutboundMessage[] = [
      { ...user(1, "我一直想说的话"), edited: true },
    ];

    const result = selectOutboundCandidatesLocally(messages);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("does not offer a message just because it was sent at night", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "今天天气不错", lateAtNight),
    ]);

    expect(result).toEqual([]);
  });

  it("reads the hour of the day in the timezone it was given", () => {
    // 23:30 in Shanghai is 15:30 UTC — the same moment, two different
    // evenings, and only one of them is the small hours.
    const at = new Date("2026-05-01T23:30:00+08:00");

    const inShanghai = selectOutboundCandidatesLocally(
      [user(1, "我害怕", at)],
      { timezone: "Asia/Shanghai" },
    );
    const inUtc = selectOutboundCandidatesLocally([user(1, "我害怕", at)], {
      timezone: "UTC",
    });

    expect(inShanghai[0].weight).toBeGreaterThan(inUtc[0].weight);
  });

  it("returns nothing when there is no conversation at all", () => {
    expect(selectOutboundCandidatesLocally([])).toEqual([]);
  });

  it("returns nothing when the conversation is not a conversation", () => {
    // The caller may hand over anything at all; the exit must not fall
    // over a shape it did not expect.
    expect(
      selectOutboundCandidatesLocally(null as unknown as OutboundMessage[]),
    ).toEqual([]);
  });

  it("returns nothing when the user wrote nothing in it", () => {
    expect(
      selectOutboundCandidatesLocally([persona(1, "你今天怎么样？")]),
    ).toEqual([]);
  });

  it("takes the user's role however it is written", () => {
    const messages = [
      { id: 1, role: " USER ", content: "我害怕", createdAt: null },
      { id: 2, role: "USER", content: "我很孤独", createdAt: null },
      { id: 3, role: "assistant", content: "别怕", createdAt: null },
      { id: 4, role: "system", content: "我害怕", createdAt: null },
    ] as OutboundMessage[];

    const result = selectOutboundCandidatesLocally(messages);

    // The role decides who said it, not the spelling of the role.
    expect(result.map((c) => c.messageId)).toEqual([1, 2]);
  });

  it("ignores a role that is not a role at all", () => {
    const messages = [
      { id: 1, role: 42, content: "我害怕", createdAt: null },
    ] as unknown as OutboundMessage[];

    expect(selectOutboundCandidatesLocally(messages)).toEqual([]);
  });

  it("does not offer a message the user never actually wrote", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "我害怕"),
      user(2, "   "),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("counts a question the user followed with another message as unanswered", () => {
    // They asked it and then said something else. Nobody answered it.
    const result = selectOutboundCandidatesLocally([
      user(1, "你会离开我吗？"),
      user(2, "算了不问了"),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("counts an empty reply as no answer at all", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "你会离开我吗？"),
      persona(2, "   "),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("counts a reply that asks something back as no answer", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "你今天还好吗？"),
      persona(2, "你为什么这么问？"),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("recognises an English question mark as a question", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "will you leave me?"),
    ]);

    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("counts the small hours as a vulnerable hour too", () => {
    const smallHours = new Date("2026-05-01T02:00:00Z");

    const result = selectOutboundCandidatesLocally(
      [user(1, "我害怕", smallHours)],
      { timezone: "UTC" },
    );

    // Two in the morning is as vulnerable as eleven at night.
    expect(result[0].weight).toBeCloseTo(0.32, 6);
  });

  it("falls back to the server's clock when the timezone is not one", () => {
    const at = new Date("2026-05-01T23:30:00Z");

    const result = selectOutboundCandidatesLocally([user(1, "我害怕", at)], {
      timezone: "Not/AZone",
    });

    // A broken timezone must not cost the user their line.
    expect(result.map((c) => c.messageId)).toEqual([1]);
  });

  it("treats an impossible date as no date at all", () => {
    const result = selectOutboundCandidatesLocally([
      user(1, "我害怕", new Date("not a date")),
    ]);

    expect(result[0].at).toBeNull();
  });

  it("reads a date that arrived as a string", () => {
    const messages = [
      {
        id: 1,
        role: "user",
        content: "我害怕",
        createdAt: "2026-05-01T23:30:00Z",
      },
    ] as unknown as OutboundMessage[];

    const result = selectOutboundCandidatesLocally(messages, {
      timezone: "UTC",
    });

    expect(result[0].at).toBeInstanceOf(Date);
  });

  it("calls a long personal line long when it is far above what this user writes", () => {
    const messages = [
      user(1, "嗯"),
      user(2, "我"),
      user(3, "我害怕"),
      user(4, "我最近一直很害怕一个人待着，因为房间里安静得让人睡不着觉。"),
    ];

    const result = selectOutboundCandidatesLocally(messages);
    const long = result.find((c) => c.messageId === 4);

    expect(long?.weight).toBeGreaterThan(0.24);
  });

  it("treats a negative ceiling as no ceiling at all", () => {
    expect(
      selectOutboundCandidatesLocally([user(1, "我害怕")], { max: -3 }),
    ).toEqual([]);
  });

  it("takes a whole number of lines, not a fraction of one", () => {
    const messages = [user(1, "我害怕"), user(2, "我好想你")];

    expect(
      selectOutboundCandidatesLocally(messages, { max: 1.7 }),
    ).toHaveLength(1);
  });

  it("offers a rewritten line at exactly the floor of being worth offering", () => {
    const messages: OutboundMessage[] = [
      { ...user(1, "我一直想说的话"), edited: true },
    ];

    const result = selectOutboundCandidatesLocally(messages);

    // Rewriting it is the smallest real signal there is — and it is
    // exactly on the line, not under it.
    expect(result[0].weight).toBe(0.12);
  });
});

describe("asking a model which words were never said out loud", () => {
  const conversation = [
    user(1, "我害怕", afternoon),
    persona(2, "别怕，我在。", afternoon),
    user(3, "你会离开我吗？", afternoon),
  ];

  it("drops an item whose messageId belongs to the persona", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [{ messageId: 2, text: "别怕，我在。" }],
        note: "找到了两句",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.some((c) => c.messageId === 2)).toBe(false);
    expect(candidates.every((c) => c.text !== "别怕，我在。")).toBe(true);
  });

  it("drops an item whose id was invented", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 999, text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.some((c) => c.messageId === 999)).toBe(false);
  });

  it("drops an item whose text differs by one character", async () => {
    // A line the heuristic has no opinion about, so the only thing that
    // could put it on the list is the model — and the model changed a
    // character.
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [{ messageId: 1, text: "今天天气不错。" }],
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "今天天气不错", afternoon)],
    });

    expect(candidates).toEqual([]);
  });

  it("hands back the original words when the model paraphrased them", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1, text: "我好怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "我害怕", afternoon)],
    });

    // The paraphrased line is gone; the user's own line survives, and it
    // is still the user's own line.
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("我害怕");
  });

  it("falls back to the local candidates when the model throws", async () => {
    invokeWithProvider.mockRejectedValue(new Error("upstream exploded"));
    invoke.mockRejectedValue(new Error("no provider either"));

    const { candidates, note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toContain(1);
    expect(candidates.map((c) => c.messageId)).toContain(3);
    expect(note).not.toBe("");
  });

  it("falls back to the local candidates when the model returns nothing usable", async () => {
    invokeWithProvider.mockResolvedValue("sorry, I cannot do that");

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toContain(1);
  });

  it("returns an empty list when there is nothing to find", async () => {
    invokeWithProvider.mockResolvedValue('{"items":[],"note":""}');

    const { candidates, note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "今天天气不错", afternoon)],
    });

    expect(candidates).toEqual([]);
    expect(note).toBe("");
  });

  it("reads a fenced answer as well as a bare one", async () => {
    invokeWithProvider.mockResolvedValue(
      '```json\n{"items":[{"messageId":1,"text":"我害怕"}],"note":"一句说明"}\n```',
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "我害怕", afternoon)],
    });

    expect(candidates.map((c) => c.messageId)).toEqual([1]);
    expect(candidates[0].text).toBe("我害怕");
  });

  it("keeps one entry for a line both passes found", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1, text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    const found = candidates.filter((c) => c.messageId === 1);
    expect(found).toHaveLength(1);
    // The model has read the conversation, so its judgement ranks first.
    expect(found[0].weight).toBeGreaterThan(0.9);
  });

  it("shows the model the conversation with its ids and its speakers", async () => {
    await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
      locale: "en",
      max: 3,
    });

    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const system = request.messages[0].content;
    const userPrompt = request.messages[1].content;

    expect(system).toContain("3");
    expect(userPrompt).toContain("#1");
    expect(userPrompt).toContain("User:");
    expect(userPrompt).toContain("Persona:");
    expect(userPrompt).toContain("我害怕");
  });

  it("shows the model the end of the conversation when it is too long to show all of it", async () => {
    const long = "一".repeat(200);
    const many = Array.from({ length: 200 }, (_, i) =>
      user(i + 1, `${long} #${i + 1}`),
    );

    await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: many,
    });

    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userPrompt = request.messages[1].content;

    // The beginning is cut and the ending is kept: a transcript that lost
    // its end would show the model a conversation that stopped mid-sentence.
    expect(userPrompt).not.toContain("#1 ");
    expect(userPrompt).toContain("#200");
  });

  it("does not ask a model when the user wrote nothing", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [persona(1, "你今天怎么样？", afternoon)],
    });

    expect(candidates).toEqual([]);
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("accepts an id that came back as a string", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: "1", text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toEqual([1, 3]);
  });

  it("takes the whole part of an id that came back as a fraction", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1.9, text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toEqual([1, 3]);
  });

  it("drops an item with no id at all", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    // Nothing the model said could be traced back, so only the heuristic
    // floor has anything to offer.
    expect(candidates.map((c) => c.messageId)).toEqual([3, 1]);
    expect(candidates.every((c) => c.weight < 0.9)).toBe(true);
  });

  it("drops an item whose id is not a number at all", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: "one", text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toEqual([3, 1]);
    expect(candidates.every((c) => c.weight < 0.9)).toBe(true);
  });

  it("drops an item that is not an item at all", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [null, "我害怕", { messageId: 1, text: "我害怕" }],
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    // Only the one that was shaped like an item got through.
    expect(candidates[0].messageId).toBe(1);
    expect(candidates[0].weight).toBe(1);
  });

  it("drops an item with no text at all", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [{ messageId: 1 }, { messageId: 3, text: "你会离开我吗？" }],
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates[0].messageId).toBe(3);
    expect(candidates[0].weight).toBe(1);
  });

  it("reads a model answer with no items in it as no items", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: "很多", note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(candidates.map((c) => c.messageId)).toEqual([3, 1]);
  });

  it("asks the server's own provider when the user has not configured one", async () => {
    resolveProviderForUser.mockResolvedValue(null);
    invoke.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1, text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
    expect(candidates[0].weight).toBe(1);
  });

  it("asks the server's own provider when the user's provider said nothing", async () => {
    invokeWithProvider.mockResolvedValue("   ");
    invoke.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1, text: "我害怕" }], note: "" }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(invoke).toHaveBeenCalled();
    expect(candidates[0].weight).toBe(1);
  });

  it("takes only the first line of the model's note", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [{ messageId: 1, text: "我害怕" }],
        note: "第一行\n第二行",
      }),
    );

    const { note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(note).toBe("第一行");
  });

  it("keeps the model's note short", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [{ messageId: 1, text: "我害怕" }],
        note: "长".repeat(300),
      }),
    );

    const { note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(note.length).toBe(200);
  });

  it("says its own words when the model's note is not a note", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({ items: [{ messageId: 1, text: "我害怕" }], note: 42 }),
    );

    const { note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
    });

    expect(note).not.toBe("42");
    // The app says it in its own words, and counts what it found.
    expect(note).toContain("2");
  });

  it("does not let the model's order go below zero", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      user(i + 1, `我害怕${i}`, afternoon),
    );
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: many.map((m) => ({ messageId: m.id, text: m.content })),
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: many,
      max: 60,
    });

    // The model asked for more than the order can express, so the tail
    // sits at zero rather than going negative.
    expect(candidates).toHaveLength(60);
    expect(candidates[candidates.length - 1].weight).toBe(0);
  });

  it("does not ask a model when the caller asked for no lines at all", async () => {
    const { candidates, note } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
      max: 0,
    });

    expect(candidates).toEqual([]);
    expect(note).toBe("");
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("treats a negative ceiling as no ceiling at all", async () => {
    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
      max: -2,
    });

    expect(candidates).toEqual([]);
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("keeps only as many lines as the caller asked for", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify({
        items: [
          { messageId: 1, text: "我害怕" },
          { messageId: 3, text: "你会离开我吗？" },
        ],
        note: "",
      }),
    );

    const { candidates } = await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: conversation,
      max: 1,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].messageId).toBe(1);
  });
});

describe("the conversation the model is shown", () => {
  it("shows the model at most two hundred lines of the conversation", async () => {
    const many = Array.from({ length: 260 }, (_, i) =>
      user(i + 1, `消息 ${i + 1}`, afternoon),
    );

    await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: many,
    });

    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userPrompt = request.messages[1].content;

    expect(userPrompt).toContain("#260");
    expect(userPrompt).toContain("#61");
    expect(userPrompt).not.toContain("#60");
  });

  it("keeps the last line even when it is longer than the whole budget", async () => {
    const huge = "字".repeat(30_000);

    await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "我害怕", afternoon), user(2, huge, afternoon)],
    });

    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userPrompt = request.messages[1].content;

    // A transcript that lost its ending would show the model a
    // conversation that stopped mid-sentence.
    expect(userPrompt).toContain("#2");
    expect(userPrompt).not.toContain("#1");
  });

  it("leaves the timestamp empty when the message has none", async () => {
    await collectOutboundCandidates({
      userId: 1,
      personaId: 1,
      messages: [user(1, "我害怕")],
      locale: "en",
    });

    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const userPrompt = request.messages[1].content;

    expect(userPrompt).toContain("[] #1 ");
  });
});
