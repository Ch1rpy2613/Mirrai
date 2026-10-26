import { describe, expect, it, vi, beforeEach } from "vitest";
import { fitBehaviorProfile } from "@shared/behavior-profile";

const getUserById = vi.fn();
const getLastMessageAt = vi.fn();
const getRecentUserMood = vi.fn();

vi.mock("../db", () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
}));

vi.mock("../llm", () => ({
  llmService: {
    invoke: async () => "",
    invokeWithProvider: async () => "",
    streamWithProvider: () => {
      throw new Error("not used");
    },
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => null,
}));

import {
  clearProactiveDeadlines,
  isProactiveDue,
  resolveProactiveDeadline,
} from "./proactive";

/** A persona whose timing has been measured. */
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
if (!profile) throw new Error("the fixture profile could not be fitted");

/** A persona who answers an hour later — a different person entirely. */
const slowProfile = fitBehaviorProfile(
  Array.from({ length: 10 }, () => ({ gapSeconds: 3600 })),
);
if (!slowProfile) throw new Error("the fixture profile could not be fitted");

const lastChatAt = new Date("2026-06-01T00:00:00Z");
const HOUR = 3_600_000;

describe("a persona whose timing has not been measured", () => {
  beforeEach(() => {
    clearProactiveDeadlines();
  });

  it("waits exactly as long as it always did", () => {
    // The old rule: the window the user bought, and not a moment
    // longer. A persona nobody has measured must not notice this change.
    const deadline = resolveProactiveDeadline({
      personaId: 1,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: null,
    });

    expect(deadline?.sampled).toBe(false);
    expect(deadline?.at.getTime()).toBe(lastChatAt.getTime() + 24 * HOUR);
    expect(deadline?.eligibleAt.getTime()).toBe(lastChatAt.getTime() + 24 * HOUR);
  });

  it("is due the moment the bought window is over", () => {
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 24 * HOUR - 1000),
      }),
    ).toBe(false);

    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 24 * HOUR),
      }),
    ).toBe(true);
  });

  it("says nothing when the user never bought it", () => {
    expect(
      isProactiveDue({
        frequencyHours: 0,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 365 * 24 * HOUR),
      }),
    ).toBe(false);
  });

  it("says nothing when the user asked for space", () => {
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "quiet",
        now: new Date(lastChatAt.getTime() + 48 * HOUR),
      }),
    ).toBe(false);
  });
});

