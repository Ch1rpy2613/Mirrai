/**
 * How a person behaves over time.
 *
 * The delays in this product used to be rules: reply after a fixed
 * number of hours, speak first at most twice a day, answer a letter in
 * twenty. Those are not wrong, but they are not *theirs* — they belong
 * to the app, and a person who is reliably online at 3am and never at
 * noon gets treated exactly like one who is the other way round.
 *
 * So the timing is measured instead of assumed. From the real record we
 * fit the distribution the person actually replies within — a log-normal
 * one, because reply gaps are multiplicative: twice the gap is usually
 * more likely than ten times the gap — and then we *sample* from it.
 * The uncertainty is then theirs, which is the whole difference between
 * a schedule and a person.
 *
 * Nothing here is required. A persona with no profile keeps the old
 * behaviour, and a profile fitted from too few samples says so rather
 * than pretending to know.
 */

/** What was measured, and from how much. */
export interface BehaviorProfile {
  /** Median seconds between the user's message and the persona's reply. */
  replyGapMedianSec: number;
  /** Log-scale spread of those gaps. */
  replyGapLogSigma: number;
  /** How many messages the persona sends in one go. */
  burstSizes: number[];
  /** How often the persona speaks first, 0–1. */
  proactiveRate: number;
  /** The hours of day the persona is most active, 0–23. */
  activeHours: number[];
  /** How many exchanges this was fitted from. */
  samples: number;
  /** When it was measured. */
  measuredAt?: string;
}

/** One observed exchange. */
export interface BehaviorSample {
  /** Seconds between the user's message and the persona's reply. */
  gapSeconds: number;
  /** How many messages the persona sent in this reply. */
  burstSize?: number;
  /** The hour of day (0–23) the persona replied at. */
  hour?: number;
  /** Whether the persona spoke first in this exchange. */
  personaSpokeFirst?: boolean;
}

/** Below this many samples the fit is not worth trusting. */
export const BEHAVIOR_MIN_SAMPLES = 8;

/** The gap is never shorter than this — a person does not answer mid-word. */
export const BEHAVIOR_MIN_GAP_SEC = 5;

/** The gap is never longer than this — after six hours it is a new conversation. */
export const BEHAVIOR_MAX_GAP_SEC = 6 * 60 * 60;

function finite(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerces stored behaviour into the canonical shape.
 *
 * Returns null when the stored thing is not a usable profile, so the
 * caller falls back to the old behaviour rather than to a half-profile
 * with zeroes in it.
 */
export function normalizeBehaviorProfile(value: unknown): BehaviorProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const samples = Math.max(0, Math.round(finite(record.samples, 0)));
  const median = finite(record.replyGapMedianSec, 0);
  if (!median || samples < BEHAVIOR_MIN_SAMPLES) return null;

  const burstSizes = Array.isArray(record.burstSizes)
    ? record.burstSizes.map((v) => Math.max(1, Math.round(finite(v, 1)))).filter((n) => n > 0)
    : [];

  const activeHours = Array.isArray(record.activeHours)
    ? record.activeHours
        .map((v) => Math.round(finite(v, 0)))
        .filter((h) => h >= 0 && h <= 23)
    : [];

  const measuredAt = typeof record.measuredAt === "string" ? record.measuredAt : undefined;

  return {
    replyGapMedianSec: Math.max(
      BEHAVIOR_MIN_GAP_SEC,
      Math.min(BEHAVIOR_MAX_GAP_SEC, median),
    ),
    replyGapLogSigma: Math.max(0, Math.min(2, finite(record.replyGapLogSigma, 0.6))),
    burstSizes: burstSizes.length ? burstSizes : [1],
    proactiveRate: Math.max(0, Math.min(1, finite(record.proactiveRate, 0))),
    activeHours: activeHours.length ? activeHours : [],
    samples,
    ...(measuredAt ? { measuredAt } : {}),
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Fits a profile from observed exchanges.
 *
 * The spread is measured in log space, because that is the space gaps
 * live in: the difference between 10 seconds and 20 is a small one, and
 * the difference between 10 minutes and 20 is the same small one.
 */
export function fitBehaviorProfile(
  samples: BehaviorSample[],
  now: Date = new Date(),
): BehaviorProfile | null {
  const gaps = samples
    .map((s) => s.gapSeconds)
    .filter((g) => Number.isFinite(g) && g > 0);
  if (gaps.length < BEHAVIOR_MIN_SAMPLES) return null;

  const logs = gaps.map((g) => Math.log(g));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const variance =
    logs.length > 1
      ? logs.reduce((acc, l) => acc + (l - mean) ** 2, 0) / (logs.length - 1)
      : 0;

  const burstSizes = samples
    .map((s) => (s.burstSize ? Math.max(1, Math.round(s.burstSize)) : 0))
    .filter((n) => n > 0);

  const proactiveFlags = samples.filter((s) => typeof s.personaSpokeFirst === "boolean");
  const proactiveRate = proactiveFlags.length
    ? proactiveFlags.filter((s) => s.personaSpokeFirst).length / proactiveFlags.length
    : 0;

  const hourCounts = new Map<number, number>();
  for (const sample of samples) {
    if (sample.hour == null) continue;
    hourCounts.set(sample.hour, (hourCounts.get(sample.hour) ?? 0) + 1);
  }
  const activeHours = [...hourCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([hour]) => hour)
    .sort((a, b) => a - b);

  return {
    replyGapMedianSec: Math.max(
      BEHAVIOR_MIN_GAP_SEC,
      Math.min(BEHAVIOR_MAX_GAP_SEC, Math.exp(mean)),
    ),
    replyGapLogSigma: Math.max(0, Math.min(2, Math.sqrt(variance))),
    burstSizes: burstSizes.length ? burstSizes : [1],
    proactiveRate: Math.max(0, Math.min(1, proactiveRate)),
    activeHours,
    samples: samples.length,
    measuredAt: now.toISOString(),
  };
}

/** A standard normal draw from a uniform source. */
function standardNormal(rng: () => number): number {
  // Box–Muller. u1 must be non-zero, so it is nudged off the edge.
  const u1 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, rng()));
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * A reply delay drawn from the persona's own distribution.
 *
 * Log-normal on purpose: the tail is long, because people sometimes go
 * quiet for hours, and the middle is tight, because they usually answer
 * in minutes. A uniform delay has neither shape.
 */
export function sampleReplyDelayMs(
  profile: BehaviorProfile | null,
  rng: () => number = Math.random,
): number {
  if (!profile) return 30_000;
  const z = standardNormal(rng);
  const seconds = profile.replyGapMedianSec * Math.exp(profile.replyGapLogSigma * z);
  const clamped = Math.max(
    BEHAVIOR_MIN_GAP_SEC,
    Math.min(BEHAVIOR_MAX_GAP_SEC, seconds),
  );
  return Math.round(clamped * 1000);
}

/**
 * The delay at a given quantile, in **seconds**.
 *
 * The unit is in the name because the other one is in milliseconds —
 * `sampleReplyDelayMs` — and the two sat side by side with nothing to
 * say which was which.
 *
 * The profile stores the *shape* rather than a list of measured gaps,
 * so the percentiles are read off the shape. That is the point of
 * fitting a distribution rather than keeping a histogram: the answer
 * for a percentile nobody has measured yet is still there.
 *
 * `p` is a fraction: 0.1 for the tenth percentile, 0.5 for the median.
 */
export function replyDelayQuantileSec(profile: BehaviorProfile | null, p: number): number {
  if (!profile) return 0;
  const fraction = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0.5));
  // The inverse of the standard normal, approximated. It only has to
  // be good enough to place a percentile; the gaps themselves are still
  // the persona's.
  const z = inverseNormal(fraction);
  const seconds = profile.replyGapMedianSec * Math.exp(profile.replyGapLogSigma * z);
  return Math.max(
    BEHAVIOR_MIN_GAP_SEC,
    Math.min(BEHAVIOR_MAX_GAP_SEC, seconds),
  );
}

