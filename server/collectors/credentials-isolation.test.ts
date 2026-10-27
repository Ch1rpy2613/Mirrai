import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearRestoredCredentials,
  connectorCredentials,
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
    const forUserOne = connectorCredentials(feishu, { target: "someone", userId: 1 });
    const forUserTwo = connectorCredentials(feishu, { target: "someone", userId: 2 });

    expect(forUserOne.user_access_token).toBe("token-of-user-1");
    expect(forUserTwo.user_access_token).toBeUndefined();
  });

  it("are not kept at all when there is no user", () => {
    // The procedure that saves the credentials used to leave the user id
    // out, so they landed in a slot that everybody could reach.
    setRestoredCredentials("feishu", { user_access_token: "token-of-nobody" }, null);
    setRestoredCredentials("feishu", { user_access_token: "token-of-nobody" }, undefined);

    const feishu = getCollector("feishu")!;
    for (const userId of [1, 2, 3]) {
      const credentials = connectorCredentials(feishu, { target: "someone", userId });
      expect(credentials.user_access_token).toBeUndefined();
    }
  });

  it("do not leak into a run that has no user of its own", () => {
    setRestoredCredentials("feishu", { user_access_token: "token-of-user-1" }, 1);
    const feishu = getCollector("feishu")!;
    const credentials = connectorCredentials(feishu, { target: "someone" });
    expect(credentials.user_access_token).toBeUndefined();
  });

  it("do not come from the machine's own configuration file", () => {
    // The machine's file holds the credentials of whoever set the
    // collector up here: the operator. So a user who had never
    // authorised a source still got a run, and the run authenticated as
    // the operator — and the operator's chat history was imported into
    // the user's own persona.
    //
    /**
     * The home directory is a temporary one.
     *
     * The test used to write to the *real* `~/.colleague-skill/
     * feishu_config.json` and then delete it — so on the machine of
     * the person who ran the collector's `--setup`, a unit test
     * overwrote the operator's own credentials and then threw them
     * away. On the CI it was harmless, because the runner's home is a
     * throwaway. Same code, and the consequence is the user's own
     * account.
     *
     * The home is redirected instead: `os.homedir()` reads `HOME`, so
     * the file is still exactly where the machine's own configuration
     * would be — and if somebody ever reads it again, this test is
     * still there to catch it.
     */
    const home = mkdtempSync(path.join(tmpdir(), "mirrai-home-"));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;

      const configDir = path.join(home, ".colleague-skill");
      const configPath = path.join(configDir, "feishu_config.json");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify({ user_access_token: "the-operators-token" }),
        { mode: 0o600 },
      );

      const feishu = getCollector("feishu")!;
      const credentials = connectorCredentials(feishu, { target: "someone", userId: 1 });
      expect(credentials.user_access_token).toBeUndefined();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("do not go on the command line", () => {
    // Every other process on the machine could see the process list.
    setRestoredCredentials("feishu", { user_access_token: "token-of-user-1" }, 1);
    const feishu = getCollector("feishu")!;
    expect(feishu.args({ target: "someone", userId: 1 })).not.toContain("token-of-user-1");
  });
});
