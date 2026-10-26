import { describe, expect, it, vi, beforeEach } from "vitest";

const getSessionStartAt = vi.fn();
const getUserMessageCountSince = vi.fn();
const getDailyUserChatCounts = vi.fn();

vi.mock("../db", () => ({
  getSessionStartAt: (...a: unknown[]) => getSessionStartAt(...a),
  getUserMessageCountSince: (...a: unknown[]) => getUserMessageCountSince(...a),
  getDailyUserChatCounts: (...a: unknown[]) => getDailyUserChatCounts(...a),
}));

import {
  pickCareNote,
  evaluateUsage,
  LONG_SESSION_MS,
  type UsageSignals,
} from "./usage-monitor";
import { isQuietHour, collectReminders } from "../scheduler/reminders";

function signals(overrides: Partial<UsageSignals> = {}): UsageSignals {
  return {
    sessionDurationMs: 0,
    dailyMessageCount: 0,
    dependencyRising: false,
    dailyCounts: [],
    ...overrides,
  };
}

/** The date key the monitor uses for a day relative to `now`. */
function dayKey(now: number, daysAgo: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

/** Daily counts for the last 14 days, oldest first. */
function dailyRows(now: number, counts: number[]): Array<{ date: string; count: number }> {
  return counts.map((count, index) => ({
    date: dayKey(now, counts.length - 1 - index),
    count,
  }));
}

describe("pickCareNote", () => {
  it("says nothing when nothing is unusual", () => {
    expect(pickCareNote(signals())).toBeNull();
  });

  it("notices a long conversation", () => {
    const note = pickCareNote(signals({ sessionDurationMs: 3 * 60 * 60 * 1000 }));
    expect(note?.kind).toBe("long_session");
    expect(note?.text.length).toBeGreaterThan(0);
  });

  it("notices too many conversations in a day", () => {
    const note = pickCareNote(signals({ dailyMessageCount: 8 }));
    expect(note?.kind).toBe("daily_frequency");
    expect(note?.showBanner).toBe(true);
  });

  it("notices a rising dependency", () => {
    const note = pickCareNote(signals({ dependencyRising: true }));
    expect(note?.kind).toBe("dependency");
    expect(note?.showBanner).toBe(true);
  });

  it("prefers the dependency note over the others", () => {
    // The dependency signal is the one the product names as a risk, and it
    // is the rarest. The daily threshold trips after a few conversations,
    // so it used to pre-empt the dependency note every time it could fire.
    const note = pickCareNote(
      signals({
        dependencyRising: true,
        sessionDurationMs: 3 * 60 * 60 * 1000,
        dailyMessageCount: 8,
      }),
    );
    expect(note?.kind).toBe("dependency");
  });

  it("returns only one note", () => {
    const note = pickCareNote(
      signals({ sessionDurationMs: 3 * 60 * 60 * 1000, dailyMessageCount: 8 }),
    );
    expect(note?.kind).toBe("long_session");
  });

  it("carries the key the client translates", () => {
    expect(pickCareNote(signals({ sessionDurationMs: 3 * 60 * 60 * 1000 }))?.textKey)
      .toBe("safety.care.longSession");
    expect(pickCareNote(signals({ dailyMessageCount: 8 }))?.textKey)
      .toBe("safety.care.dailyLimit");
    expect(pickCareNote(signals({ dependencyRising: true }))?.textKey)
      .toBe("safety.care.dependency");
  });

  it("speaks English for an English conversation", () => {
    const note = pickCareNote(signals({ dailyMessageCount: 8 }), "en");
    // "You've", not "we've" — the count behind the note is the user's
    // messages across the whole app, not this conversation.
    expect(note?.text).toContain("You've talked a lot today");
    expect(note?.textKey).toBe("safety.care.dailyLimit");
  });
});

describe("evaluateUsage", () => {
  const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

  beforeEach(() => {
    getSessionStartAt.mockReset();
    getUserMessageCountSince.mockReset();
    getDailyUserChatCounts.mockReset();
    getUserMessageCountSince.mockResolvedValue(1);
    getDailyUserChatCounts.mockResolvedValue([]);
    getSessionStartAt.mockResolvedValue(null);
  });

  it("measures the session from when the conversation started", async () => {
    // The conversation began five hours ago and has not paused.
    getSessionStartAt.mockResolvedValue(new Date(NOW - 5 * 60 * 60 * 1000));

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.sessionDurationMs).toBe(5 * 60 * 60 * 1000);
    expect(result.sessionDurationMs).toBeGreaterThan(LONG_SESSION_MS);
  });

  it("does not count a long silence as a long conversation", async () => {
    // The user was away all afternoon and just came back. The session
    // starts now, so nothing is long about it.
    getSessionStartAt.mockResolvedValue(null);

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.sessionDurationMs).toBe(0);
  });

  it("counts only the messages the user sent", async () => {
    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(getUserMessageCountSince).toHaveBeenCalled();
    expect(result.dailyMessageCount).toBe(1);
  });

  it("notices a dependency that starts from nothing", async () => {
    // Three days of 30 messages a day after two quiet weeks — the onset case
    // the ratio rule alone cannot catch.
    getDailyUserChatCounts.mockResolvedValue(
      dailyRows(NOW, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30]),
    );

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.dependencyRising).toBe(true);
  });

  it("still applies the ratio to a week that already had messages", async () => {
    // A flat week before, twice as many messages in the last week.
    getDailyUserChatCounts.mockResolvedValue(
      dailyRows(NOW, [10, 10, 10, 10, 10, 10, 10, 30, 30, 30, 30, 30, 30, 30]),
    );

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.dependencyRising).toBe(true);
  });

  it("does not fire on a steady frequency", async () => {
    getDailyUserChatCounts.mockResolvedValue(dailyRows(NOW, new Array(14).fill(30)));

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.dependencyRising).toBe(false);
  });

  it("does not fire when the burst is not the last few days", async () => {
    getDailyUserChatCounts.mockResolvedValue(
      dailyRows(NOW, [0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 30, 30, 30, 0]),
    );

    const result = await evaluateUsage({ userId: 1, personaId: 1, now: NOW });

    expect(result.dependencyRising).toBe(false);
  });
});

