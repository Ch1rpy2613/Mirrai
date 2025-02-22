import { execFile } from "child_process";
import { promisify } from "util";
import { ENV } from "../_core/env";

const execFileAsync = promisify(execFile);

export async function runPythonTool(
  toolName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(ENV.pythonPath, [`tools/${toolName}`, ...args], {
    cwd: ENV.skillEngineDir,
    timeout: 120_000,
  });
}
