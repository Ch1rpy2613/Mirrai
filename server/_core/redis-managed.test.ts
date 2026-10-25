import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * The Redis the app starts for itself.
 *
 * This is the part that makes Redis out of the box: a person installs the
 * package and the app finds the binary, starts a server on a port of its
 * own choosing, and shares it with the other copies of Mirrai on the
 * machine. Nothing to configure, no file to edit, no port to pick.
 *
 * The tests here start a real `redis-server`, so they are skipped when the
 * machine does not have one — the app has to work without it, and a test
 * suite that fails on a machine without Redis would be a worse thing than
 * an untested path.
 */

/** Whether a `redis-server` binary is there to be started. */
function findRedisServer(): string | null {
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(directory, "redis-server");
    if (existsSync(candidate)) return candidate;
  }
  for (const directory of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    const candidate = join(directory, "redis-server");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const binary = findRedisServer();
const available = Boolean(binary);

let dataRoot = "";
let redis: typeof import("./redis") | null = null;

beforeAll(async () => {
  if (!available) {
    console.warn("[redis-managed.test] No redis-server binary — the managed tests are skipped.");
    return;
  }
  // A private data root, so the test does not touch the instance the
  // machine's own copy of Mirrai would be using.
  dataRoot = mkdtempSync(join(tmpdir(), "mirrai-redis-test-"));
  process.env.MIRRAI_DATA_ROOT = dataRoot;
  process.env.MIRRAI_REDIS = "managed";
  delete process.env.REDIS_URL;

  // A fresh copy of the module: the handle is a module-level singleton, and
  // the test wants the app to start its own instance rather than find one
  // that is already running.
  const mod = await import("./redis");
  redis = mod;
  await mod.connectRedis();
});

afterAll(async () => {
  if (redis) await redis.closeRedis();
  delete process.env.MIRRAI_DATA_ROOT;
  delete process.env.MIRRAI_REDIS;
  if (dataRoot) {
    try {
      rmSync(dataRoot, { recursive: true, force: true });
    } catch {
      /* the temporary directory is the operating system's problem now */
    }
  }
});

describe("the Redis the app starts for itself", () => {
  it("starts one without being told to", async () => {
    if (!available) return;
    const handle = redis!.getRedis();
    expect(handle).not.toBeNull();
    expect(handle!.managed).toBe(true);
    expect(handle!.url).toMatch(/^redis:\/\/127\.0\.0\.1:\d+$/);
  });

  it("answers on the port it chose", async () => {
    if (!available) return;
    const handle = redis!.getRedis()!;
    // The client is connected, so a ping comes back.
    const answer = await handle.client.ping();
    expect(answer).toBe("PONG");
  });

  it("counts against it, so the limits mean something", async () => {
    if (!available) return;
    const { RedisRateLimiter } = await import("./rate-limit");
    const handle = redis!.getRedis()!;
    const limiter = new RedisRateLimiter(handle.client);
    const rule = { name: "managed-test", limit: 2, windowMs: 60_000, scope: "user" as const };
    const key = `managed-${Date.now()}`;

    let allowed = 0;
    for (let i = 0; i < 4; i++) {
      if ((await limiter.check(key, rule)).allowed) allowed++;
    }
    expect(allowed).toBe(rule.limit);
  });

  it("holds a lock that only one holder gets", async () => {
    if (!available) return;
    const name = `managed-lock-${Date.now()}`;
    let running = 0;
    let maxConcurrent = 0;

    await Promise.all(
      Array.from({ length: 4 }, () =>
        redis!.withRedisLock(name, 5000, async () => {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running--;
          return true;
        }),
      ),
    );

    expect(maxConcurrent).toBe(1);
  });

  it("writes down where it is, so another copy of the app finds it", async () => {
    if (!available) return;
    const { readFileSync } = await import("node:fs");
    const info = JSON.parse(
      readFileSync(join(dataRoot, "redis-instance.json"), "utf8"),
    );
    expect(typeof info.port).toBe("number");
    expect(info.port).toBeGreaterThan(0);
  });

  it("stops when the app stops", async () => {
    if (!available) return;
    const { readFileSync, existsSync } = await import("node:fs");
    const { createConnection } = await import("node:net");
    const info = JSON.parse(readFileSync(join(dataRoot, "redis-instance.json"), "utf8"));

    /** Whether something is still listening on the port. */
    const isAlive = () =>
      new Promise<boolean>((resolve) => {
        const socket = createConnection({ port: info.port, host: "127.0.0.1" });
        socket.setTimeout(500);
        const done = (result: boolean) => {
          socket.destroy();
          resolve(result);
        };
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
      });

    await redis!.closeRedis();

    // The server the app started is on its way out. Redis takes a moment
    // to close its listening socket, so the check waits for it rather than
    // racing it.
    let alive = true;
    for (let attempt = 0; attempt < 40 && alive; attempt++) {
      alive = await isAlive();
      if (alive) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(alive).toBe(false);
    expect(existsSync(join(dataRoot, "redis-instance.json"))).toBe(false);
  });
});
