import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BEHAVIOR_MIN_SAMPLES,
  fitBehaviorProfile,
  sampleProactiveDelayMs,
} from "@shared/behavior-profile";

const setPersonaBehaviorProfile = vi.fn();
const getCollectedMessagesForPersona = vi.fn();

vi.mock("../db", () => ({
  setPersonaBehaviorProfile: (...a: unknown[]) => setPersonaBehaviorProfile(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
}));

import {
  OLD_FIXED_REPLY_GAP_SEC,
  compareTimingToRecord,
  exchangesFromRecords,
  loadBehaviorProfile,
  measureAndSaveBehaviorProfile,
  measureBehaviorProfile,
  saveBehaviorProfile,
  seededRandom,
} from "./behavior-profile";

/** A row as the collectors store it. */
function record(
  role: string,
  timestamp: string | null,
  content = "在吗",
): { role: string; content: string; timestamp: Date | null } {
  return {
    role,
    content,
    timestamp: timestamp ? new Date(timestamp) : null,
  };
}

describe("reading the record", () => {
  it("pairs a user message with the reply that followed it", () => {
    const exchanges = exchangesFromRecords([
      record("user", "2026-05-20T10:00:00Z"),
      record("assistant", "2026-05-20T10:02:30Z", "在的"),
    ]);

    expect(exchanges).toHaveLength(1);
    // Two and a half minutes between the message and the answer.
    const gap = (exchanges[0].personaAt.getTime() - exchanges[0].userAt.getTime()) / 1000;
    expect(gap).toBe(150);
    expect(exchanges[0].personaSpokeFirst).toBe(false);
    expect(exchanges[0].burstSize).toBe(1);
  });

  it("skips the rows that were never timed", () => {
    // A gap that was never recorded is not a gap of zero — it is a gap
    // nobody knows, and pretending otherwise would put a spike at zero
    // into the distribution.
    const exchanges = exchangesFromRecords([
      record("user", null),
      record("assistant", "2026-05-20T10:02:30Z"),
    ]);

    expect(exchanges).toHaveLength(1);
    // With the user message gone, there is nothing to pair the reply
    // with, so the reply counts as having spoken first.
    expect(exchanges[0].personaSpokeFirst).toBe(true);
  });

  it("records a persona that spoke first as having spoken first", () => {
    const exchanges = exchangesFromRecords([
      record("assistant", "2026-05-20T10:00:00Z", "在干嘛"),
      record("user", "2026-05-20T10:05:00Z"),
      record("assistant", "2026-05-20T10:06:00Z", "刚下课"),
    ]);

    expect(exchanges).toHaveLength(2);
    expect(exchanges[0].personaSpokeFirst).toBe(true);
    expect(exchanges[1].personaSpokeFirst).toBe(false);
  });

  it("counts a run of messages as one reply", () => {
    // Three messages in a row is one reply that happened to be sent in
    // three pieces, not three replies.
    const exchanges = exchangesFromRecords([
      record("user", "2026-05-20T10:00:00Z"),
      record("assistant", "2026-05-20T10:01:00Z", "在"),
      record("assistant", "2026-05-20T10:01:05Z", "在的"),
      record("assistant", "2026-05-20T10:01:20Z", "怎么啦"),
    ]);

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].burstSize).toBe(3);
  });

  it("measures the hour in the persona's own timezone", () => {
    // Half past eleven at night in UTC is seven in the morning in
    // Shanghai. The persona's day is not the server's day.
    const rows = [record("user", "2026-05-20T23:30:00Z"), record("assistant", "2026-05-20T23:31:00Z")];

    expect(exchangesFromRecords(rows, { personaTimezone: "UTC" })[0].hour).toBe(23);
    expect(exchangesFromRecords(rows, { personaTimezone: "Asia/Shanghai" })[0].hour).toBe(7);
  });

  it("leaves out a row whose time cannot be read", () => {
    const exchanges = exchangesFromRecords([
      record("user", "2026-05-20T10:00:00Z"),
      record("assistant", "2026-05-20T10:02:30Z", "在的"),
      { role: "assistant", content: "在的", timestamp: new Date("nonsense") },
    ]);

    // A time nobody can read is not a time; the row is dropped rather
    // than counted as another message of the same reply.
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].burstSize).toBe(1);
  });

  it("puts the rows in order before it measures them", () => {
    const exchanges = exchangesFromRecords([
      record("assistant", "2026-05-20T10:02:30Z", "在的"),
      record("user", "2026-05-20T10:00:00Z"),
    ]);

    // The collectors store what they found, and what they found is not
    // always in order — so the rows are sorted by the time they claim.
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].personaSpokeFirst).toBe(false);
  });

  it("does not make an exchange out of two messages in a row", () => {
    const exchanges = exchangesFromRecords([
      record("user", "2026-05-20T10:00:00Z"),
      record("user", "2026-05-20T10:01:00Z"),
    ]);

    // The user spoke twice and there was no reply in between, so
    // there is nothing to measure.
    expect(exchanges).toHaveLength(0);
  });

  it("reads a message that is neither side as the persona's", () => {
    const exchanges = exchangesFromRecords([
      record("user", "2026-05-20T10:00:00Z"),
      record("system", "2026-05-20T10:00:30Z", "对方正在输入"),
    ]);

    // Only the user's own side is the user's; everything else is
    // something the persona said.
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].personaSpokeFirst).toBe(false);
  });
});

