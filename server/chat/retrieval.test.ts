import { describe, expect, it, vi, beforeEach } from "vitest";

const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const touchMemoryRecalled = vi.fn();

vi.mock("../db", () => ({
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
}));

import {
  tokenize,
  keywordCoverage,
  scoreMemory,
  selectMemories,
  formatMemoriesForPrompt,
  formatAnchorsForPrompt,
  fileSummaryCandidates,
  retrieveMemories,
  type MemoryCandidate,
} from "./retrieval";

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: 1,
    title: "第一次见面",
    description: "在图书馆门口，她迟到了",
    category: "memory",
    date: "2019-05-20",
    subject: "them",
    isPinned: false,
    importance: 1,
    lastRecalledAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("tokenize", () => {
  it("splits Latin words", () => {
    const tokens = tokenize("the library was quiet");
    expect(tokens.has("library")).toBe(true);
    expect(tokens.has("the")).toBe(true);
  });

  it("splits Chinese into bigrams", () => {
    const tokens = tokenize("图书馆");
    expect(tokens.has("图书")).toBe(true);
    expect(tokens.has("书馆")).toBe(true);
  });

  it("keeps a single Chinese character", () => {
    expect(tokenize("书").has("书")).toBe(true);
  });

  it("handles empty input", () => {
    expect(tokenize("").size).toBe(0);
  });
});

describe("keywordCoverage", () => {
  it("is high when the memory matches the message", () => {
    const tokens = tokenize("你还记得图书馆那次吗");
    expect(keywordCoverage("第一次见面在图书馆门口", tokens)).toBeGreaterThan(0);
  });

  it("is zero when nothing matches", () => {
    const tokens = tokenize("今天天气不错");
    expect(keywordCoverage("第一次见面在图书馆门口", tokens)).toBe(0);
  });

  it("is zero for an empty message", () => {
    expect(keywordCoverage("第一次见面", new Set())).toBe(0);
  });
});

describe("scoreMemory", () => {
  const now = new Date("2025-01-01T00:00:00Z").getTime();

  it("scores a matching memory above an unrelated one", () => {
    const tokens = tokenize("图书馆");
    const matching = scoreMemory(candidate(), tokens, now);
    const unrelated = scoreMemory(
      candidate({ id: 2, title: "去吃火锅", description: "排队很久" }),
      tokens,
      now,
    );
    expect(matching).toBeGreaterThan(unrelated);
  });

  it("gives a pinned memory a boost", () => {
    const tokens = tokenize("图书馆");
    const plain = scoreMemory(candidate(), tokens, now);
    const pinned = scoreMemory(candidate({ isPinned: true }), tokens, now);
    expect(pinned).toBeGreaterThan(plain);
  });

  it("damps a memory that was just recalled", () => {
    const tokens = tokenize("图书馆");
    const fresh = scoreMemory(candidate(), tokens, now);
    const justRecalled = scoreMemory(
      candidate({ lastRecalledAt: new Date(now - 60_000) }),
      tokens,
      now,
    );
    expect(justRecalled).toBeLessThan(fresh);
  });

  it("does not damp a memory recalled long ago", () => {
    const tokens = tokenize("图书馆");
    const fresh = scoreMemory(candidate(), tokens, now);
    const longAgo = scoreMemory(
      candidate({ lastRecalledAt: new Date(now - 48 * 60 * 60 * 1000) }),
      tokens,
      now,
    );
    expect(longAgo).toBeCloseTo(fresh, 5);
  });

  it("weights a milestone above an ordinary memory", () => {
    const tokens = tokenize("图书馆");
    const ordinary = scoreMemory(candidate({ category: "memory" }), tokens, now);
    const milestone = scoreMemory(candidate({ category: "milestone" }), tokens, now);
    expect(milestone).toBeGreaterThan(ordinary);
  });
});