describe("isQuietHour", () => {
  it("matches a window that wraps past midnight", () => {
    const lateNight = new Date("2025-01-01T23:30:00");
    const earlyMorning = new Date("2025-01-01T03:00:00");
    const midday = new Date("2025-01-01T12:00:00");

    expect(isQuietHour(lateNight, "23:00-08:00")).toBe(true);
    expect(isQuietHour(earlyMorning, "23:00-08:00")).toBe(true);
    expect(isQuietHour(midday, "23:00-08:00")).toBe(false);
  });

  it("matches a window inside one day", () => {
    expect(isQuietHour(new Date("2025-01-01T13:00:00"), "12:00-14:00")).toBe(true);
    expect(isQuietHour(new Date("2025-01-01T15:00:00"), "12:00-14:00")).toBe(false);
  });

  it("ignores a malformed setting", () => {
    expect(isQuietHour(new Date("2025-01-01T13:00:00"), "not a window")).toBe(false);
  });
});

describe("collectReminders", () => {
  const now = new Date("2025-06-15T10:00:00");

  it("fires on an anniversary", () => {
    const reminders = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: null, remindersEnabled: true },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].kind).toBe("anniversary");
  });

  it("does not fire on another day", () => {
    const reminders = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: null, remindersEnabled: true },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-16" }],
      now,
    });
    expect(reminders).toHaveLength(0);
  });

  it("fires on the anniversary of the year together", () => {
    const reminders = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: "2021-06-15", remindersEnabled: true },
      anniversaries: [],
      now,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].kind).toBe("together_years");
    expect(reminders[0].text).toContain("4");
  });

  it("does not fire before the first anniversary", () => {
    const reminders = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: "2024-12-01", remindersEnabled: true },
      anniversaries: [],
      now,
    });
    expect(reminders).toHaveLength(0);
  });

  it("respects the per-persona switch", () => {
    const reminders = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: null, remindersEnabled: false },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    expect(reminders).toHaveLength(0);
  });

  it("gives each reminder a key that changes daily", () => {
    const first = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: null, remindersEnabled: true },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    const second = collectReminders({
      persona: { id: 1, name: "小A", togetherFrom: null, remindersEnabled: true },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now: new Date("2025-06-16T10:00:00"),
    });
    expect(first[0].dedupeKey).not.toBe(second[0]?.dedupeKey);
  });

  it("says nothing when the relationship has ended", () => {
    // The end date was stored but never read, so an anniversary was
    // announced to someone whose relationship had already finished.
    const reminders = collectReminders({
      persona: {
        id: 1, name: "小A", togetherFrom: "2021-06-15", togetherTo: "2024-01-01",
        remindersEnabled: true,
      },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    expect(reminders).toHaveLength(0);
  });

  it("says nothing when the persona has graduated", () => {
    const reminders = collectReminders({
      persona: {
        id: 1, name: "小A", togetherFrom: "2021-06-15", remindersEnabled: true,
        graduationStatus: "graduated",
      },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    expect(reminders).toHaveLength(0);
  });

  it("says nothing when the user asked for some space", () => {
    const reminders = collectReminders({
      persona: {
        id: 1, name: "小A", togetherFrom: null, remindersEnabled: true,
        presence: "quiet",
      },
      anniversaries: [{ id: 1, title: "第一次见面", date: "06-15" }],
      now,
    });
    expect(reminders).toHaveLength(0);
  });
});
