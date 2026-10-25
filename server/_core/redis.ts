/**
 * Redis, without the configuration.
 *
 * The point of this module is that **the user does not have to do
 * anything**. A rate limiter that only works when somebody has read a
 * setup guide and wired up a Redis instance is a rate limiter that most
 * people will run without, and then wonder why the limits are not what
 * they said.
 *
 * So the endpoint is resolved in this order:
 *
 *   1. `REDIS_URL`, if it is set.
 *   2. A Redis already listening on the default port.
 *   3. An instance this app started itself, shared with any other
 *      Mirrai process on the same machine.
 *
 * `MIRRAI_REDIS=managed` skips straight to step 3, and
 * `MIRRAI_REDIS=off` turns the shared store off entirely. Neither is
 * needed for the app to work; they are there for the times somebody
 * wants to be explicit.
 *
 * Step 3 is the one that makes it turnkey. The app looks for a
 * `redis-server` binary, starts one on a private port with a lock file
 * so that a second Mirrai process joins the same one rather than
 * starting its own, and stops it when it exits. Nothing to install, no
 * port to pick, no file to edit.
 *
 * If none of that works — no binary, no permission, a locked-down
 * machine — the app still starts and the limiter falls back to
 * in-process counting. Redis makes the limits correct across
 * processes; it is not what makes the app run.
 */
import { spawn, type ChildProcess } from "child_process";
import { createConnection } from "net";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { createClient, type RedisClientType } from "redis";

/** The client type, without the generics that the redis package infers. */
export type RedisClient = RedisClientType;

export interface RedisHandle {
  /** Where it is. */
  url: string;
  client: RedisClient;
  /**
   * True when this process started the server and is responsible for
   * stopping it.
   */
  managed: boolean;
}

const DEFAULT_URL = "redis://127.0.0.1:6379";

/** Where the shared instance's details are kept. */
function dataDir(): string {
  const configured = process.env.MIRRAI_DATA_ROOT?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), ".mirrai");
}

function instanceFile(): string {
  return path.join(dataDir(), "redis-instance.json");
}

function lockFile(): string {
  return path.join(dataDir(), "redis-instance.lock");
}

/**
 * Where the processes using the shared instance record themselves.
 *
 * The instance belongs to the machine, not to the process that happened
 * to start it. If that process closes while another copy of Mirrai is
 * still running, the Redis has to stay up — otherwise the second copy
 * loses its limits halfway through.
 */
function clientsDir(): string {
  return path.join(dataDir(), "redis-clients");
}

function registerClient(port: number) {
  try {
    mkdirSync(clientsDir(), { recursive: true });
    writeFileSync(
      path.join(clientsDir(), `${process.pid}.json`),
      JSON.stringify({ port, pid: process.pid, at: Date.now() }),
    );
  } catch {
    /* the instance still works, it just will not be shared */
  }
}

function unregisterClient() {
  try {
    unlinkSync(path.join(clientsDir(), `${process.pid}.json`));
  } catch {
    /* already gone */
  }
}

/**
 * The other processes still using the instance.
 *
 * A file left behind by a process that died is not a user: the pid is
 * checked, and a dead one is ignored.
 */