describe("fitting the profile", () => {
  function exchanges(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      userAt: new Date(`2026-05-20T10:00:00Z`),
      personaAt: new Date(`2026-05-20T10:0${index % 9}:00Z`),
      burstSize: 1 + (index % 3),
      hour: 10,
      personaSpokeFirst: false,
    }));
  }

  it("says nothing when there is not enough of a record", () => {
    expect(measureBehaviorProfile({ exchanges: exchanges(BEHAVIOR_MIN_SAMPLES - 1) })).toBeNull();
  });

  it("fits a profile when there is enough of a record", () => {
    const profile = measureBehaviorProfile({ exchanges: exchanges(BEHAVIOR_MIN_SAMPLES + 2) });

    expect(profile).not.toBeNull();
    expect(profile!.samples).toBe(BEHAVIOR_MIN_SAMPLES + 2);
    expect(profile!.replyGapMedianSec).toBeGreaterThan(0);
    expect(profile!.measuredAt).toBeTruthy();
  });

  it("measures a reply that was stamped before the message it answers as nothing", () => {
    const profile = measureBehaviorProfile({
      exchanges: Array.from({ length: BEHAVIOR_MIN_SAMPLES }, () => ({
        userAt: new Date("2026-05-20T10:02:00Z"),
        personaAt: new Date("2026-05-20T10:00:00Z"),
        burstSize: 1,
        hour: 10,
        personaSpokeFirst: false,
      })),
    });

    // A gap cannot be negative, so it is measured as zero — and a zero
    // is the one thing the fit knows how to throw away.
    expect(profile).toBeNull();
  });

  it("does not let a persona that spoke first put a gap into the distribution", () => {
    const profile = measureBehaviorProfile({
      exchanges: Array.from({ length: BEHAVIOR_MIN_SAMPLES }, () => ({
        userAt: new Date("2026-05-20T10:00:00Z"),
        personaAt: new Date("2026-05-20T10:00:00Z"),
        burstSize: 1,
        hour: 10,
        personaSpokeFirst: true,
      })),
    });

    // There was no message to answer, so there was no gap to measure —
    // and a fit on nothing is not a fit.
    expect(profile).toBeNull();
  });
});

