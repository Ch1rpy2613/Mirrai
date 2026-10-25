import { describe, expect, it } from "vitest";
import {
  isDuplicateMemory,
  isExtractionDue,
  normalizeMemoryTitle,
} from "./chat/memory-extract";

/**
 * The memories.
 *
 * The extraction used to be a button, and pressing it twice stored the
 * same memories twice. The conversation moved on without the user
 * remembering to press it.
 */
describe("normalizeMemoryTitle", () => {
  it("ignores spacing and punctuation", () => {
    expect(normalizeMemoryTitle("第一次见面")).toBe(
      normalizeMemoryTitle("第一次 见面"),
    );
    expect(normalizeMemoryTitle("First meeting!")).toBe(
      normalizeMemoryTitle("first meeting"),
    );
  });
});

describe("isDuplicateMemory", () => {
  const existing = [
    { title: "第一次见面", description: "在图书馆门口，她迟到了二十分钟" },
    { title: "TA 的生日", description: "3 月 14 日" },
  ];

  it("sees the same title written again", () => {
    expect(isDuplicateMemory(
      { title: "第一次见面" },
      existing,
    )).toBe(true);
  });

  it("sees the same title written differently", () => {
    expect(isDuplicateMemory(
      { title: "第一次 见面！" },
      existing,
    )).toBe(true);
  });

  it("sees the same description under another title", () => {
    expect(isDuplicateMemory(
      { title: "我们在图书馆第一次碰面", description: "在图书馆门口，她迟到了二十分钟" },
      existing,
    )).toBe(true);
  });

  it("lets a different memory through", () => {
    expect(isDuplicateMemory(
      { title: "第一次一起看海", description: "在青岛，浪很大" },
      existing,
    )).toBe(false);
  });

  it("lets a memory with no title through as nothing", () => {
    expect(isDuplicateMemory({ title: "   " }, existing)).toBe(true);
  });
});

describe("isExtractionDue", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("waits when there is not enough new conversation", () => {
    expect(isExtractionDue({
      lastExtractedAt: null,
      newMessageCount: 3,
      now,
    })).toBe(false);
  });

  it("runs when there is enough and it has never run", () => {
    expect(isExtractionDue({
      lastExtractedAt: null,
      newMessageCount: 20,
      now,
    })).toBe(true);
  });

  it("does not run twice in a day", () => {
    expect(isExtractionDue({
      lastExtractedAt: new Date(now.getTime() - 3 * 3_600_000),
      newMessageCount: 40,
      now,
    })).toBe(false);
  });

  it("runs again the next day", () => {
    expect(isExtractionDue({
      lastExtractedAt: new Date(now.getTime() - 25 * 3_600_000),
      newMessageCount: 40,
      now,
    })).toBe(true);
  });
});
