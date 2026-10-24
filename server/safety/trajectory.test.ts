import { describe, expect, it, vi, beforeEach } from "vitest";

const getMessagesSince = vi.fn();
const createGraduationAssessment = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const invoke = vi.fn();
const invokeWithProvider = vi.fn();

// The mock paths must resolve to the same modules trajectory.ts imports
// ("../db" and "../llm" from server/safety/ → server/db and server/llm).
vi.mock("../db", () => ({
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
}));

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

import { assessTrajectory, getStoredTrajectory } from "./trajectory";

/** A fixed reference point so the assessment window is deterministic. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

let nextId = 1;

function userMessage(content: string) {
  return { id: nextId++, role: "user", content, createdAt: new Date(NOW) };
}

function assistantMessage(content: string) {
  return { id: nextId++, role: "assistant", content, createdAt: new Date(NOW) };
}

/** `count` neutral user turns — no regret or gratitude language. */
function userMessages(count: number) {
  return Array.from({ length: count }, () => userMessage("今天天气不错"));
}

/**
 * The smallest window the assessment accepts: eight user turns, one of which
 * carries a regret keyword and one a gratitude keyword.
 */
function enoughUserMessages() {
  return [
    userMessage("如果当初我们没有分开就好了"),
    userMessage("谢谢你一直陪着我"),
    ...userMessages(6),
  ];
}

beforeEach(() => {
  nextId = 1;
  getMessagesSince.mockReset();
  createGraduationAssessment.mockReset();
  getLatestGraduationAssessment.mockReset();
  invoke.mockReset();
  invokeWithProvider.mockReset();
  createGraduationAssessment.mockResolvedValue(1);
});

describe("assessTrajectory", () => {
  it("returns null when there are too few user messages", async () => {
    getMessagesSince.mockResolvedValue([
      userMessage("在吗"),
      assistantMessage("在的"),
      userMessage("今天好累"),
    ]);

    const result = await assessTrajectory({ userId: 1, personaId: 1, now: NOW });

    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("returns null just below the minimum window", async () => {
    getMessagesSince.mockResolvedValue(userMessages(7));

    const result = await assessTrajectory({ userId: 1, personaId: 1, now: NOW });

    expect(result).toBeNull();
    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("classifies an improving trajectory and stores it", async () => {
    getMessagesSince.mockResolvedValue(enoughUserMessages());
    invoke.mockResolvedValue(
      JSON.stringify({ trajectory: "improving", regretRatio: 20, gratitudeRatio: 70, note: "遗憾变少了" }),
    );

    const result = await assessTrajectory({ userId: 1, personaId: 2, now: NOW });

    expect(result?.trajectory).toBe("improving");
    expect(result?.regretRatio).toBe(20);
    expect(result?.gratitudeRatio).toBe(70);
    expect(result?.note).toBe("遗憾变少了");

    expect(createGraduationAssessment).toHaveBeenCalledTimes(1);
    const stored = createGraduationAssessment.mock.calls[0][0];
    expect(stored.userId).toBe(1);
    expect(stored.personaId).toBe(2);
    expect(stored.trajectory).toBe("improving");
    expect(stored.regretRatio).toBe(20);
    expect(stored.gratitudeRatio).toBe(70);
    expect(stored.assessment).toEqual({ note: "遗憾变少了" });
  });

  it("classifies a worsening trajectory", async () => {
    getMessagesSince.mockResolvedValue(enoughUserMessages());
    invoke.mockResolvedValue(
      JSON.stringify({ trajectory: "worsening", regretRatio: 80, gratitudeRatio: 10, note: "又开始怀念" }),
    );

    const result = await assessTrajectory({ userId: 1, personaId: 1, now: NOW });

    expect(result?.trajectory).toBe("worsening");
    expect(result?.regretRatio).toBe(80);
    expect(result?.gratitudeRatio).toBe(10);
    expect(createGraduationAssessment.mock.calls[0][0].trajectory).toBe("worsening");
  });

  it("falls back to the local keyword ratios when the model fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      getMessagesSince.mockResolvedValue(enoughUserMessages());
      invoke.mockRejectedValue(new Error("upstream exploded"));

      const result = await assessTrajectory({ userId: 1, personaId: 1, now: NOW });

      expect(result).not.toBeNull();
      expect(result?.trajectory).toBe("stable");
      // One of the eight regret keywords and one of the eight gratitude
      // keywords matched the transcript.
      expect(result?.regretRatio).toBe(13);
      expect(result?.gratitudeRatio).toBe(13);

      expect(createGraduationAssessment).toHaveBeenCalledTimes(1);
      const stored = createGraduationAssessment.mock.calls[0][0];
      expect(stored.trajectory).toBe("stable");
      expect(stored.regretRatio).toBe(13);
      expect(stored.gratitudeRatio).toBe(13);
    } finally {
      warn.mockRestore();
    }
  });

  it("reads the last 28 days and sends only the user's turns to the model", async () => {
    getMessagesSince.mockResolvedValue([...enoughUserMessages(), assistantMessage("在的")]);
    invoke.mockResolvedValue(JSON.stringify({ trajectory: "stable" }));

    await assessTrajectory({ userId: 7, personaId: 3, now: NOW });

    const [personaId, userId, since] = getMessagesSince.mock.calls[0];
    expect(personaId).toBe(3);
    expect(userId).toBe(7);
    const windowDays = (NOW - since.getTime()) / 86_400_000;
    expect(windowDays).toBeGreaterThan(27);
    expect(windowDays).toBeLessThan(29);

    const messages = invoke.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("如果当初");
    expect(messages[1].content).not.toContain("在的");
  });

  it("uses the provider instance when the caller resolved one", async () => {
    // The assessment has to run on the same credentials as the conversation —
    // otherwise a user who configured their own key silently falls back to the
    // environment one.
    getMessagesSince.mockResolvedValue(enoughUserMessages());
    invokeWithProvider.mockResolvedValue(JSON.stringify({ trajectory: "stable" }));
    const providerInstance = { name: "UserProvider" } as any;

    await assessTrajectory({ userId: 1, personaId: 1, providerInstance, now: NOW });

    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(invokeWithProvider.mock.calls[0][0]).toBe(providerInstance);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("getStoredTrajectory", () => {
  it("returns the stored assessment", async () => {
    const createdAt = new Date("2026-01-10T03:04:05Z");
    getLatestGraduationAssessment.mockResolvedValue({
      id: 1,
      userId: 1,
      personaId: 2,
      trajectory: "improving",
      regretRatio: 20,
      gratitudeRatio: 70,
      assessment: { note: "遗憾变少了" },
      windowStart: new Date("2025-12-18T12:00:00Z"),
      windowEnd: new Date("2026-01-15T12:00:00Z"),
      createdAt,
    });

    const stored = await getStoredTrajectory(2, 1);

    expect(getLatestGraduationAssessment).toHaveBeenCalledWith(2, 1);
    expect(stored?.trajectory).toBe("improving");
    expect(stored?.regretRatio).toBe(20);
    expect(stored?.gratitudeRatio).toBe(70);
    expect(stored?.createdAt).toBe(createdAt);
  });

  it("returns null when nothing has been stored", async () => {
    getLatestGraduationAssessment.mockResolvedValue(undefined);

    const stored = await getStoredTrajectory(2, 1);

    expect(stored).toBeNull();
  });
});
