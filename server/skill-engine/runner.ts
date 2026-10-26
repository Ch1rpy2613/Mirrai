import { execFile } from "child_process";
import { promisify } from "util";
import { ENV } from "../_core/env";
import { subprocessEnvironment } from "../_core/subprocess-env";

const execFileAsync = promisify(execFile);

export async function runPythonTool(
  toolName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(ENV.pythonPath, [`tools/${toolName}`, ...args], {
    cwd: ENV.skillEngineDir,
    timeout: 120_000,
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
