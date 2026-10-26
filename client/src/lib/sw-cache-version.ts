import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The files the service worker caches that the build does not hash.
 *
 * The hashed assets are named after their content, so a new build gets
 * new names and the cache never serves the old one. These four are
 * copied verbatim, so their names never change — and a cache that is
 * never invalidated would keep serving the first install's copy for
 * ever.
 */
export const SERVICE_WORKER_CACHED_FILES = [
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "fonts/MiSans-subset.woff2",
];

/**
 * The name of the service worker's cache.
 *
 * It is the hash of the files the worker caches, so it changes exactly
 * when they change — and the activate step, which deletes every cache
 * whose name is not this one, then throws away the old one.
 *
 * It used to be a constant that a human had to remember to change, and
 * the test that guarded it only checked that it was not the previous
 * value — so it passed for any value at all.
 */
export function serviceWorkerCacheVersion(publicDir: string): string {
  const hash = createHash("sha256");
  for (const file of SERVICE_WORKER_CACHED_FILES) {
    const full = path.join(publicDir, file);
    hash.update(file);
    if (existsSync(full)) hash.update(readFileSync(full));
  }
  return `mirrai-${hash.digest("hex").slice(0, 12)}`;
}