describe("a persona whose timing has been measured", () => {
  beforeEach(() => {
    clearProactiveDeadlines();
  });

  it("waits for its own moment, not for the clock", () => {
    const deadline = resolveProactiveDeadline({
      personaId: 2,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    });

    expect(deadline?.sampled).toBe(true);
    // The window the user bought is still the floor — the purchase says
    // how often, the persona's own history says when.
    expect(deadline!.at.getTime()).toBeGreaterThanOrEqual(deadline!.eligibleAt.getTime());
    expect(deadline!.eligibleAt.getTime()).toBe(lastChatAt.getTime() + 24 * HOUR);
  });

  it("is not due before that moment", () => {
    const deadline = resolveProactiveDeadline({
      personaId: 3,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(deadline.at.getTime() - 1000),
        personaId: 3,
        behaviorProfile: profile,
      }),
    ).toBe(false);

    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: deadline.at,
        personaId: 3,
        behaviorProfile: profile,
      }),
    ).toBe(true);
  });

  it("does not speak more often than the user bought", () => {
    // The window is the floor, so the persona cannot slip in early
    // however eager its own distribution is.
    const deadline = resolveProactiveDeadline({
      personaId: 4,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 23 * HOUR),
        personaId: 4,
        behaviorProfile: profile,
      }),
    ).toBe(false);
    expect(deadline.at.getTime()).toBeGreaterThanOrEqual(lastChatAt.getTime() + 24 * HOUR);
  });

  it("keeps the same plan for the same silence", () => {
    const first = resolveProactiveDeadline({
      personaId: 5,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    });
    const second = resolveProactiveDeadline({
      personaId: 5,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    });

    expect(second!.at.getTime()).toBe(first!.at.getTime());
  });

  it("keeps the same plan after a restart", () => {
    const before = resolveProactiveDeadline({
      personaId: 6,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    // The process dies and comes back: the cache is empty, but the
    // silence and the persona are still there, so the plan is the same.
    clearProactiveDeadlines();

    const after = resolveProactiveDeadline({
      personaId: 6,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    expect(after.at.getTime()).toBe(before.at.getTime());
  });

  it("draws a new plan for a new silence", () => {
    const first = resolveProactiveDeadline({
      personaId: 7,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;
    const later = resolveProactiveDeadline({
      personaId: 7,
      frequencyHours: 24,
      lastChatAt: new Date(lastChatAt.getTime() + 30 * HOUR),
      behaviorProfile: profile,
    })!;

    // A different silence is a different plan — the wait is drawn per
    // episode, not fixed once and for all.
    expect(later.at.getTime()).not.toBe(first.at.getTime());
  });

  it("draws a different wait for a different persona", () => {
    const one = resolveProactiveDeadline({
      personaId: 70,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;
    const other = resolveProactiveDeadline({
      personaId: 71,
      frequencyHours: 24,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    // Two people with the same measured profile do not wait for exactly
    // the same number of seconds — that is what makes it a person.
    expect(other.at.getTime() - other.eligibleAt.getTime()).not.toBe(
      one.at.getTime() - one.eligibleAt.getTime(),
    );
  });

  it("still says nothing when the user never bought it", () => {
    expect(
      isProactiveDue({
        frequencyHours: 0,
        lastChatAt,
        presence: "active",
        now: new Date(lastChatAt.getTime() + 365 * 24 * HOUR),
        personaId: 8,
        behaviorProfile: profile,
      }),
    ).toBe(false);
  });

  it("still says nothing when the user asked for space", () => {
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt,
        presence: "quiet",
        now: new Date(lastChatAt.getTime() + 48 * HOUR),
        personaId: 9,
        behaviorProfile: profile,
      }),
    ).toBe(false);
  });
});

describe("a silence that was never bought", () => {
  beforeEach(() => {
    clearProactiveDeadlines();
  });

  it("has no plan when there is no silence to plan for", () => {
    // There is no moment the wait could be measured from, so there is
    // nothing to say.
    expect(
      resolveProactiveDeadline({
        personaId: 1,
        frequencyHours: 24,
        lastChatAt: null,
        behaviorProfile: profile,
      }),
    ).toBeNull();
  });

  it("has no plan when the frequency is zero", () => {
    expect(
      resolveProactiveDeadline({
        personaId: 1,
        frequencyHours: 0,
        lastChatAt,
        behaviorProfile: profile,
      }),
    ).toBeNull();
  });

  it("has no plan when the frequency is negative", () => {
    expect(
      resolveProactiveDeadline({
        personaId: 1,
        frequencyHours: -24,
        lastChatAt,
        behaviorProfile: profile,
      }),
    ).toBeNull();
  });

  it("has no plan when the silence cannot be read", () => {
    // A silence nobody can read is not a silence.
    expect(
      resolveProactiveDeadline({
        personaId: 1,
        frequencyHours: 24,
        lastChatAt: new Date("nonsense"),
        behaviorProfile: profile,
      }),
    ).toBeNull();
  });

  it("is not due either", () => {
    expect(
      isProactiveDue({
        frequencyHours: 24,
        lastChatAt: new Date("nonsense"),
        presence: "active",
        now: new Date(lastChatAt.getTime() + 100 * HOUR),
        personaId: 1,
        behaviorProfile: profile,
      }),
    ).toBe(false);
  });
});

describe("a window that changes during the same silence", () => {
  beforeEach(() => {
    clearProactiveDeadlines();
  });

  it("keeps the plan it had already drawn", () => {
    const first = resolveProactiveDeadline({
      personaId: 40,
      frequencyHours: 6,
      lastChatAt,
      behaviorProfile: profile,
    })!;
    const second = resolveProactiveDeadline({
      personaId: 40,
      frequencyHours: 12,
      lastChatAt,
      behaviorProfile: profile,
    })!;

    // The plan is a property of the silence, so a different window does
    // not draw a different one: the deadline stays where it was drawn,
    // while the window it was bought against moves. (Known problem —
    // the plan was drawn against the shorter window, so it can now sit
    // before the window the user bought. The audit of 2026-10-26 found
    // this; fixing it means the cache key has to carry the window.)
    expect(second.at.getTime()).toBe(first.at.getTime());
    expect(second.eligibleAt.getTime()).toBe(lastChatAt.getTime() + 12 * HOUR);
  });
});

describe("the cache of drawn deadlines", () => {
  beforeEach(() => {
    clearProactiveDeadlines();
  });

  it("forgets the silences that are long over", () => {
    // The map is a cache, not a ledger: a silence that ended is a
    // silence that will not be asked about again.
    const oldSilence = new Date(Date.now() - 40 * 24 * HOUR);
    for (let persona = 1; persona <= 501; persona++) {
      resolveProactiveDeadline({
        personaId: persona,
        frequencyHours: 24,
        lastChatAt: oldSilence,
        behaviorProfile: profile,
      });
    }

    const drawn = resolveProactiveDeadline({
      personaId: 1,
      frequencyHours: 24,
      lastChatAt: oldSilence,
      behaviorProfile: slowProfile,
    })!;

    // The old plan was let go with the rest of them, so the silence is
    // drawn again — from the profile as it is now, not from the one it
    // was drawn with.
    clearProactiveDeadlines();
    const fresh = resolveProactiveDeadline({
      personaId: 1,
      frequencyHours: 24,
      lastChatAt: oldSilence,
      behaviorProfile: slowProfile,
    })!;

    expect(drawn.at.getTime()).toBe(fresh.at.getTime());
    expect(drawn.at.getTime()).toBe(oldSilence.getTime() + 24 * HOUR + 3 * HOUR);
  });
});
