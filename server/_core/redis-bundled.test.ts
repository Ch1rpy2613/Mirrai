import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledRedisCandidates, findRedisServer } from "./redis";

/**
 * The Redis that comes with the app.
 *
 * The installers bundle a Redis, because a person who installs Mirrai must
 * not have to install a Redis as well — that is the whole point of the
 * zero-configuration promise, and a promise that ends with "and then go
 * and download this too" is not one.
 *
 * So the app has to find the Redis that came with it, and it has to find it
 * without being told where it is: the only thing that knows where the app
 * was put is the running executable.
 *
 * The two layouts are:
 *
 *   - **macOS** — `Mirrai.app/Contents/Resources/redis/bin/redis-server`,
 *     with the libraries in `redis/lib` beside it, the same shape as the
 *     bundled PostgreSQL;
 *   - **Windows** — `redis/redis-server.exe` in the folder the archive was
 *     unpacked into, with its DLLs beside it.
 */
describe("the Redis that came with the app", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mirrai-bundled-redis-"));
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* the temporary directory is the operating system's problem now */
    }
  });

  /** Writes a file, making the directories above it. */
  function write(relative: string): string {
    const full = join(root, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
    return full;
  }

  it("looks for the macOS bundle", () => {
    // Mirrai.app/Contents/Resources/node/bin/node
    const execPath = join(root, "Mirrai.app/Contents/Resources/node/bin/node");
    const candidates = bundledRedisCandidates(execPath);

    expect(candidates).toContain(
      join(root, "Mirrai.app/Contents/Resources/redis/bin/redis-server"),
    );
  });

  it("looks for the Windows folder", () => {
    // <dist>/node/node.exe
    const execPath = join(root, "Mirrai-Windows-x64/node/node.exe");
    const candidates = bundledRedisCandidates(execPath);

    expect(candidates).toContain(join(root, "Mirrai-Windows-x64/redis/redis-server.exe"));
  });

  it("stops at the top of the filesystem", () => {
    const candidates = bundledRedisCandidates("/node/bin/node");
    expect(candidates.length).toBeGreaterThan(0);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("finds the bundled binary", () => {
    const execPath = join(root, "Mirrai.app/Contents/Resources/node/bin/node");
    const binary = write("Mirrai.app/Contents/Resources/redis/bin/redis-server");

    expect(findRedisServer(execPath)).toBe(binary);
  });

  it("finds the bundled binary on Windows too", () => {
    const execPath = join(root, "Mirrai-Windows-x64/node/node.exe");
    const binary = write("Mirrai-Windows-x64/redis/redis-server.exe");

    expect(findRedisServer(execPath)).toBe(binary);
  });

  it("prefers the bundled binary over one on the PATH", () => {
    // The bundled one is the one the installer promised, and it is known to
    // work with this build. A Redis the person installed themselves is
    // used only when there is no bundled one.
    const execPath = join(root, "Mirrai.app/Contents/Resources/node/bin/node");
    const bundled = write("Mirrai.app/Contents/Resources/redis/bin/redis-server");

    const elsewhere = mkdtempSync(join(tmpdir(), "mirrai-path-redis-"));
    const originalPath = process.env.PATH;
    try {
      writeFileSync(join(elsewhere, "redis-server"), "");
      process.env.PATH = elsewhere;
      expect(findRedisServer(execPath)).toBe(bundled);
    } finally {
      process.env.PATH = originalPath;
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("falls back to the PATH when there is no bundled one", () => {
    const execPath = join(root, "Mirrai.app/Contents/Resources/node/bin/node");
    const elsewhere = mkdtempSync(join(tmpdir(), "mirrai-path-redis-"));
    const originalPath = process.env.PATH;
    try {
      const onPath = join(elsewhere, "redis-server");
      writeFileSync(onPath, "");
      process.env.PATH = elsewhere;
      expect(findRedisServer(execPath)).toBe(onPath);
    } finally {
      process.env.PATH = originalPath;
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("takes the explicit path over everything", () => {
    const execPath = join(root, "Mirrai.app/Contents/Resources/node/bin/node");
    const explicit = write("somewhere/else/redis-server");
    const original = process.env.REDIS_SERVER_BIN;
    try {
      process.env.REDIS_SERVER_BIN = explicit;
      expect(findRedisServer(execPath)).toBe(explicit);
    } finally {
      if (original === undefined) delete process.env.REDIS_SERVER_BIN;
      else process.env.REDIS_SERVER_BIN = original;
    }
  });
});
