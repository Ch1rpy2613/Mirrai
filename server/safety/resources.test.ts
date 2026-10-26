import { describe, expect, it } from "vitest";
import { DEFAULT_CRISIS_RESOURCES, getCrisisResources } from "./resources";

/**
 * The crisis resources.
 *
 * These are phone numbers and addresses that a person in crisis may be
 * expected to call. They ship with the app, so nothing about them can be
 * checked at request time — and an out-of-date number is worse than no
 * number, because it looks authoritative.
 *
 * The list therefore carries the date a human last checked it, and this
 * test fails once that date is old enough that somebody has to look at it
 * again. The window is generous on purpose: the point is to force a check
 * before a release, not to nag every day.
 *
 * The date in the list that ships with the app is a placeholder — the
 * numbers have not been checked against the operators. What this test
 * enforces is that the check has somewhere to be recorded and that it is
 * not left to rot; the check itself is owed by a person.
 */

/** How long a resource may go unverified before the build asks for a look. */
const MAX_AGE_DAYS = Number.parseInt(
  process.env.SAFETY_RESOURCES_MAX_AGE_DAYS ?? "",
  10,
) || 365;

function daysSince(date: string): number {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
}

describe("the crisis resources", () => {
  it("ships with at least the national and international lines", () => {
    const resources = getCrisisResources();
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.some((r) => r.region.includes("中国大陆"))).toBe(true);
    expect(resources.some((r) => r.contact.includes("findahelpline"))).toBe(true);
  });

  it("gives every resource a region, a description and a contact", () => {
    for (const resource of DEFAULT_CRISIS_RESOURCES) {
      expect(resource.region.trim(), resource.id).not.toBe("");
      expect(resource.description.trim(), resource.id).not.toBe("");
      expect(resource.contact.trim(), resource.id).not.toBe("");
    }
  });

  it("has not been left unverified for too long", () => {
    // A number that nobody has looked at in a year might have changed.
    // Update `lastVerified` in server/safety/resources.ts after checking.
    const stale = DEFAULT_CRISIS_RESOURCES
      .map((resource) => ({
        id: resource.id,
        age: daysSince(resource.lastVerified),
        lastVerified: resource.lastVerified,
      }))
      .filter((resource) => resource.age > MAX_AGE_DAYS);

    expect(
      stale,
      `these crisis resources have not been verified in over ${MAX_AGE_DAYS} days — check them and update lastVerified`,
    ).toEqual([]);
  });

  it("gives every resource a date that can be read", () => {
    for (const resource of DEFAULT_CRISIS_RESOURCES) {
      expect(resource.lastVerified, resource.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(resource.lastVerified).getTime()), resource.id).toBe(false);
    }
  });
});
