import { describe, expect, it } from "vitest";
import { buildRelationshipSection, calendarDaysBetween } from "./user-side";

/**
 * The relative dates in the persona's prompt.
 *
 * They were elapsed twenty-four-hour periods, not calendar days. So an
 * event recorded at half past eleven in the evening was "yesterday" at
 * half past twelve that night — the same evening, one hour apart, and
 * the persona was told the user had been together with them *today*
 * when it had happened the day before.
 *
 * Every event recorded in the evening was mislabelled, and the persona
 * was told it as a fact it already knows.
 */

describe("the days between two moments", () => {
  it("are calendar days, not twenty-four-hour periods", () => {
    // Half past eleven at night, and half past twelve the next night.
    const evening = new Date("2026-03-13T23:30:00Z");
    const justAfterMidnight = new Date("2026-03-14T00:30:00Z");

    // The old way: one hour apart, so "yesterday" — but it was the same
    // evening.
    const elapsed = Math.floor(
      (justAfterMidnight.getTime() - evening.getTime()) / 86_400_000,
    );
    expect(elapsed).toBe(0);

    // The new way: one calendar day, on the user's own clock.
    expect(calendarDaysBetween(evening, justAfterMidnight, "UTC")).toBe(1);
  });

  it("are the same on the user's own clock", () => {
    // Half past eleven at night in Shanghai is 15:30 UTC.
    const evening = new Date("2026-03-13T15:30:00Z");
    const justAfterMidnight = new Date("2026-03-13T16:30:00Z");

    // On the server's UTC clock, these are on the same day.
    expect(calendarDaysBetween(evening, justAfterMidnight, "UTC")).toBe(0);
    // On the user's clock, the second one is the next day.
    expect(calendarDaysBetween(evening, justAfterMidnight, "Asia/Shanghai")).toBe(1);
  });

  it("count the day the same way in both directions", () => {
    const a = new Date("2026-03-10T08:00:00Z");
    const b = new Date("2026-03-14T22:00:00Z");
    expect(calendarDaysBetween(a, b, "UTC")).toBe(4);
    expect(calendarDaysBetween(b, a, "UTC")).toBe(-4);
  });
});

describe("the relationship section", () => {
  const events = [
    {
      kind: "meetup",
      title: "第一次一起看海",
      // Half past eleven at night — the evening.
      happenedAt: new Date("2026-03-13T23:30:00Z"),
    },
  ];

  it("calls last night's evening 'yesterday', on the user's clock", () => {
    // Half past twelve in the morning — half an hour later in the day.
    const now = new Date("2026-03-14T00:30:00Z");
    const section = buildRelationshipSection(events, null, "zh", now, "UTC");
    // The old code called it "today": the same evening.
    expect(section).toContain("昨天");
    expect(section).not.toContain("今天");
  });

  it("calls this morning's morning 'today'", () => {
    // An event from this morning, seen this morning.
    const morning = [
      {
        kind: "meetup",
        title: "第一次一起看海",
        happenedAt: new Date("2026-03-14T08:00:00Z"),
      },
    ];
    const now = new Date("2026-03-14T09:00:00Z");
    const section = buildRelationshipSection(morning, null, "zh", now, "UTC");
    expect(section).toContain("今天");
  });

  it("says so in English as well", () => {
    const now = new Date("2026-03-14T00:30:00Z");
    const section = buildRelationshipSection(events, null, "en", now, "UTC");
    expect(section).toContain("yesterday");
    expect(section).not.toContain("today");
  });

  it("keeps a trigger for three calendar days", () => {
    const triggered = [
      {
        kind: "triggered",
        title: "我们又分开了",
        // Eleven at night, three days ago.
        happenedAt: new Date("2026-03-11T23:00:00Z"),
      },
    ];

    /**
     * It was elapsed twenty-four-hour periods: this trigger was 3.02
     * days old, so the instruction — "the user is hurting, acknowledge
     * it and stop there" — was dropped, while the same trigger recorded
     * at half past midnight was 2.99 days old and kept it.
     */
    const now = new Date("2026-03-14T23:30:00Z");
    const section = buildRelationshipSection(triggered, null, "zh", now, "UTC");
    expect(section).toContain("用户现在难受");
  });

  it("lets a trigger go after three calendar days", () => {
    const triggered = [
      {
        kind: "triggered",
        title: "我们又分开了",
        // Eleven at night, four days ago.
        happenedAt: new Date("2026-03-10T23:00:00Z"),
      },
    ];
    const now = new Date("2026-03-14T23:30:00Z");
    const section = buildRelationshipSection(triggered, null, "zh", now, "UTC");
    expect(section).not.toContain("用户现在难受");
  });
});
