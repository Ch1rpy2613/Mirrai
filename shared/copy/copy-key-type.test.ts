import { describe, expect, it } from "vitest";
import { copy, copyKey, type CopyKey } from "./index";

/**
 * The type of the key.
 *
 * The key used to be `CopyKey | string` — which is `string`. So every
 * typo compiled cleanly, and then showed up as `errors.someKey` in the
 * interface, or inside a model's prompt where nobody would ever see
 * it.
 *
 * The type cannot be checked at runtime, so it is checked here by the
 * compiler: the `@ts-expect-error` lines below are errors, and the
 * build fails if they stop being errors. That is the whole point — a
 * typo has to stop compiling.
 */

describe("the type of the key", () => {
  it("does not accept a key that is not in the table", () => {
    // @ts-expect-error — "errors.noSuchKey" is not in the table.
    copy("zh", "errors.noSuchKey");
    // @ts-expect-error — and neither is this one.
    copy("zh", "channels.noPersonasTypo");
  });

  it("accepts a key that is in the table", () => {
    const key: CopyKey = "channels.noPersonas";
    expect(copy("zh", key)).toContain("分身");
  });

  it("has a way to ask for a key that is not known until it is built", () => {
    // The key is checked at runtime, so a key that is wrong shows up
    // as the key itself.
    expect(copyKey("zh", "errors.noSuchKey")).toBe("errors.noSuchKey");
  });
});
