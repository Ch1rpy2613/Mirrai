import { describe, expect, it } from "vitest";
import {
  clearProactiveDeadlines,
  isProactiveDue,
  buildProactiveInstruction,
  resolveProactiveDeadline,
} from "./chat/proactive";
import { fitBehaviorProfile } from "@shared/behavior-profile";
import { buildReachabilityNote, isReachability, buildRelationshipSection } from "@shared/user-side";
import { daysSinceContact } from "@shared/timezone";
import { buildSystemPrompt } from "./_core/persona-utils";

/**
 * The persona reaching out first, and the distance between two people.
 *
 * The replica never spoke on its own. The user always had to open the
 * app and start — which means the reason to open it was the user
 * feeling like it, not the other person.
 */
describe("isProactiveDue", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("never speaks when the user did not ask it to", () => {
    // Zero is a real value, not a missing one. An app that speaks first
    // is something the user buys.
    expect(isProactiveDue({
      frequencyHours: 0,
      lastChatAt: null,
      presence: "active",
      now,
    })).toBe(false);
  });

  it("never speaks when the frequency is negative", () => {
    // A negative frequency is not a purchase either — it is a number
    // that cannot be waited out.
    expect(isProactiveDue({
      frequencyHours: -24,
      lastChatAt: null,
      presence: "active",
      now,
    })).toBe(false);
  });

  it("speaks first when nobody has ever written", () => {
    // There is no silence to wait out, so the first word is due now:
    // the persona is the one who has to break the ice.
    expect(isProactiveDue({
      frequencyHours: 24,
      lastChatAt: null,
      presence: "active",
      now,
    })).toBe(true);
  });

  it("speaks when enough time has passed", () => {
    expect(isProactiveDue({
      frequencyHours: 24,
      lastChatAt: new Date(now.getTime() - 25 * 3_600_000),
      presence: "active",
      now,
    })).toBe(true);
  });

  it("waits when the time has not come", () => {
    expect(isProactiveDue({
      frequencyHours: 24,
      lastChatAt: new Date(now.getTime() - 2 * 3_600_000),
      presence: "active",
      now,
    })).toBe(false);
  });

  it("does not speak for a persona the user asked to be left alone", () => {
    expect(isProactiveDue({
      frequencyHours: 1,
      lastChatAt: null,
      presence: "quiet",
      now,
    })).toBe(false);
  });

  it("does not speak for a persona that has graduated", () => {
    expect(isProactiveDue({
      frequencyHours: 1,
      lastChatAt: null,
      presence: "asleep",
      now,
    })).toBe(false);
  });
});

describe("a persona whose timing has been measured", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const lastChatAt = new Date(now.getTime() - 25 * 3_600_000);

  const measured = fitBehaviorProfile([
    { gapSeconds: 60 },
    { gapSeconds: 90 },
    { gapSeconds: 120 },
    { gapSeconds: 180 },
    { gapSeconds: 240 },
    { gapSeconds: 300 },
    { gapSeconds: 360 },
    { gapSeconds: 420 },
  ]);
  if (!measured) throw new Error("the fixture profile could not be fitted");

  it("speaks at its own moment, and not at the fixed one", () => {
    clearProactiveDeadlines();

    const deadline = resolveProactiveDeadline({
      personaId: 1,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: measured,
    })!;

    // The window the user bought is still the floor; the persona's own
    // history decides what happens on top of it.
    expect(deadline.sampled).toBe(true);
    expect(deadline.at.getTime()).toBeGreaterThanOrEqual(deadline.eligibleAt.getTime());
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(deadline.at.getTime() - 1000),
        personaId: 1,
        behaviorProfile: measured,
      }),
    ).toBe(false);
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: deadline.at,
        personaId: 1,
        behaviorProfile: measured,
      }),
    ).toBe(true);
  });

  it("does not speak more often than the user bought", () => {
    clearProactiveDeadlines();

    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 23 * 3_600_000),
        personaId: 2,
        behaviorProfile: measured,
      }),
    ).toBe(false);
  });

  it("keeps a persona nobody measured exactly as it was", () => {
    clearProactiveDeadlines();

    const deadline = resolveProactiveDeadline({
      personaId: 3,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: null,
    })!;

    expect(deadline.sampled).toBe(false);
    expect(deadline.at.getTime()).toBe(lastChatAt.getTime() + 24 * 3_600_000);
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 24 * 3_600_000),
        personaId: 3,
        behaviorProfile: null,
      }),
    ).toBe(true);
  });
});

