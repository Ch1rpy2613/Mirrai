import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The reminder scheduler runs every minute, so the paths that decide
 * *whether* to send something matter more than usual: a mistake there means
 * the same message arriving a hundred times a day, or never arriving at all.
 */

const getAllPersonasForReminders = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getAnniversaryMemories = vi.fn();
const getPhotoReminderCandidates = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const hasReminderDelivery = vi.fn();
const recordReminder = vi.fn();

const getUserLocale = vi.fn();
const getUserTimezone = vi.fn();
getUserTimezone.mockResolvedValue(null);

vi.mock("../db", () => ({
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getAllPersonasForReminders: (...a: unknown[]) => getAllPersonasForReminders(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getAnniversaryMemories: (...a: unknown[]) => getAnniversaryMemories(...a),
  getPhotoReminderCandidates: (...a: unknown[]) => getPhotoReminderCandidates(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  hasReminderDelivery: (...a: unknown[]) => hasReminderDelivery(...a),
  recordReminder: (...a: unknown[]) => recordReminder(...a),
}));

const send = vi.fn();
const getChannelAdapter = vi.fn();

vi.mock("../channels", () => ({
  getChannelAdapter: (...a: unknown[]) => getChannelAdapter(...a),
}));

import {
  isQuietHour,
  collectReminders,
  deliverReminder,
  runReminderSweep,
  extractPhotoDate,
} from "./reminders";

const persona = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  name: "小A",
  // Deliberately not the day the sweep runs on, so the anniversary reminder
  // and the "years together" reminder do not overlap in every test.
  togetherFrom: "2021-03-14",
  remindersEnabled: true,
  ...overrides,
});

describe("isQuietHour", () => {
  it("treats a window that does not wrap as a plain range", () => {
    expect(isQuietHour(new Date(2024, 0, 1, 13, 0), "12:00-15:00")).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 16, 0), "12:00-15:00")).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const spec = "23:00-08:00";
    expect(isQuietHour(new Date(2024, 0, 1, 23, 30), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 2, 0), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 7, 59), spec)).toBe(true);
    expect(isQuietHour(new Date(2024, 0, 1, 8, 0), spec)).toBe(false);
    expect(isQuietHour(new Date(2024, 0, 1, 12, 0), spec)).toBe(false);
  });

  it("ignores a malformed setting", () => {
    expect(isQuietHour(new Date(), "not-a-window")).toBe(false);
  });

  it("is the hour the reader is in, not the hour the server is in", () => {
    // The quiet hours are the reader's decision about when they want to
    // be woken up. They were measured against the server's wall clock
    // in the proactive sweep, because no zone was passed at all — so at
    // half past midnight in the user's own time the app decided it was
    // not quiet and pushed a message, and at half past eight in the
    // morning it decided it was quiet and delivered nothing all day.
    const spec = "23:00-08:00";
    // 16:30 UTC is 00:30 in Shanghai: the reader's quiet hours.
    expect(isQuietHour(new Date("2026-10-26T16:30:00Z"), spec, "Asia/Shanghai")).toBe(true);
    // And 00:30 UTC is 08:30 in Shanghai: the reader's quiet hours are
    // over.
    expect(isQuietHour(new Date("2026-10-27T00:30:00Z"), spec, "Asia/Shanghai")).toBe(false);
  });
});

describe("collectReminders", () => {
  const now = new Date(2024, 4, 20, 10, 0); // 2024-05-20

  it("returns nothing when reminders are switched off", () => {
    const reminders = collectReminders({
      persona: persona({ remindersEnabled: false }),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders).toEqual([]);
  });

  it("stops the relationship reminders when the two of them cannot reach each other", () => {
    // "你们在一起三周年了" is not a sentence to push at somebody who
    // cannot get through to the person. Distance is not a breakup, but
    // it does mean the anniversaries are not for today.
    const reminders = collectReminders({
      persona: persona({ reachability: "unreachable" }),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders.some((r) => r.kind === "anniversary")).toBe(false);
  });

  it("stops the years-together reminder when they cannot reach each other", () => {
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2021-05-20", reachability: "unreachable" }),
      anniversaries: [],
      now,
    });
    expect(reminders.some((r) => r.kind === "together_years")).toBe(false);
  });

  it("counts the years in the reader's calendar", () => {
    // The years were counted in the *server's* calendar — the server's
    // year, the server's midnight — so for a reader one zone east the
    // year rolled over eight hours late and the anniversary was missed
    // on the day itself.
    //
    // 16:30 UTC on the 20th is already the 21st in Shanghai.
    const lateInShanghai = new Date("2026-05-20T16:30:00Z");
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2021-05-21" }),
      anniversaries: [],
      now: lateInShanghai,
      timezone: "Asia/Shanghai",
    });
    expect(reminders.some((r) => r.kind === "together_years")).toBe(true);

    const earlyInShanghai = new Date("2026-05-20T15:30:00Z");
    const notYet = collectReminders({
      persona: persona({ togetherFrom: "2021-05-21" }),
      anniversaries: [],
      now: earlyInShanghai,
      timezone: "Asia/Shanghai",
    });
    expect(notYet.some((r) => r.kind === "together_years")).toBe(false);
  });

  it("keeps the anniversaries when they can reach each other", () => {
    const reminders = collectReminders({
      persona: persona({ reachability: "reachable" }),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders.some((r) => r.kind === "anniversary")).toBe(true);
  });

  it("matches an anniversary written as MM-DD", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 1, title: "第一次见面", date: "05-20" }],
      now,
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].kind).toBe("anniversary");
    expect(reminders[0].dedupeKey).toContain("anniversary:1");
  });

  it("matches an anniversary written as a full date", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 2, title: "第一次见面", date: "2019-05-20" }],
      now,
    });
    expect(reminders).toHaveLength(1);
  });

  it("does not match an anniversary on another day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [{ id: 3, title: "别的日子", date: "06-01" }],
      now,
    });
    expect(reminders).toEqual([]);
  });

  it("fires on the anniversary of the day the two met", () => {
    const reminders = collectReminders({
      persona: persona({ togetherFrom: "2021-05-20" }),
      anniversaries: [],
      now,
    });
    expect(reminders.some((r) => r.kind === "together_years")).toBe(true);
  });

  it("fires a memory trigger for a photo taken on this day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [],
      photos: [
        {
          id: 7,
          originalName: "sea.png",
          dateHint: "2019-05-20",
          createdAt: new Date(2019, 4, 20),
        },
      ],
      now,
    });
    const trigger = reminders.find((r) => r.kind === "memory_trigger");
    expect(trigger).toBeDefined();
    expect(trigger!.dedupeKey).toContain("memory_trigger:7");
  });

  it("does not fire a memory trigger for a photo from another day", () => {
    const reminders = collectReminders({
      persona: persona(),
      anniversaries: [],
      photos: [
        {
          id: 8,
          originalName: "sea.png",
          dateHint: "2019-06-01",
          createdAt: new Date(2019, 5, 1),
        },
      ],
      now,
    });
    expect(reminders.filter((r) => r.kind === "memory_trigger")).toEqual([]);
  });
});