describe("selectMemories", () => {
  const now = new Date("2025-01-01T00:00:00Z").getTime();

  it("always includes anchors", () => {
    const { selected, anchors } = selectMemories(
      [
        candidate({ id: 1, category: "anchor", title: "生日", description: "3 月 14 日" }),
        candidate({ id: 2, title: "去吃火锅", description: "排队很久" }),
      ],
      "今天有点无聊",
      { now },
    );

    expect(anchors).toHaveLength(1);
    expect(selected.map((m) => m.id)).toContain(1);
  });

  it("does not include an ordinary memory with no keyword match", () => {
    const { selected } = selectMemories(
      [candidate({ id: 2, title: "去吃火锅", description: "排队很久" })],
      "今天有点无聊",
      { now },
    );
    expect(selected).toHaveLength(0);
  });

  it("includes an ordinary memory that matches", () => {
    const { selected } = selectMemories(
      [candidate({ id: 2, title: "图书馆", description: "在里面看书" })],
      "你还记得图书馆吗",
      { now },
    );
    expect(selected.map((m) => m.id)).toContain(2);
  });

  it("always includes a pinned memory even without a keyword match", () => {
    const { selected } = selectMemories(
      [candidate({ id: 3, isPinned: true, title: "去吃火锅", description: "排队很久" })],
      "今天有点无聊",
      { now },
    );
    expect(selected.map((m) => m.id)).toContain(3);
  });

  it("respects the top-K limit for ordinary memories", () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: i + 1, title: `图书馆 ${i}`, description: "在里面看书" }),
    );
    const { selected } = selectMemories(memories, "图书馆", { topK: 3, now });
    expect(selected).toHaveLength(3);
  });
});

describe("prompt rendering", () => {
  it("renders the memory section", () => {
    const text = formatMemoriesForPrompt([
      { ...candidate(), score: 1 },
    ]);
    expect(text).toContain("【相关记忆】");
    expect(text).toContain("第一次见面");
  });

  it("renders nothing when there are no memories", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("renders the anchor section with the no-hallucination rule", () => {
    const text = formatAnchorsForPrompt([
      { ...candidate({ category: "anchor", title: "生日", description: "3 月 14 日" }), score: 1 },
    ]);
    expect(text).toContain("【事实锚点（不得违背）】");
    expect(text).toContain("不要编造");
  });
});

describe("file summaries", () => {
  beforeEach(() => {
    getMemoriesByPersonaId.mockReset();
    getFilesByPersonaId.mockReset();
    touchMemoryRecalled.mockReset();
    getMemoriesByPersonaId.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    touchMemoryRecalled.mockResolvedValue(undefined);
  });

  function uploadedFile(overrides: Record<string, unknown> = {}) {
    return {
      id: 7,
      personaId: 1,
      userId: 1,
      fileType: "chat_txt",
      originalName: "聊天记录.txt",
      fileKey: "chat/1/1/abc.txt",
      fileUrl: "/uploads/abc.txt",
      fileSize: 100,
      extractedMemory: "我们在图书馆第一次见面，她迟到了半小时",
      processStatus: "done",
      createdAt: new Date("2025-06-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("turns the summary of an uploaded file into a candidate", () => {
    const candidates = fileSummaryCandidates([uploadedFile() as any]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toContain("图书馆");
    expect(candidates[0].category).toBe("file_summary");
    // A negative id keeps it apart from the `memories` table.
    expect(candidates[0].id).toBeLessThan(0);
  });

  it("skips a file without an extracted summary", () => {
    expect(fileSummaryCandidates([uploadedFile({ extractedMemory: "  " }) as any])).toHaveLength(0);
  });

  it("offers the file summary when the message matches it", async () => {
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);

    const memories = await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].category).toBe("file_summary");
    expect(memories[0].description).toContain("图书馆");
  });

  it("keeps the file summary below the pinned and anchor memories", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        title: "生日",
        description: "3 月 14 日",
        category: "anchor",
        date: null,
        isPinned: false,
        importance: 1,
        lastRecalledAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        id: 2,
        title: "图书馆",
        description: "在里面看书",
        category: "memory",
        date: null,
        isPinned: true,
        importance: 1,
        lastRecalledAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ]);
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);

    const memories = await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(memories.map((m) => m.category)).toEqual(["anchor", "memory", "file_summary"]);
  });

  it("does not mark a file summary as a recalled memory", async () => {
    getFilesByPersonaId.mockResolvedValue([uploadedFile()]);

    await retrieveMemories({
      personaId: 1,
      userId: 1,
      userMessage: "你还记得图书馆吗",
    });

    expect(touchMemoryRecalled).not.toHaveBeenCalled();
  });
});
