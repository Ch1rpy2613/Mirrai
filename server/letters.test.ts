import { describe, expect, it } from "vitest";
import {
  buildLetterReplyInstruction,
  earliestAnswerAt,
  isLetterStatus,
  resolveReplyAt,
  MIN_REPLY_GAP_HOURS,
  REPLY_DELAY_HOURS,
} from "@shared/letters";

/**
 * The letters.
 *
 * The app had one way to say something: talk to it, and get an answer.
 * But the things people most want to say to somebody they cannot reach
 * are the things they cannot say *to* them — and sometimes the answer is
 * the problem.
 */
describe("letter statuses", () => {
  it("knows the three states", () => {
    expect(isLetterStatus("private")).toBe(true);
    expect(isLetterStatus("waiting")).toBe(true);
    expect(isLetterStatus("answered")).toBe(true);
    expect(isLetterStatus("sent")).toBe(false);
    expect(isLetterStatus(null)).toBe(false);
  });
});

describe("resolveReplyAt", () => {
  const now = new Date("2026-06-01T10:00:00Z");

  it("answers about a day later", () => {
    const due = resolveReplyAt({ now });
    const hours = (due.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBe(REPLY_DELAY_HOURS);
  });

  it("holds a second answer back until the gap has passed", () => {
    // Writing five letters and getting five answers within the hour is a
    // machine talking to itself. The gap is enforced when the answer is
    // given, not when the letter is written.
    const lastReplyAt = new Date(now.getTime() - 60 * 60 * 1000);
    const earliest = earliestAnswerAt(lastReplyAt, now);
    expect(earliest).not.toBeNull();
    // Twelve hours after the last answer, which is eleven from now.
    const afterLast = (earliest!.getTime() - lastReplyAt.getTime()) / 3_600_000;
    const fromNow = (earliest!.getTime() - now.getTime()) / 3_600_000;
    expect(afterLast).toBe(MIN_REPLY_GAP_HOURS);
    expect(fromNow).toBe(MIN_REPLY_GAP_HOURS - 1);
  });

  it("does not hold an answer back when the last one was long ago", () => {
    const lastReplyAt = new Date(now.getTime() - 3 * 24 * 3_600_000);
    expect(earliestAnswerAt(lastReplyAt, now)).toBeNull();
  });

  it("does not hold an answer back when there was no last one", () => {
    expect(earliestAnswerAt(null, now)).toBeNull();
  });
});

describe("buildLetterReplyInstruction", () => {
  it("asks for a letter, not a chat message", () => {
    const instruction = buildLetterReplyInstruction({
      personaName: "小A",
      letterBody: "我一直想问你一件事。",
    });
    expect(instruction).toContain("小A");
    expect(instruction).toContain("我一直想问你一件事。");
    expect(instruction).toContain("信");
  });

  it("writes the English instruction in English", () => {
    const instruction = buildLetterReplyInstruction({
      personaName: "A",
      letterBody: "There is something I have wanted to ask you.",
      locale: "en",
    });
    expect(instruction).toContain("letter");
    expect(instruction).toContain("There is something I have wanted to ask you.");
  });
});