describe("extractPhotoDate", () => {
  it("reads a date out of the extracted text", () => {
    expect(extractPhotoDate("2019-05-20", new Date(2020, 0, 1))).toBe(
      "2019-05-20",
    );
  });

  it("falls back to the upload date", () => {
    expect(extractPhotoDate(null, new Date(Date.UTC(2019, 4, 20)))).toBe(
      "2019-05-20",
    );
  });

  it("returns null when there is no usable date", () => {
    expect(extractPhotoDate(null, new Date("nonsense"))).toBeNull();
  });
});

describe("deliverReminder", () => {
  beforeEach(() => {
    for (const fn of [
      getAllPersonasForReminders,
      getMemoriesByPersonaId,
      getAnniversaryMemories,
      getPhotoReminderCandidates,
      getChannelBindingsByUserId,
      hasReminderDelivery,
      recordReminder,
      send,
      getChannelAdapter,
    ]) {
      fn.mockReset();
    }
    hasReminderDelivery.mockResolvedValue(false);
    recordReminder.mockResolvedValue(true);
    getChannelAdapter.mockReturnValue({ send });
    getUserLocale.mockResolvedValue("zh");
  });

  const reminder = {
    kind: "anniversary" as const,
    personaId: 1,
    personaName: "小A",
    dedupeKey: "anniversary:1:2024-05-20",
    text: "今天是「第一次见面」的日子。",
  };

  it("does not send a reminder that was already delivered today", async () => {
    // The sweep runs every minute. Without this check the same reminder
    // would be pushed to the channel once a minute for the whole day.
    hasReminderDelivery.mockResolvedValue(true);

    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(delivered).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once and records the delivery", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(recordReminder).toHaveBeenCalledTimes(1);
    expect(delivered).toBe(true);
  });

  it("stays quiet during the quiet hours", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      channel: "wechat",
      targetId: "wx-1",
      now: new Date(2024, 4, 20, 23, 30),
    });

    expect(delivered).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("falls back to the web card when no channel is bound", async () => {
    const delivered = await deliverReminder({
      userId: 1,
      reminder,
      now: new Date(2024, 4, 20, 10, 0),
    });

    expect(send).not.toHaveBeenCalled();
    expect(recordReminder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "web" }),
    );
    expect(delivered).toBe(true);
  });
});

describe("runReminderSweep", () => {
  beforeEach(() => {
    for (const fn of [
      getAllPersonasForReminders,
      getMemoriesByPersonaId,
      getAnniversaryMemories,
      getPhotoReminderCandidates,
      getChannelBindingsByUserId,
      hasReminderDelivery,
      recordReminder,
      send,
      getChannelAdapter,
    ]) {
      fn.mockReset();
    }
    hasReminderDelivery.mockResolvedValue(false);
    recordReminder.mockResolvedValue(true);
    getChannelAdapter.mockReturnValue({ send });
    getUserLocale.mockResolvedValue("zh");
    getAnniversaryMemories.mockResolvedValue([]);
    getPhotoReminderCandidates.mockResolvedValue([]);
    getAllPersonasForReminders.mockResolvedValue([persona()]);
  });

  it("does not push a reminder into a conversation bound to another persona", async () => {
    // 小A has an anniversary today, but the only bound conversation is set
    // up for 小B. The reminder must not be pushed there.
    getAnniversaryMemories.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: null,
        category: "anniversary",
        date: "05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);
    getChannelBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        channel: "wechat",
        targetId: "wx-1",
        targetName: null,
        personaId: 2,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await runReminderSweep(new Date(2024, 4, 20, 10, 0));

    expect(send).not.toHaveBeenCalled();
    expect(recordReminder).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "web" }),
    );
  });

  it("pushes to the conversation bound to the same persona", async () => {
    getAnniversaryMemories.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: null,
        category: "anniversary",
        date: "05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);
    getChannelBindingsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        channel: "wechat",
        targetId: "wx-1",
        targetName: null,
        personaId: 1,
        isActive: true,
        createdAt: new Date(),
      },
    ]);

    await runReminderSweep(new Date(2024, 4, 20, 10, 0));

    expect(send).toHaveBeenCalledTimes(1);
  });
});
