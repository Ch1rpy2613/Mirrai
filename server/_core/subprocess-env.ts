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
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C.UTF-8",
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