/**
 * The inverse of the standard normal distribution.
 *
 * Acklam's rational approximation — accurate to about 1e-9 over the
 * range that matters here, and it is a closed form, so it costs
 * nothing to call for every percentile of every profile.
 */
function inverseNormal(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * How many messages the persona sends in one go.
 *
 * Drawn from the observed bursts, so someone who writes three short
 * lines in a row still writes three short lines in a row.
 */
export function sampleBurstSize(
  profile: BehaviorProfile | null,
  rng: () => number = Math.random,
): number {
  if (!profile || !profile.burstSizes.length) return 1;
  const index = Math.min(
    profile.burstSizes.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, rng())) * profile.burstSizes.length),
  );
  return Math.max(1, profile.burstSizes[index]);
}

/**
 * How long the persona waits before speaking first.
 *
 * The silence itself is part of the profile: the longer it has been, the
 * less likely a first word is, and the longer that word takes when it
 * comes.
 */
export function sampleProactiveDelayMs(
  profile: BehaviorProfile | null,
  silenceMs: number,
  rng: () => number = Math.random,
): number {
  const base = sampleReplyDelayMs(profile, rng);
  if (!profile) return base;
  const silenceHours = Math.max(0, silenceMs / 3_600_000);
  // The longer the silence, the more the wait stretches — but never past
  // a day, because after that the conversation has restarted, not resumed.
  const stretch = 1 + Math.min(silenceHours / 24, 1) * 2;
  return Math.min(24 * 60 * 60 * 1000, Math.round(base * stretch));
}

/**
 * The two-sample Kolmogorov–Smirnov statistic.
 *
 * Used to answer one question: does the persona's reply timing now come
 * from the same distribution as the real person's did. A number near zero
 * means the shapes match; a number near one means they do not.
 */
export function ksStatistic(a: number[], b: number[]): number {
  // A value that is not a number cannot be walked: the walk picks the
  // smaller of the two next values, and a NaN there makes every
  // comparison false, so neither side ever moves and the walk never
  // ends. Which values are not gaps is the caller's business; values
  // that are not numbers are this function's.
  const xs = a.filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
  const ys = b.filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
  if (!xs.length || !ys.length) return 1;
  let max = 0;
  let i = 0;
  let j = 0;
  // Walk both samples together, one distinct value at a time. Advancing a
  // single pointer at a time would compare the two distributions halfway
  // through a jump, and report a gap where there is none.
  while (i < xs.length || j < ys.length) {
    let next: number;
    if (i < xs.length && j < ys.length) next = Math.min(xs[i], ys[j]);
    else if (i < xs.length) next = xs[i];
    else next = ys[j];
    while (i < xs.length && xs[i] <= next) i++;
    while (j < ys.length && ys[j] <= next) j++;
    const diff = Math.abs(i / xs.length - j / ys.length);
    if (diff > max) max = diff;
  }
  return max;
}
