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

/* The shell version. Bump it to invalidate the caches. */
const CACHE_VERSION = "mirrai-v1";

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // A single missing entry must not fail the whole install.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
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
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/", { ignoreSearch: true })),
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
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
