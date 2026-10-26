/**
 * Installing Redis, without the user having to think about it.
 *
 * Mirrai uses Redis for two things that only matter when more than one
 * copy of the app is running: the rate limiter's budget is counted against
 * a shared bucket, and the scheduler's lock stops two copies from
 * delivering the same reminder twice.
 *
 * The app does not *need* Redis — with one copy it falls back to counting
 * in its own memory and says so in the log. But the limits mean what they
 * say when there is a Redis, and a Redis that the app starts on its own
 * (see `server/_core/redis.ts`) needs a `redis-server` binary to exist.
 *
 * **The installers do not need this script.** The macOS app, the Windows
 * bundle and the Docker image all carry a Redis already, and the app
 * starts that one by itself. This is for the one case they do not cover:
 * running from a checkout.
 *
 * So this script installs one, if the machine does not have it yet:
 *
 *     pnpm setup:redis
 *
 * It is safe to run more than once, and it never installs anything when a
 * usable binary is already there.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

/** Where the package managers put a binary that `PATH` may not have. */
const USUAL_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/usr/local/redis/bin",
  "/opt/local/bin",
];

/** Whether the script should only report, and not install anything. */
const CHECK_ONLY = process.argv.includes("--check");

/** Whether the script should not stop at the first thing that works. */
const QUIET = process.argv.includes("--quiet");

function say(line: string): void {
  if (!QUIET) console.log(line);
}

/** The `redis-server` binary, if the machine has one. */
function findRedisServer(): string | null {
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(directory, "redis-server");
    if (existsSync(candidate)) return candidate;
  }
  for (const directory of USUAL_PATHS) {
    const candidate = join(directory, "redis-server");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether a command is on the machine. */
function has(command: string): boolean {
  const result = spawnSync("command", ["-v", command], { shell: true, stdio: "ignore" });
  return result.status === 0;
}

/** The command that installs Redis here, or null when there is not one. */
function installCommand(): { command: string; args: string[]; label: string } | null {
  const platform = os.platform();

  if (platform === "darwin" && has("brew")) {
    return { command: "brew", args: ["install", "redis"], label: "Homebrew" };
  }
  if (platform === "linux" && has("apt-get")) {
    return {
      // apt-get installs into the system directories, so it needs to be
      // run as the superuser. It was run without, so it failed with
      // EACCES on any machine where the user was not already root —
      // and the script then printed the instructions, which say to use
      // sudo.
      command: "sudo",
      args: ["apt-get", "install", "-y", "redis-server"],
      label: "apt",
    };
  }
  if (platform === "linux" && has("apk")) {
    return { command: "apk", args: ["add", "--no-cache", "redis"], label: "apk" };
  }
  if (platform === "linux" && has("dnf")) {
    return { command: "dnf", args: ["install", "-y", "redis"], label: "dnf" };
  }
  if (platform === "linux" && has("yum")) {
    return { command: "yum", args: ["install", "-y", "redis"], label: "yum" };
  }
  return null;
}

/** What to tell somebody whose machine has no package manager we know. */
function manualInstructions(): void {
  console.log("");
  console.log("  This machine does not have a package manager Mirrai knows how to use.");
  console.log("  Install Redis any way you like — one of these will do:");
  console.log("");
  console.log("    macOS         brew install redis");
  console.log("    Debian/Ubuntu sudo apt-get install redis-server");
  console.log("    Alpine        apk add --no-cache redis");
  console.log("    Docker        docker run -d -p 6379:6379 redis:7-alpine");
  console.log("    From source   https://redis.io/docs/latest/operate/oss_and_stack/install/");
  console.log("");
  console.log("  Or point the app at a Redis that is already running:");
  console.log("");
  console.log("    REDIS_URL=redis://127.0.0.1:6379 pnpm dev");
  console.log("");
}

function main(): number {
  const existing = findRedisServer();
  if (existing) {
    say(`Redis is already installed: ${existing}`);
    say("Nothing to do.");
    return 0;
  }

  if (CHECK_ONLY) {
    console.log("Redis is not installed on this machine.");
    return 1;
  }

  const installer = installCommand();
  if (!installer) {
    manualInstructions();
    return 1;
  }

  console.log(`Installing Redis with ${installer.label}…`);
  try {
    execFileSync(installer.command, installer.args, { stdio: "inherit" });
  } catch (error) {
    console.error("");
    console.error(`The install failed: ${(error as Error).message}`);
    console.error("");
    manualInstructions();
    return 1;
  }

  const installed = findRedisServer();
  if (!installed) {
    console.error("");
    console.error("Redis was installed but the binary could not be found.");
    console.error("Start the app again and it will look in the usual places.");
    return 1;
  }

  console.log("");
  console.log(`Redis is installed: ${installed}`);
  console.log("");
  console.log("  Nothing else to do. Mirrai finds it on its own, and starts one");
  console.log("  itself if there is not already one running.");
  console.log("");
  return 0;
}

process.exit(main());