function otherLiveClients(port: number): number {
  try {
    if (!existsSync(clientsDir())) return 0;
    let count = 0;
    for (const name of readdirSync(clientsDir())) {
      if (!name.endsWith(".json")) continue;
      const pid = Number(name.replace(".json", ""));
      if (!Number.isFinite(pid) || pid === process.pid) continue;
      if (!isProcessAlive(pid)) continue;
      try {
        const info = JSON.parse(readFileSync(path.join(clientsDir(), name), "utf8"));
        if (info?.port === port) count++;
      } catch {
        /* an unreadable record is not a user */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let handle: RedisHandle | null = null;
let starting: Promise<RedisHandle | null> | null = null;
let managedChild: ChildProcess | null = null;

/**
 * Connects to a Redis, or returns null when there is none to be had.
 *
 * Never throws: the app must start whether or not Redis is there.
 */
export async function connectRedis(): Promise<RedisHandle | null> {
  if (handle) return handle;
  if (starting) return starting;
  starting = doConnect().finally(() => {
    starting = null;
  });
  handle = await starting;
  return handle;
}

/** The handle, if one was already established. */
export function getRedis(): RedisHandle | null {
  return handle;
}

async function doConnect(): Promise<RedisHandle | null> {
  const mode = (process.env.MIRRAI_REDIS ?? "auto").trim().toLowerCase();
  if (mode === "off") {
    console.log("[redis] Disabled by MIRRAI_REDIS=off — the rate limiter counts per process.");
    return null;
  }

  // 1. An explicit endpoint wins.
  const configured = process.env.REDIS_URL?.trim();
  if (configured) {
    const connected = await tryConnect(configured);
    if (connected) return connected;
    console.warn(
      `[redis] REDIS_URL (${configured}) could not be reached — looking for another one.`,
    );
  }

  // 2. A Redis already running on the default port.
  if (!configured && mode !== "managed") {
    const local = await tryConnect(DEFAULT_URL);
    if (local) return local;
  }

  // 3. One this app starts, shared with the other Mirrai processes here.
  const managed = await startManagedInstance();
  if (managed) return managed;

  return null;
}

/** Connects to an endpoint, returning null instead of throwing. */
async function tryConnect(url: string): Promise<RedisHandle | null> {
  let client: RedisClient;
  try {
    client = createClient({
      url,
      socket: { connectTimeout: 1500, reconnectStrategy: false },
    }) as RedisClient;
  } catch {
    return null;
  }
  // Without a listener, a connection error takes the process down.
  client.on("error", () => {});
  try {
    await client.connect();
  } catch {
    try {
      client.destroy();
    } catch {
      /* already gone */
    }
    return null;
  }
  return { url, client, managed: false };
}

interface InstanceInfo {
  port: number;
  pid: number;
}

/**
 * Starts a Redis that the other Mirrai processes on this machine share.
 *
 * The lock file is the whole trick: the first process to get it starts
 * the server and writes down the port, and every process after that
 * connects to the port it finds there. Two copies of Mirrai on one
 * machine therefore share one Redis, and the limits mean what they say.
 */
async function startManagedInstance(): Promise<RedisHandle | null> {
  const binary = findRedisServer();
  if (!binary) {
    console.log(
      "[redis] No redis-server binary found — the rate limiter counts per process. " +
        "Install Redis, or set REDIS_URL, to have one limit across every process.",
    );
    return null;
  }

  const dir = dataDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }

  // An instance a previous run left behind.
  const existing = readInstance();
  if (existing && (await isRedisAlive(existing.port))) {
    const connected = await tryConnect(`redis://127.0.0.1:${existing.port}`);
    if (connected) {
      registerClient(existing.port);
      stopManagedOnExit();
      console.log(`[redis] Using the instance already running on port ${existing.port}.`);
      return connected;
    }
  }
  // A stale record of a process that is gone.
  if (existing) {
    try {
      unlinkSync(instanceFile());
    } catch {
      /* nothing to clean up */
    }
  }

  // Take the lock, or wait for whoever has it.
  for (let attempt = 0; attempt < 40; attempt++) {
    let fd: number | null = null;
    try {
      fd = openSync(lockFile(), "wx");
    } catch {
      // Somebody else is starting it. Wait for the port they publish.
      const published = readInstance();
      if (published && (await isRedisAlive(published.port))) {
        const connected = await tryConnect(`redis://127.0.0.1:${published.port}`);
        if (connected) return connected;
      }
      await sleep(150);
      continue;
    }

    try {
      const port = await freePort();
      const child = spawn(
        binary,
        [
          "--port", String(port),
          "--bind", "127.0.0.1",
          "--save", "",
          "--appendonly", "no",
          "--protected-mode", "no",
          "--dir", os.tmpdir(),
        ],
        { stdio: "ignore", detached: false },
      );
      child.unref?.();

      const started = await waitForRedis(port, 8000);
      if (!started) {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        return null;
      }

      managedChild = child;
      writeInstance({ port, pid: child.pid ?? 0 });
      registerClient(port);
      stopManagedOnExit();

      const connected = await tryConnect(`redis://127.0.0.1:${port}`);
      if (!connected) return null;
      console.log(
        `[redis] Started a Redis on port ${port} for this machine. ` +
          "Nothing to configure — it stops when the app stops.",
      );
      return { ...connected, managed: true };
    } finally {
      try { closeSync(fd); } catch { /* already closed */ }
      try { unlinkSync(lockFile()); } catch { /* already gone */ }
    }
  }

  return null;
}

/**
 * Finds a redis-server binary, if the machine has one.
 *
 * The `PATH` is searched first, because that is where a package manager
 * puts it. But an app started from a launcher — a dock icon, a desktop
 * shortcut, a service manager — often has a much smaller `PATH` than the
 * one a person has in a terminal, and on macOS the Homebrew binary lives
 * outside the default set. So the places a package manager actually uses
 * are checked too.
 *
 * The point is that the app starts a Redis on its own. A user who
 * installed Redis and then started the app from an icon should not have to
 * know that.
 */
function findRedisServer(): string | null {
  const explicit = process.env.REDIS_SERVER_BIN?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const pathEnv = process.env.PATH ?? "";
  const directories = pathEnv.split(path.delimiter).filter(Boolean);

  // Where the package managers put it, whether or not `PATH` says so.
  const usual = [
    "/opt/homebrew/bin", // Homebrew on Apple silicon
    "/usr/local/bin", // Homebrew on Intel, and the manual install
    "/usr/bin", // apt
    "/usr/local/redis/bin", // the source install
    "/opt/local/bin", // MacPorts
  ];
  for (const directory of usual) {
    if (!directories.includes(directory)) directories.push(directory);
  }

  for (const directory of directories) {
    const candidate = path.join(directory, "redis-server");
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* an unreadable directory is not a redis */
    }
  }
  return null;
}

function readInstance(): InstanceInfo | null {
  try {
    if (!existsSync(instanceFile())) return null;
    const parsed = JSON.parse(readFileSync(instanceFile(), "utf8"));
    if (typeof parsed?.port === "number" && typeof parsed?.pid === "number") {
      return parsed as InstanceInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function writeInstance(info: InstanceInfo) {
  try {
    writeFileSync(instanceFile(), JSON.stringify(info));
  } catch {
    /* the instance still works, it just will not be shared */
  }
}

/** True when something is listening on the port. */
function isRedisAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForRedis(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRedisAlive(port)) return true;
    await sleep(100);
  }
  return false;
}

/** A port nothing is using. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stops the Redis this process started, when the app goes away. */
let exitHookInstalled = false;
function stopManagedOnExit() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const stop = () => {
    unregisterClient();
    try {
      const info = readInstance();
      if (!info?.pid) return;
      // Another copy of Mirrai is still using it — it is the machine's
      // Redis now, not this process's.
      if (otherLiveClients(info.port) > 0) return;
      process.kill(info.pid, "SIGTERM");
      try { unlinkSync(instanceFile()); } catch { /* nothing to clean up */ }
    } catch {
      /* already gone */
    }
  };
  process.once("exit", stop);
  process.once("SIGINT", () => { stop(); process.exit(0); });
  process.once("SIGTERM", () => { stop(); process.exit(0); });
}

/**
 * Runs `fn` while holding a lock that no other process can take.
 *
 * Returns null when the lock is held elsewhere. This is what keeps two
 * copies of Mirrai from both running the reminder sweep and both
 * delivering the same proactive message.
 */
export async function withRedisLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const redis = handle ?? (await connectRedis());
  if (!redis) return null;

  const key = `mirrai:lock:${name}`;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  const taken = await redis.client.set(key, token, { NX: true, PX: ttlMs });
  if (taken !== "OK") return null;

  try {
    return await fn();
  } finally {
    // Only release it if it is still ours.
    await redis.client
      .eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
        { keys: [key], arguments: [token] },
      )
      .catch(() => 0);
  }
}

/** Closes the connection and stops a Redis this process started. */
export async function closeRedis(): Promise<void> {
  const current = handle;
  handle = null;
  if (!current) return;
  try {
    await current.client.quit();
  } catch {
    try { current.client.destroy(); } catch { /* already gone */ }
  }
  unregisterClient();
  if (current.managed) {
    try {
      const info = readInstance();
      if (!info?.pid) return;
      if (otherLiveClients(info.port) > 0) return;
      process.kill(info.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    try { unlinkSync(instanceFile()); } catch { /* nothing to clean up */ }
  }
}