describe("the profile on the persona", () => {
  it("is nothing when the persona has never been measured", () => {
    expect(loadBehaviorProfile({})).toBeNull();
    expect(loadBehaviorProfile({ behaviorProfile: null })).toBeNull();
  });

  it("is nothing when there is no persona at all", () => {
    // A caller that lost the persona must not measure a profile out of
    // thin air.
    expect(loadBehaviorProfile(null as any)).toBeNull();
    expect(loadBehaviorProfile("not a persona" as any)).toBeNull();
  });

  it("is nothing when what is stored cannot be read", () => {
    // A profile written by an older version, or corrupted on the way
    // in, must not become a profile with zeroes in it.
    expect(loadBehaviorProfile({ behaviorProfile: { replyGapMedianSec: "soon" } })).toBeNull();
    expect(loadBehaviorProfile({ behaviorProfile: { replyGapMedianSec: 60, samples: 2 } })).toBeNull();
    expect(loadBehaviorProfile({ behaviorProfile: "not a profile" })).toBeNull();
  });

  it("is the profile when it is stored", () => {
    const profile = measureBehaviorProfile({
      exchanges: Array.from({ length: 10 }, () => ({
        userAt: new Date("2026-05-20T10:00:00Z"),
        personaAt: new Date("2026-05-20T10:02:00Z"),
        burstSize: 2,
        hour: 10,
        personaSpokeFirst: false,
      })),
    });

    const loaded = loadBehaviorProfile({ behaviorProfile: profile });
    expect(loaded?.replyGapMedianSec).toBe(profile?.replyGapMedianSec);
  });
});

describe("keeping the profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPersonaBehaviorProfile.mockResolvedValue(undefined);
  });

  it("writes the measurement onto the persona", async () => {
    const profile = fitBehaviorProfile(
      Array.from({ length: 10 }, () => ({ gapSeconds: 120 })),
      new Date("2026-05-20T10:00:00Z"),
    );

    await saveBehaviorProfile(7, 3, profile);

    expect(setPersonaBehaviorProfile).toHaveBeenCalledWith(7, 3, profile);
  });

  it("clears it when there is nothing to keep", async () => {
    await saveBehaviorProfile(7, 3, null);

    expect(setPersonaBehaviorProfile).toHaveBeenCalledWith(7, 3, null);
  });

  it("measures the persona from the records it collected", async () => {
    // Ten exchanges: a message, then an answer a minute later.
    const rows: Array<{ role: string; content: string; timestamp: Date | null }> = [];
    for (let index = 0; index < 10; index++) {
      const minute = String(index * 2).padStart(2, "0");
      rows.push(record("user", `2026-05-20T10:${minute}:00Z`));
      rows.push(record("assistant", `2026-05-20T10:${minute}:30Z`));
    }
    getCollectedMessagesForPersona.mockResolvedValue(rows);

    const profile = await measureAndSaveBehaviorProfile({ personaId: 7, userId: 3 });

    expect(profile).not.toBeNull();
    expect(setPersonaBehaviorProfile).toHaveBeenCalledWith(7, 3, profile);
  });

  it("leaves the stored profile alone when there is not enough to measure", async () => {
    getCollectedMessagesForPersona.mockResolvedValue([record("user", "2026-05-20T10:00:00Z")]);

    const profile = await measureAndSaveBehaviorProfile({ personaId: 7, userId: 3 });

    expect(profile).toBeNull();
    // Throwing away a measurement because the records happen to be thin
    // would be worse than keeping the one that is already there.
    expect(setPersonaBehaviorProfile).not.toHaveBeenCalled();
  });

  it("measures nothing when the records cannot be read", async () => {
    getCollectedMessagesForPersona.mockRejectedValue(new Error("the database is down"));

    const profile = await measureAndSaveBehaviorProfile({ personaId: 7, userId: 3 });

    // The collected records are the only honest source, so a read that
    // fails measures nothing rather than measuring something wrong.
    expect(profile).toBeNull();
    expect(setPersonaBehaviorProfile).not.toHaveBeenCalled();
  });

  it("measures the hours in the persona's own timezone", async () => {
    // Half past eleven at night in UTC is seven in the morning in
    // Shanghai, and the hours of the day belong to the persona's day.
    const rows: Array<{ role: string; content: string; timestamp: Date | null }> = [];
    for (let index = 0; index < 10; index++) {
      const minute = String(index * 2).padStart(2, "0");
      rows.push(record("user", `2026-05-20T23:${minute}:00Z`));
      rows.push(record("assistant", `2026-05-20T23:${minute}:30Z`, "在的"));
    }
    getCollectedMessagesForPersona.mockResolvedValue(rows);

    const profile = await measureAndSaveBehaviorProfile({
      personaId: 7,
      userId: 3,
      personaTimezone: "Asia/Shanghai",
    });

    expect(profile?.activeHours).toEqual([7]);
  });
});