describe("buildProactiveInstruction", () => {
  it("says that nobody has written", () => {
    const instruction = buildProactiveInstruction({
      daysSinceLastChat: 5,
      userHour: 3,
      personaHour: 3,
      hoursApart: null,
      userMood: null,
      relationshipEnded: false,
    });
    expect(instruction).toContain("先开口");
    expect(instruction).toContain("5 天");
  });

  it("knows the user is not doing well without saying so", () => {
    const instruction = buildProactiveInstruction({
      daysSinceLastChat: 0,
      userHour: 12,
      personaHour: 12,
      hoursApart: null,
      userMood: "down",
      relationshipEnded: false,
    });
    expect(instruction).toContain("状态");
    expect(instruction).toContain("不要把这件事说出来");
  });

  it("says how far apart the clocks are", () => {
    // "Six hours ahead" is a thing a person can act on. "Another
    // timezone" is not — it is the reason a message lands at three in
    // the morning.
    const instruction = buildProactiveInstruction({
      daysSinceLastChat: 1,
      userHour: 22,
      personaHour: 4,
      hoursApart: 6,
      userMood: null,
      relationshipEnded: false,
    });
    expect(instruction).toContain("6 个小时");
  });

  it("writes the English instruction in English", () => {
    const instruction = buildProactiveInstruction({
      daysSinceLastChat: 2,
      userHour: 12,
      personaHour: 12,
      hoursApart: null,
      userMood: null,
      relationshipEnded: false,
    }, "en");
    expect(instruction).toContain("starting this conversation");
  });
});

describe("the distance between two people", () => {
  it("knows the two states", () => {
    expect(isReachability("reachable")).toBe(true);
    expect(isReachability("unreachable")).toBe(true);
    expect(isReachability("gone")).toBe(false);
  });

  it("says nothing when they can reach each other", () => {
    expect(buildReachabilityNote("reachable")).toBe("");
  });

  it("changes the register when they cannot", () => {
    const note = buildReachabilityNote("unreachable");
    expect(note).toContain("联系不上");
    expect(note).toContain("不要问 TA 什么时候回来");
  });

  it("reaches the prompt", () => {
    const prompt = buildSystemPrompt(
      {
        id: 1, userId: 1, name: "小A", relationshipDesc: "异地",
        togetherFrom: "2023-01-01", togetherTo: null,
        emotionalState: "warm", personaData: {},
      },
      {
        now: new Date("2026-06-01T12:00:00Z"),
        reachability: "unreachable",
      },
    );
    expect(prompt).toContain("【你们现在联系不上】");
  });

  it("leaves the prompt alone when they can", () => {
    const prompt = buildSystemPrompt(
      {
        id: 1, userId: 1, name: "小A", relationshipDesc: "恋人",
        togetherFrom: "2023-01-01", togetherTo: null,
        emotionalState: "warm", personaData: {},
      },
      {
        now: new Date("2026-06-01T12:00:00Z"),
        reachability: "reachable",
      },
    );
    expect(prompt).not.toContain("【你们现在联系不上】");
  });
});

describe("how long it has been", () => {
  it("counts the days since the last contact", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(daysSinceContact(new Date("2026-06-07T12:00:00Z"), now)).toBe(3);
    expect(daysSinceContact(new Date("2026-06-10T06:00:00Z"), now)).toBe(0);
  });

  it("has no answer when they have never spoken", () => {
    expect(daysSinceContact(null)).toBeNull();
    expect(daysSinceContact(undefined)).toBeNull();
  });

  it("does not go backwards", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(daysSinceContact(new Date("2026-06-12T12:00:00Z"), now)).toBe(0);
  });
});

describe("a trigger is a trigger for a while, and then it is a memory", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("holds the persona back while it is fresh", () => {
    const section = buildRelationshipSection(
      [{
        kind: "triggered",
        title: "看到 TA 和别人在一起",
        happenedAt: new Date("2026-06-09T12:00:00Z"),
      }],
      null,
      "zh",
      now,
    );
    expect(section).toContain("用户现在难受");
  });

  it("stops holding the persona back once it is old", () => {
    // Six months later the trigger is a memory, not a mood. If the
    // instruction never expired, the persona would be permanently
    // gentle — which is not restraint, it is a tone.
    const section = buildRelationshipSection(
      [{
        kind: "triggered",
        title: "看到 TA 和别人在一起",
        happenedAt: new Date("2025-12-01T12:00:00Z"),
      }],
      null,
      "zh",
      now,
    );
    expect(section).not.toContain("用户现在难受");
    // The event itself is still known.
    expect(section).toContain("看到 TA 和别人在一起");
  });
});
