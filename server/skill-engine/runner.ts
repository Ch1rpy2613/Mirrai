import { execFile } from "child_process";
import { promisify } from "util";
import { ENV } from "../_core/env";
import { subprocessEnvironment } from "../_core/subprocess-env";

const execFileAsync = promisify(execFile);

/**
 * Whether the interpreter is there at all.
 *
 * The tools are third-party Python scripts, and they are shipped with
 * the app — but the interpreter is the operating system's. So it can be
 * missing, and then every one of them fails with a message about a
 * file that does not exist, which says nothing about what to do.
 *
 * The answer was cached for the life of the process: the interpreter
 * cannot come and go while the app runs — but it *can* be installed
 * while the app runs, and then every tool kept failing with "Python is
 * not available" for the rest of the server's life. So a failed check
 * is remembered for a minute, and a successful one is remembered for
 * the life of the process.
 */
let interpreterChecked: Promise<boolean> | null = null;
let interpreterCheckedAt = 0;

/** How long a failed check is believed. */
const FAILED_CHECK_TTL_MS = 60_000;

export function pythonIsAvailable(): Promise<boolean> {
  const now = Date.now();
  if (interpreterChecked && now - interpreterCheckedAt < FAILED_CHECK_TTL_MS) {
    return interpreterChecked;
  }
  interpreterCheckedAt = now;
  interpreterChecked = execFileAsync(ENV.pythonPath, ["--version"], {
    timeout: 10_000,
    env: subprocessEnvironment(),
  })
    .then(() => true)
    .catch(() => false);
  return interpreterChecked;
}

export async function runPythonTool(
  toolName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  if (!(await pythonIsAvailable())) {
    /**
     * The message says what is missing and what to do about it.
     *
     * It used to be "ENOENT: no such file or directory, spawn
     * python3" — which says nothing about the fact that the feature
     * needs an interpreter the operating system may not have.
     */
    throw new Error(
      `Python is not available at "${ENV.pythonPath}", so "${toolName}" cannot run. Install Python 3 and make sure it is on the PATH.`,
    );
  }
  return execFileAsync(ENV.pythonPath, [`tools/${toolName}`, ...args], {
    cwd: ENV.skillEngineDir,
    timeout: 120_000,
    /**
     * A megabyte of output is the default, and it is not much.
     *
     * The tools print their findings — a research report, an audit, a
     * profile — and a run that printed more than a megabyte died with
     * "stdout maxBuffer length exceeded" and the work was lost.
     */
    maxBuffer: 32 * 1024 * 1024,
    /**
     * The child is given a small environment of its own.
     *
     * It used to inherit the server's whole environment: the session
     * signing key, the key the stored credentials are encrypted with,
     * the database URL and every provider key. The collectors were
     * given a stripped environment; these are the same third-party
     * scripts, from the same directory, and one careless script could
     * exfiltrate the whole instance's secrets — including the ability
     * to forge a session and to decrypt the stored credentials.
     */
    env: subprocessEnvironment(),
  });
}
