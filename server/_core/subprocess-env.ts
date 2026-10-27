/**
 * The environment a Python script is given.
 *
 * Only what a script needs to run: where Python is, where the
 * operating system's binaries are, the user's home directory and the
 * language. Everything else — the session key, the credential key, the
 * database URL, every provider key — belongs to the app and not to a
 * script that reads chat logs.
 *
 * The collectors were given such an environment; the skill engine's
 * tools were not. They are the same third-party Python scripts, from
 * the same directory, and one careless script could exfiltrate the
 * whole instance's secrets — including the ability to forge a session
 * and to decrypt the stored credentials.
 */
export function subprocessEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE,
    /**
     * The language is UTF-8, and it is *ours*.
     *
     * It used to be inherited from the server's own environment — so
     * an app started with `LC_ALL=C` (a minimal container, a systemd
     * unit with a stripped environment) handed its scripts a C locale.
     *
     * And a C locale is not merely "no accent": Python's `open()`
     * then encodes with **ASCII**, so writing a file that holds
     * anything else — a Chinese name, an emoji — raises
     * `UnicodeEncodeError` and the file is written empty. The
     * collectors read and write chat logs, so that is their whole
     * job.
     *
     * The app's own language is none of the scripts' business: they
     * are given one that can carry what they are asked to carry.
     */
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    /**
     * And Python's own default too.
     *
     * `PYTHONIOENCODING` says how the standard streams are encoded;
     * `PYTHONUTF8` says how the *filesystem* is — and the filesystem
     * is where the chat logs and the credentials live. It was not
     * set, so the filesystem encoding followed the locale, and a C
     * locale made `open()` an ASCII one.
     */
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    // The browsers the collectors read from live in the user's profile,
    // and the scripts find them through these.
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA,
    // A proxy setting is sometimes the only way a script can reach the
    // network at all, and it says nothing about the secrets.
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
  };
}
