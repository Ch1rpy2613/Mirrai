import { describe, expect, it } from "vitest";
import { resolveIntakeGaps } from "./intake-gaps";

/**
 * The gap list the intake stage produced.
 *
 * The intake stage names what is missing from the material. The answer is
 * stored on the job row, and the interface shows it — but only when there
 * actually is one, and only when it is a list the user can read.
 */
describe("the intake gap list", () => {
  it("reads the list out of the job's metadata", () => {
    expect(
      resolveIntakeGaps({ intake: "- 更多的聊天记录\n- 几张旧照片" }),
    ).toBe("- 更多的聊天记录\n- 几张旧照片");
  });

  it("keeps the other metadata around it", () => {
    const meta = { researchProfile: "budget-unfriendly", intake: "- 一条线索" };
    expect(resolveIntakeGaps(meta)).toBe("- 一条线索");
  });

  it("has nothing to show when the stage did not run", () => {
    expect(resolveIntakeGaps(null)).toBe(null);
    expect(resolveIntakeGaps(undefined)).toBe(null);
    expect(resolveIntakeGaps({})).toBe(null);
    expect(resolveIntakeGaps({ researchProfile: "budget-unfriendly" })).toBe(null);
  });

  it("has nothing to show when the list is empty", () => {
    expect(resolveIntakeGaps({ intake: "" })).toBe(null);
    expect(resolveIntakeGaps({ intake: "   \n " })).toBe(null);
  });

  it("ignores a value that is not text", () => {
    expect(resolveIntakeGaps({ intake: 42 })).toBe(null);
    expect(resolveIntakeGaps({ intake: ["a", "b"] })).toBe(null);
  });
});
