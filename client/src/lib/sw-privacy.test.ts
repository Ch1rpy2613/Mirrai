import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

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
});