describe("the shape of the uncertainty", () => {
  it("is a spread and not a single number", () => {
    const profile = fitBehaviorProfile([
      { gapSeconds: 60 },
      { gapSeconds: 90 },
      { gapSeconds: 120 },
      { gapSeconds: 180 },
      { gapSeconds: 240 },
      { gapSeconds: 300 },
      { gapSeconds: 360 },
      { gapSeconds: 420 },
      { gapSeconds: 480 },
      { gapSeconds: 540 },
    ]);
    expect(profile).not.toBeNull();

    const draws = Array.from({ length: 50 }, () =>
      sampleProactiveDelayMs(profile, 60 * 60 * 1000),
    );
    const distinct = new Set(draws);

    // One number would be a schedule wearing a distribution's clothes.
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe("measuring the gap between the app and the record", () => {
  const recorded = [60, 120, 180, 240, 300, 360, 420, 480];

  it("shows how far the old fixed rule was from the record", () => {
    const result = compareTimingToRecord(null, recorded);

    // Eight numbers, so the median is the middle of the two in the
    // middle: (240 + 300) / 2.
    expect(result.recordMedian).toBe(270);
    expect(result.profileMedian).toBe(OLD_FIXED_REPLY_GAP_SEC);
    // The fixed delay is nowhere near the person's own timing.
    expect(result.ks).toBeGreaterThan(0.5);
  });

  it("shows the persona's own distribution is closer to the record", () => {
    const profile = fitBehaviorProfile(recorded.map((gapSeconds) => ({ gapSeconds })));
    expect(profile).not.toBeNull();

    const result = compareTimingToRecord(profile, recorded);

    expect(result.profileMedian).toBe(profile!.replyGapMedianSec);
    expect(result.ks).toBeLessThan(compareTimingToRecord(null, recorded).ks);
  });

  it("gives the same number every time it is measured", () => {
    const profile = fitBehaviorProfile(recorded.map((gapSeconds) => ({ gapSeconds })));

    // A baseline that changes every time it is read is not a baseline.
    expect(compareTimingToRecord(profile, recorded)).toEqual(
      compareTimingToRecord(profile, recorded),
    );
  });

  it("leaves out the gaps that are not gaps", () => {
    const result = compareTimingToRecord(null, [0, -30, Number.NaN, 60, 120, 180, 240, 300]);

    // A gap of zero is not a gap — it is the persona answering at the
    // same instant, which the record does not say. What is left is
    // five numbers, and the middle of five is the third.
    expect(result.recordMedian).toBe(180);
  });

  it("has nothing to compare when the record has no gaps at all", () => {
    const result = compareTimingToRecord(null, [0, -1]);

    // Two distributions that are both empty are as far apart as the
    // measure can say.
    expect(result.recordMedian).toBe(0);
    expect(result.ks).toBe(1);
  });
});

describe("the seeded draw", () => {
  it("draws the same sequence for the same seed", () => {
    const first = seededRandom("persona:1");
    const second = seededRandom("persona:1");

    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it("draws something else for another seed", () => {
    const first = seededRandom("persona:1");
    const second = seededRandom("persona:2");

    expect(first()).not.toBe(second());
  });
});
