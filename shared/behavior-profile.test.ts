import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_MAX_GAP_SEC,
  BEHAVIOR_MIN_GAP_SEC,
  BEHAVIOR_MIN_SAMPLES,
  fitBehaviorProfile,
  ksStatistic,
  normalizeBehaviorProfile,
  sampleBurstSize,
  sampleProactiveDelayMs,
  replyDelayQuantileSec,
  sampleReplyDelayMs,
  type BehaviorSample,
} from "./behavior-profile";

/**
 * The timing.
 *
 * A persona that replies on a schedule is a schedule, not a person. These
 * tests are about the difference: the delay has to come out of the
 * person's own history, spread out the way their history spreads, and it
 * has to fall back to the old behaviour when there is no history to
 * learn from.
 */
const samples: BehaviorSample[] = Array.from({ length: 24 }, (_, i) => ({
  gapSeconds: 20 + (i % 6) * 15,
  burstSize: (i % 3) + 1,
  hour: i % 24,
  personaSpokeFirst: i % 5 === 0,
}));

describe("fitting a profile", () => {
  it("refuses to fit on too little", () => {
    expect(fitBehaviorProfile(samples.slice(0, BEHAVIOR_MIN_SAMPLES - 1))).toBeNull();
  });

  it("fits on enough", () => {
    const profile = fitBehaviorProfile(samples);
    expect(profile).not.toBeNull();
    expect(profile!.samples).toBe(samples.length);
    expect(profile!.replyGapMedianSec).toBeGreaterThan(0);
  });

  it("keeps the bursts it saw", () => {
    const profile = fitBehaviorProfile(samples);
    expect(profile!.burstSizes.length).toBeGreaterThan(1);
  });

  it("keeps the hours the person is active", () => {
    const profile = fitBehaviorProfile(samples);
    expect(profile!.activeHours.length).toBeGreaterThan(0);
    for (const hour of profile!.activeHours) {
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });

  it("records when it was measured", () => {
    const profile = fitBehaviorProfile(samples, new Date("2026-01-02T03:04:05Z"));
    expect(profile!.measuredAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("ignores a gap that is not a gap", () => {
    const broken = [
      ...samples,
      { gapSeconds: 0 },
      { gapSeconds: Number.NaN },
    ];
    const profile = fitBehaviorProfile(broken);
    expect(profile).not.toBeNull();
    // The count is of the exchanges it was given; the fit only used the
    // ones that could be a gap.
    expect(profile!.samples).toBe(broken.length);
  });

  it("has one message in a go when no bursts were seen", () => {
    const bare = samples.map((s) => ({ gapSeconds: s.gapSeconds }));
    expect(fitBehaviorProfile(bare)!.burstSizes).toEqual([1]);
  });

  it("has no rate of speaking first when nothing was said about it", () => {
    const bare = samples.map((s) => ({ gapSeconds: s.gapSeconds }));
    expect(fitBehaviorProfile(bare)!.proactiveRate).toBe(0);
  });

  it("has no active hours when no hour was recorded", () => {
    const bare = samples.map((s) => ({ gapSeconds: s.gapSeconds }));
    expect(fitBehaviorProfile(bare)!.activeHours).toEqual([]);
  });

  it("clamps a median that could not have happened", () => {
    const tiny = fitBehaviorProfile(
      Array.from({ length: 8 }, () => ({ gapSeconds: 0.01 })),
    );
    const huge = fitBehaviorProfile(
      Array.from({ length: 8 }, () => ({ gapSeconds: 1e9 })),
    );
    expect(tiny!.replyGapMedianSec).toBe(BEHAVIOR_MIN_GAP_SEC);
    expect(huge!.replyGapMedianSec).toBe(BEHAVIOR_MAX_GAP_SEC);
  });
});

describe("reading a stored profile", () => {
  it("is null when there is nothing stored", () => {
    expect(normalizeBehaviorProfile(null)).toBeNull();
    expect(normalizeBehaviorProfile(undefined)).toBeNull();
  });

  it("is null when the profile was fitted from too little", () => {
    expect(normalizeBehaviorProfile({ replyGapMedianSec: 30, samples: 2 })).toBeNull();
  });

  it("is null when the median is missing", () => {
    expect(normalizeBehaviorProfile({ samples: 20 })).toBeNull();
  });

  it("keeps a usable profile", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 45,
      replyGapLogSigma: 0.7,
      burstSizes: [1, 2],
      proactiveRate: 0.2,
      activeHours: [9, 21],
      samples: 30,
    });
    expect(profile).not.toBeNull();
    expect(profile!.replyGapMedianSec).toBe(45);
  });

  it("has no profile when it was fitted from nothing", () => {
    expect(
      normalizeBehaviorProfile({ replyGapMedianSec: 45, samples: -5 }),
    ).toBeNull();
  });

  it("counts the samples it was given", () => {
    expect(
      normalizeBehaviorProfile({ replyGapMedianSec: 45, samples: "30" })!.samples,
    ).toBe(30);
  });

  it("clamps a gap that could not have happened", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 999999999,
      samples: 30,
    });
    expect(profile!.replyGapMedianSec).toBe(BEHAVIOR_MAX_GAP_SEC);
  });

  it("clamps a gap that was too short to have happened", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 1,
      samples: 30,
    });
    expect(profile!.replyGapMedianSec).toBe(BEHAVIOR_MIN_GAP_SEC);
  });

  it("keeps the spread inside the scale it is on", () => {
    expect(
      normalizeBehaviorProfile({
        replyGapMedianSec: 45,
        replyGapLogSigma: 9,
        samples: 30,
      })!.replyGapLogSigma,
    ).toBe(2);
    expect(
      normalizeBehaviorProfile({
        replyGapMedianSec: 45,
        replyGapLogSigma: -1,
        samples: 30,
      })!.replyGapLogSigma,
    ).toBe(0);
  });

  it("has a spread to speak of when none was stored", () => {
    expect(
      normalizeBehaviorProfile({ replyGapMedianSec: 45, samples: 30 })!
        .replyGapLogSigma,
    ).toBe(0.6);
  });

  it("keeps the rate of speaking first inside its own scale", () => {
    expect(
      normalizeBehaviorProfile({
        replyGapMedianSec: 45,
        proactiveRate: 3,
        samples: 30,
      })!.proactiveRate,
    ).toBe(1);
    expect(
      normalizeBehaviorProfile({
        replyGapMedianSec: 45,
        proactiveRate: -1,
        samples: 30,
      })!.proactiveRate,
    ).toBe(0);
    expect(
      normalizeBehaviorProfile({ replyGapMedianSec: 45, samples: 30 })!
        .proactiveRate,
    ).toBe(0);
  });

  it("never keeps a burst of no messages at all", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 45,
      burstSizes: [0, -2, 3],
      samples: 30,
    });
    expect(profile!.burstSizes).toEqual([1, 1, 3]);
  });

  it("has one message in a go when no bursts were seen", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 45,
      burstSizes: [],
      samples: 30,
    });
    expect(profile!.burstSizes).toEqual([1]);
  });

  it("keeps only the hours of a day", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 45,
      activeHours: [9, 24, -1, 21],
      samples: 30,
    });
    expect(profile!.activeHours).toEqual([9, 21]);
  });

  it("remembers when it was measured", () => {
    const profile = normalizeBehaviorProfile({
      replyGapMedianSec: 45,
      samples: 30,
      measuredAt: "2026-01-02T03:04:05.000Z",
    });
    expect(profile!.measuredAt).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("sampling a delay", () => {
  const profile = fitBehaviorProfile(samples)!;

  it("spreads out rather than returning one number", () => {
    const values = new Set<number>();
    for (let i = 0; i < 80; i++) values.add(sampleReplyDelayMs(profile));
    expect(values.size).toBeGreaterThan(10);
  });

  it("stays inside the bounds a person could live inside", () => {
    for (let i = 0; i < 200; i++) {
      const ms = sampleReplyDelayMs(profile);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(BEHAVIOR_MAX_GAP_SEC * 1000);
    }
  });

  it("falls back to the old behaviour when there is no profile", () => {
    expect(sampleReplyDelayMs(null)).toBe(30_000);
  });

  it("is reproducible when the randomness is given", () => {
    // The same random source, from the same starting point, has to give
    // the same answer — otherwise the persona's timing would change
    // every time the process restarted.
    const makeRng = () => {
      let seed = 0.5;
      return () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
    };
    const a = sampleReplyDelayMs(profile, makeRng());
    const b = sampleReplyDelayMs(profile, makeRng());
    expect(a).toBe(b);
  });

  it("survives a random source that only ever says zero", () => {
    // u1 is nudged off zero, so the tail of the distribution is still a
    // number and not the logarithm of nothing.
    const delay = sampleReplyDelayMs(profile, () => 0);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThan(profile.replyGapMedianSec * 1000);
  });

  it("survives a random source that only ever says one", () => {
    const delay = sampleReplyDelayMs(profile, () => 1);
    expect(delay).toBeCloseTo(profile.replyGapMedianSec * 1000, -1);
  });

  it("survives a random source that says something impossible", () => {
    const delay = sampleReplyDelayMs(profile, () => 7);
    expect(Number.isFinite(delay)).toBe(true);
  });

  it("never returns a delay shorter than a person could take", () => {
    const draw = [1e-6, 0.5];
    let i = 0;
    const delay = sampleReplyDelayMs(profile, () => draw[i++ % draw.length]);
    expect(delay).toBe(BEHAVIOR_MIN_GAP_SEC * 1000);
  });

  it("never returns a delay longer than a person could take", () => {
    const wide = normalizeBehaviorProfile({
      replyGapMedianSec: 60,
      replyGapLogSigma: 2,
      samples: 30,
    })!;
    expect(sampleReplyDelayMs(wide, () => 0)).toBe(
      BEHAVIOR_MAX_GAP_SEC * 1000,
    );
  });
});

describe("the percentiles", () => {
  const profile = fitBehaviorProfile(samples)!;

  it("puts the median at the median", () => {
    const median = replyDelayQuantileSec(profile, 0.5);
    expect(median).toBeCloseTo(profile.replyGapMedianSec, 0);
  });

  it("orders the percentiles", () => {
    // The tenth percentile is faster than the ninetieth — a person
    // who is quick half the time is quicker half the time.
    expect(replyDelayQuantileSec(profile, 0.1)).toBeLessThan(
      replyDelayQuantileSec(profile, 0.5),
    );
    expect(replyDelayQuantileSec(profile, 0.9)).toBeGreaterThan(
      replyDelayQuantileSec(profile, 0.5),
    );
  });

  it("answers for a percentile nobody measured", () => {
    // The shape was fitted, so the percentile for a gap that never
    // happened is still there.
    expect(Number.isFinite(replyDelayQuantileSec(profile, 0.97))).toBe(true);
  });

  it("stays inside the bounds a person could live inside", () => {
    expect(replyDelayQuantileSec(profile, 0.001)).toBeGreaterThanOrEqual(
      BEHAVIOR_MIN_GAP_SEC,
    );
    expect(replyDelayQuantileSec(profile, 0.999)).toBeLessThanOrEqual(
      BEHAVIOR_MAX_GAP_SEC,
    );
  });

  it("has nothing to say without a profile", () => {
    expect(replyDelayQuantileSec(null, 0.5)).toBe(0);
  });

  it("answers for the ends of the distribution", () => {
    expect(replyDelayQuantileSec(profile, 0)).toBe(BEHAVIOR_MIN_GAP_SEC);
    // The far end of the tail is still the person's own shape.
    expect(replyDelayQuantileSec(profile, 1)).toBeGreaterThan(
      replyDelayQuantileSec(profile, 0.9),
    );
  });

  it("does not read a percentile outside the scale", () => {
    expect(replyDelayQuantileSec(profile, -1)).toBe(replyDelayQuantileSec(profile, 0));
    expect(replyDelayQuantileSec(profile, 2)).toBe(replyDelayQuantileSec(profile, 1));
  });

  it("has no opinion about a percentile that is not a number", () => {
    expect(replyDelayQuantileSec(profile, Number.NaN)).toBeCloseTo(
      replyDelayQuantileSec(profile, 0.5),
      6,
    );
  });

  it("never answers with a gap that could not have happened", () => {
    const wide = normalizeBehaviorProfile({
      replyGapMedianSec: 60,
      replyGapLogSigma: 2,
      samples: 30,
    })!;
    expect(replyDelayQuantileSec(wide, 1)).toBe(BEHAVIOR_MAX_GAP_SEC);
  });
});

describe("sampling a burst", () => {
  const profile = fitBehaviorProfile(samples)!;

  it("draws from the bursts that were observed", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(sampleBurstSize(profile));
    for (const size of seen) {
      expect(profile.burstSizes).toContain(size);
    }
  });

  it("is one message when there is no profile", () => {
    expect(sampleBurstSize(null)).toBe(1);
  });

  it("takes the first burst when the source says zero", () => {
    expect(sampleBurstSize(profile, () => 0)).toBe(profile.burstSizes[0]);
  });

  it("takes the last burst when the source says one", () => {
    expect(sampleBurstSize(profile, () => 1)).toBe(
      profile.burstSizes[profile.burstSizes.length - 1],
    );
  });

  it("survives a source that says something impossible", () => {
    expect(sampleBurstSize(profile, () => 7)).toBe(
      profile.burstSizes[profile.burstSizes.length - 1],
    );
  });

  it("is one message when the profile has no bursts to draw from", () => {
    expect(sampleBurstSize({ ...profile, burstSizes: [] })).toBe(1);
  });

  it("never draws a burst of no messages at all", () => {
    expect(sampleBurstSize({ ...profile, burstSizes: [0] }, () => 0)).toBe(1);
  });
});

describe("sampling the wait before speaking first", () => {
  const profile = fitBehaviorProfile(samples)!;

  it("waits longer after a longer silence — as a distribution, not per draw", () => {
    // The claim is about the shape of the wait, not about any single
    // draw: each silence draws its own base delay, so one long silence
    // can still produce a shorter wait than one short silence. What has
    // to hold is that the *typical* wait grows with the silence, which
    // is what the stretch is for.
    const mean = (silenceMs: number) => {
      let total = 0;
      for (let i = 0; i < 200; i++) total += sampleProactiveDelayMs(profile, silenceMs);
      return total / 200;
    };
    const shortSilence = mean(60 * 60 * 1000);
    const longSilence = mean(20 * 60 * 60 * 1000);
    expect(longSilence).toBeGreaterThan(shortSilence);
  });

  it("never waits more than a day — after that it is a new conversation", () => {
    expect(sampleProactiveDelayMs(profile, 48 * 60 * 60 * 1000)).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  it("falls back to the old behaviour when there is no profile", () => {
    expect(sampleProactiveDelayMs(null, 60 * 60 * 1000)).toBe(30_000);
  });

  it("does not stretch the wait for a silence that has not happened yet", () => {
    const makeRng = () => {
      let seed = 0.5;
      return () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
    };
    // A silence of nothing and a silence of less than nothing are the
    // same silence.
    expect(sampleProactiveDelayMs(profile, -1000, makeRng())).toBe(
      sampleProactiveDelayMs(profile, 0, makeRng()),
    );
  });
});

describe("the distance between two distributions", () => {
  it("is zero for the same distribution", () => {
    expect(ksStatistic([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(0, 6);
  });

  it("is large for two distributions that do not overlap", () => {
    expect(ksStatistic([1, 2, 3], [100, 200, 300])).toBeGreaterThan(0.9);
  });

  it("is one when one of them is empty", () => {
    expect(ksStatistic([], [1])).toBe(1);
    expect(ksStatistic([1], [])).toBe(1);
  });

  it("is how far apart the two are when one runs out first", () => {
    // The short sample is used up after the first value, and the long
    // one carries on alone.
    expect(ksStatistic([1, 2, 3, 4, 5], [1])).toBeCloseTo(0.8, 6);
  });
});
