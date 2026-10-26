import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  SERVICE_WORKER_CACHED_FILES,
  serviceWorkerCacheVersion,
} from "./sw-cache-version";

/**
 * The service worker makes a promise about the user's privacy: nothing under
 * `/api/` or `/uploads/` is ever written to the cache. That promise is worth
 * a test, because a careless change to the fetch handler would silently
 * start storing conversations on the user's disk.
 *
 * The worker is plain JavaScript, so it is loaded into a sandbox with a fake
 * `self` and a fake `caches`, and the real fetch handler is exercised.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SW_PATH = path.join(ROOT, "client", "public", "sw.js");

const ORIGIN = "http://localhost:3000";

type FetchListener = (event: {
  request: { method: string; url: string; mode: string };
  respondWith: (value?: unknown) => void;
}) => void;

function loadServiceWorker() {
  const source = readFileSync(SW_PATH, "utf-8");

  const listeners: Record<string, FetchListener[]> = {};
  const cacheWrites: string[] = [];

  const caches = {
    open: async () => ({
      add: async () => undefined,
      put: async (request: any) => {
        const url =
          typeof request === "string" ? request : request?.url ?? String(request);
        cacheWrites.push(url);
      },
      match: async () => undefined,
    }),
    keys: async () => [],
    delete: async () => true,
    match: async () => undefined,
  };

  const self = {
    addEventListener: (type: string, fn: FetchListener) => {
      (listeners[type] ??= []).push(fn);
    },
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
  };

  const context = vm.createContext({
    self,
    caches,
    fetch: async () => ({ ok: true, type: "basic", clone: () => ({}) }),
    URL,
    Response,
    Request,
    console,
    Promise,
  });

  vm.runInContext(source, context, { filename: SW_PATH });

  return { listeners, cacheWrites };
}

/**
 * Runs the worker's fetch handler for a URL.
 *
 * Returns whether the worker took the request over (`respondWith` was
 * called). A request the worker does not answer goes straight to the
 * network, which is what "never cached" means in practice.
 */
function dispatchFetch(
  listeners: Record<string, FetchListener[]>,
  url: string,
  options: { method?: string; mode?: string } = {},
) {
  let responded = false;
  const event = {
    request: {
      method: options.method ?? "GET",
      url,
      mode: options.mode ?? "no-cors",
    },
    respondWith: () => {
      responded = true;
    },
  };

  for (const fn of listeners.fetch ?? []) fn(event);
  return responded;
}

