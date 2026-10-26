import { describe, expect, it, beforeEach } from "vitest";
import {
  clearRestoredCredentials,
  setRestoredCredentials,
} from "./types";
import { getCollector } from "./index";

/**
 * The credentials of one collector source belong to one user.
 *
 * They used to be keyed by the source alone, and the map was never
 * emptied: so a user who ran a collection without a stored source of
 * their own was handed *another user's* credentials — and that other
 * user's chat history was imported into their persona.
 *
 * The keying was fixed and a shared slot was left behind. The shared
 * slot was where every credential ended up, because the procedure that
 * saves them did not pass the user id — so the leak was still there, in
 * a different shape.
 */
describe("the credentials of a collector source", () => {
  beforeEach(() => {
    clearRestoredCredentials("feishu", 1);
    clearRestoredCredentials("feishu", 2);
    clearRestoredCredentials("feishu", null);
    clearRestoredCredentials("feishu", undefined);
  });

  it("are not shared between users", () => {
    setRestoredCredentials("feishu", { user_access_token: "token-of-user-1" }, 1);

    const feishu = getCollector("feishu")!;
    const forUserOne = feishu.args({ target: "someone", userId: 1 });
    const forUserTwo = feishu.args({ target: "someone", userId: 2 });

    expect(forUserOne).toContain("token-of-user-1");
    expect(forUserTwo).not.toContain("token-of-user-1");
  });

  it("are not kept at all when there is no user", () => {
    // The procedure that saves the credentials used to leave the user id
    // out, so they landed in a slot that everybody could reach.
    setRestoredCredentials("feishu", { user_access_token: "token-of-nobody" }, null);
    setRestoredCredentials("feishu", { user_access_token: "token-of-nobody" }, undefined);

    const feishu = getCollector("feishu")!;
    for (const userId of [1, 2, 3]) {
      expect(feishu.args({ target: "someone", userId })).not.toContain("token-of-nobody");
    }
  });

  it("do not leak into a run that has no user of its own", () => {
    setRestoredCredentials("feishu", { user_access_token: "token-of-user-1" }, 1);
    const feishu = getCollector("feishu")!;
    expect(feishu.args({ target: "someone" })).not.toContain("token-of-user-1");
  });
});
