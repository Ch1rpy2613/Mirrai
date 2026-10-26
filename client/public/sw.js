/*
 * Mirrai service worker.
 *
 * The app is local-first, so the point of the worker is to make the shell
 * load without a network — not to make conversations available offline.
 *
 * Privacy rule: nothing under /api/ or /uploads/ is ever cached. Those are
 * the user's conversations, their photos and their synthesised speech; they
 * belong on their machine and nowhere else.
 */

/**
 * The shell version. Bump it to invalidate the caches.
 *
 * The name is the whole invalidation mechanism: the activate step deletes
 * every cache whose name is not this one. So a constant name means the
 * cache is never invalidated, and the files in it that are *not* hashed by
 * the build — the manifest, the icons, the font — stayed at the version
 * from the very first install, for ever. A user who updated the app kept
 * the old icon and the old manifest.
 */
const CACHE_VERSION = "mirrai-v2";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/fonts/MiSans-subset.woff2",
];

/** Paths that must never be written to the cache. */
function isPrivatePath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/uploads/") ||
    pathname === "/api" ||
    pathname === "/uploads"
  );
}

/** What the browser is shown when there is nothing to show. */
function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8">' +
      "<title>Offline</title>" +
      '<body style="font-family:system-ui,sans-serif;padding:2rem">' +
      "<h1>Offline</h1>" +
      "<p>This page needs the app to be running.</p></body></html>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * The assets the built shell refers to.
 *
 * The shell is the HTML, and the HTML names the hashed script and style
 * files it loads. Those were not in the cache: the worker only cached
 * an asset when it was already controlling the page, and the worker is
 * registered on `load` — so the first load's assets were fetched
 * without it and never cached, and they were only cached from the
 * *second* load onwards.
 *
 * The consequence: a user who installed the app and then opened it
 * with no network got the cached HTML and a 404 for every script — a
 * blank white page. It only worked after the app had been opened online
 * twice.
 *
 * So the shell is read, and the assets it names are put in the same
 * cache.
 */
async function cacheShell() {
  const cache = await caches.open(CACHE_VERSION);
  // A single missing entry must not fail the whole install.
  await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));

  try {
    const response = await fetch("/", { cache: "no-store" });
    if (!response || !response.ok) return;
    const html = await response.clone().text();
    await cache.put("/", response.clone());

    const assets = [];
    const pattern = /(?:src|href)="(\/assets\/[^"]+)"/g;
    let match = pattern.exec(html);
    while (match !== null) {
      assets.push(match[1]);
      match = pattern.exec(html);
    }
    await Promise.allSettled(assets.map((url) => cache.add(url)));
  } catch {
    // No network at install time: the shell that is already cached is
    // what there is.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Private data is always fetched straight from the server.
  if (isPrivatePath(url.pathname)) return;

  // Navigations: try the network first so a deployed update is picked up,
  // and fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put("/", copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          // `caches.match` resolves with nothing when the shell was never
          // cached, and answering a navigation with nothing is a network
          // error — the browser says "this site can't be reached" rather
          // than showing the app.
          const cached = await caches.match("/", { ignoreSearch: true });
          return cached ?? offlineResponse();
        }),
    );
    return;
  }

  // Static assets: cache first. The build hashes their names, so a changed
  // file is a new URL.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      });
    }),
  );
});