describe("the service worker", () => {
  it("loads and registers its listeners", () => {
    const { listeners } = loadServiceWorker();
    expect(listeners.install).toBeDefined();
    expect(listeners.activate).toBeDefined();
    expect(listeners.fetch).toBeDefined();
  });

  it("never takes over a request under /api/", () => {
    const { listeners } = loadServiceWorker();
    for (const path of [
      "/api/trpc/chat.send",
      "/api/chat/stream",
      "/api/auth/login",
      "/api",
    ]) {
      expect(
        dispatchFetch(listeners, `${ORIGIN}${path}`),
        `${path} must go straight to the network`,
      ).toBe(false);
    }
  });

  it("never takes over a request under /uploads/", () => {
    const { listeners } = loadServiceWorker();
    for (const path of [
      "/uploads/personas/1/2/photo.png",
      "/uploads/chat/1/2/voice.webm",
      "/uploads/tts/1/abc.mp3",
      "/uploads",
    ]) {
      expect(
        dispatchFetch(listeners, `${ORIGIN}${path}`),
        `${path} must go straight to the network`,
      ).toBe(false);
    }
  });

  it("does not cache a conversation fetched over the API", async () => {
    const { listeners, cacheWrites } = loadServiceWorker();
    dispatchFetch(listeners, `${ORIGIN}/api/trpc/chat.getHistory`);
    // Give any pending promise a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cacheWrites).toEqual([]);
  });

  it("still serves the app shell offline", () => {
    const { listeners } = loadServiceWorker();
    expect(
      dispatchFetch(listeners, `${ORIGIN}/assets/index-abc123.js`),
    ).toBe(true);
    expect(dispatchFetch(listeners, `${ORIGIN}/`, { mode: "navigate" })).toBe(true);
  });

  it("ignores non-GET requests", () => {
    const { listeners } = loadServiceWorker();
    expect(
      dispatchFetch(listeners, `${ORIGIN}/api/trpc/chat.send`, { method: "POST" }),
    ).toBe(false);
  });

  it("names its cache after the release", () => {
    // The cache name is the whole invalidation mechanism: the activate
    // step deletes every cache whose name is not this one. A name that
    // never changes means the cache is never invalidated, and the files
    // in it that the build does not hash — the manifest, the icons, the
    // font — stay at the version from the first install, for ever.
    //
    // The check used to be `expect(match?.[1]).toBeTruthy()` — which
    // passes for the placeholder the build replaces, and for any other
    // string at all. So it could not fail.
    const source = readFileSync(SW_PATH, "utf-8");
    const match = /const CACHE_VERSION = "([^"]+)"/.exec(source);
    expect(match, "the service worker has no cache name at all").not.toBeNull();
    // The placeholder is what the build replaces, so the name has to be
    // *in* the source — and the build's job is to write over it.
    expect(match![1]).toBe("mirrai-BUILD");
    // And the name it becomes has to be the hash of the files it
    // caches.
    const publicDir = path.dirname(SW_PATH);
    expect(serviceWorkerCacheVersion(publicDir)).toMatch(/^mirrai-[0-9a-f]{12}$/);
  });

  it("is given a name that changes when the files it caches change", () => {
    // The name used to be a constant a human had to remember to change,
    // and the test only checked that it was not the previous one — so
    // it passed for any value at all.
    //
    // The build now writes the hash of the files into it, so this
    // checks that the hash is the hash: a file that changes without the
    // name changing fails the build.
    const source = readFileSync(SW_PATH, "utf-8");
    // The placeholder the build replaces.
    expect(source).toContain('const CACHE_VERSION = "mirrai-BUILD"');

    const publicDir = path.dirname(SW_PATH);
    const version = serviceWorkerCacheVersion(publicDir);
    expect(version).toMatch(/^mirrai-[0-9a-f]{12}$/);

    // A file that changes changes the name — that is the whole point.
    const copy = path.join(mkdtempSync(path.join(tmpdir(), "sw-cache-")), "public");
    mkdirSync(copy, { recursive: true });
    for (const file of SERVICE_WORKER_CACHED_FILES) {
      const from = path.join(publicDir, file);
      const to = path.join(copy, file);
      mkdirSync(path.dirname(to), { recursive: true });
      if (existsSync(from)) writeFileSync(to, readFileSync(from));
    }
    expect(serviceWorkerCacheVersion(copy)).toBe(version);

    // One byte different in one file is a different name.
    const icon = path.join(copy, "icons", "icon-192.png");
    writeFileSync(icon, Buffer.concat([readFileSync(icon), Buffer.from([0])]));
    expect(serviceWorkerCacheVersion(copy)).not.toBe(version);
  });

  it("answers a navigation with something when the shell is not cached", async () => {
    // `caches.match` resolves with nothing when the shell was never
    // cached, and answering a navigation with nothing is a network
    // error: the browser says "this site can't be reached" instead of
    // showing the app.
    const source = readFileSync(SW_PATH, "utf-8");
    expect(source).toContain("offlineResponse");
    expect(source).not.toMatch(/catch\(\(\)\s*=>\s*caches\.match\(/);
  });

  it("does not try to cache a failed response", async () => {
    // `cache.put` rejects for a response that is not 2xx, and the put
    // was not awaited, so every 404 produced an unhandled rejection.
    const source = readFileSync(SW_PATH, "utf-8");
    expect(source).toContain("if (response.ok)");
  });
});
