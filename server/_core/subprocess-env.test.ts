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
      "PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "PYTHONUTF8",
      "PYTHONIOENCODING",
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

  it("speaks UTF-8, whatever the server's own locale is", () => {
    /**
     * The locale used to be inherited from the server.
     *
     * So an app started with `LC_ALL=C` — a minimal container, a
     * systemd unit with a stripped environment — handed its scripts a C
     * locale. And a C locale is not merely "no accent": Python's
     * `open()` then encodes with **ASCII**, so writing a file that
     * holds anything else — a Chinese name, an emoji — raises
     * `UnicodeEncodeError` and the file is written empty.
     *
     * The collectors read and write chat logs, so that is their whole
     * job.
     */
    const original = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    try {
      process.env.LANG = "C";
      process.env.LC_ALL = "C";
      const env = subprocessEnvironment();
      expect(env.LANG).toBe("C.UTF-8");
      expect(env.LC_ALL).toBe("C.UTF-8");
      /**
       * And Python's own default too.
       *
       * `PYTHONIOENCODING` says how the standard streams are encoded;
       * `PYTHONUTF8` says how the *filesystem* is — and the
       * filesystem is where the chat logs and the credentials live.
       */
      expect(env.PYTHONUTF8).toBe("1");
    } finally {
      if (original.LANG === undefined) delete process.env.LANG;
      else process.env.LANG = original.LANG;
      if (original.LC_ALL === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = original.LC_ALL;
    }
  });
});
