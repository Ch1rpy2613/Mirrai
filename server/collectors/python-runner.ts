import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Running a Python snippet.
 *
 * The snippet is written to a file and run from there — never passed on
 * the command line.
 *
 * The command line is decoded with the *filesystem* encoding, and that
 * encoding follows the locale: `ascii` under a C locale on Linux, and
 * always `utf-8` on macOS. So a snippet with a Chinese character in it
 * — or an em-dash — became surrogate characters on Linux, and Python
 * could not even read its own instructions:
 *
 *   UnicodeEncodeError: 'utf-8' codec can't encode characters in
 *   position 672-677: surrogates not allowed
 *
 * A source *file* is always decoded as UTF-8, whatever the locale says.
 *
 * The environment is set here too, so that a snippet's *output* is
 * UTF-8 as well: `PYTHONIOENCODING` for the standard streams and
 * `PYTHONUTF8` for the filesystem.
 */

/** The Python to run, or null when there is none. */
export function pythonBinary(): string | null {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

/** The environment a snippet runs in. */
function snippetEnvironment(
  overrides?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    /**
     * The language.
     *
     * The scripts print Chinese — the collectors' own output is the
     * chat log — and the standard streams are encoded with the locale
     * otherwise, so printing a Chinese name on a C-locale machine
     * raised `UnicodeEncodeError` inside the tool.
     */
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONIOENCODING: "utf-8",
    /**
     * And the filesystem.
     *
     * `PYTHONIOENCODING` says how the standard streams are encoded;
     * `PYTHONUTF8` says how the *filesystem* is — and the filesystem
     * is where the chat logs and the credentials live.
     */
    PYTHONUTF8: "1",
    ...overrides,
  };
}

export interface PythonRunOptions {
  /** The arguments after the script. */
  args?: string[];
  /** Where to run it. */
  cwd?: string;
  /** The environment, and what to change in it. */
  env?: Record<string, string | undefined>;
  /** How long to wait. */
  timeout?: number;
  /**
   * What the standard streams are.
   *
   * The server's own setting for a collector is "ignore" — a
   * non-interactive server must not block on a prompt nobody can
   * answer. So a snippet that reads the standard input has to be able
   * to be run that way.
   */
  stdio?: "ignore" | "pipe";
  /** What is written to the standard input. */
  input?: string;
}

/** Runs a snippet and returns what it said. */
export function runPythonSnippet(
  python: string,
  body: string,
  options: PythonRunOptions = {},
): { status: number; stdout: string; stderr: string } {
  const script = writeSnippet(body);
  const result = spawnSync(python, [script, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: snippetEnvironment(options.env),
    encoding: "utf-8",
    timeout: options.timeout,
    ...(options.stdio === "ignore"
      ? { stdio: ["ignore", "pipe", "pipe"] as const }
      : {}),
    ...(options.input !== undefined ? { input: options.input } : {}),
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Runs a snippet and throws when it fails.
 *
 * For the cases that only care whether it worked.
 */
export function runPythonSnippetSync(
  python: string,
  body: string,
  options: PythonRunOptions = {},
): void {
  const script = writeSnippet(body);
  execFileSync(python, [script, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: snippetEnvironment(options.env),
    stdio: "ignore",
    timeout: options.timeout,
  });
}

/** Writes the snippet to a file and says where it is. */
function writeSnippet(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mirrai-py-"));
  const script = path.join(dir, "snippet.py");
  writeFileSync(script, body, "utf-8");
  return script;
}
