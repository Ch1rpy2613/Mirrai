import { describe, expect, it } from "vitest";
import { subprocessEnvironment } from "./subprocess-env";

/**
 * The Python scripts of the app are third-party code that the operator
 * may not have audited. They must not be handed the secrets of the
 * instance.
 */
describe("the environment a Python script is given", () => {
  it("does not carry the session key", () => {
    // The key that signs the session cookie, and the scrypt input that
    // decrypts every stored credential.
    expect(subprocessEnvironment().JWT_SECRET).toBeUndefined();
  });

  it("does not carry the database url", () => {
    expect(subprocessEnvironment().DATABASE_URL).toBeUndefined();
  });

  it("does not carry any provider key", () => {
    const env = subprocessEnvironment();
    for (const key of Object.keys(env)) {
      expect(key).not.toMatch(/API_KEY|APIKEY|SECRET|TOKEN|PASSWORD/);
    }
  });

  it("does not carry anything else the server happens to have", () => {
    // The environment is a whitelist, not a blacklist: a variable that
    // nobody thought of must not reach a script either.
    const allowed = new Set([
      "PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "PYTHONIOENCODING",
      "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA",
      "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    ]);
    for (const key of Object.keys(subprocessEnvironment())) {
      expect(allowed.has(key), `unexpected variable "${key}"`).toBe(true);
    }
  });

  it("still has what a script needs to run", () => {
    const env = subprocessEnvironment();
    expect(env.PATH).toBeTruthy();
    expect(env.HOME).toBeTruthy();
    expect(env.PYTHONIOENCODING).toBe("utf-8");
  });
});
