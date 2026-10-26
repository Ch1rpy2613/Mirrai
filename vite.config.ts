import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { serviceWorkerCacheVersion as computeCacheVersion } from "./client/src/lib/sw-cache-version";

/**
 * The service worker's cache is named after the release.
 *
 * The name is the whole invalidation mechanism: the activate step
 * deletes every cache whose name is not this one. It was a constant
 * that a human had to remember to change — and the files in the cache
 * that the build does not hash (the manifest, the icons, the font)
 * stayed at the version from the very first install for ever.
 *
 * The name is now the hash of those files, so it changes exactly when
 * they change.
 */
function serviceWorkerCacheVersion(): Plugin {
  return {
    name: "mirrai-service-worker-cache-version",
    apply: "build",
    /**
     * The service worker lives in the public directory, so it is copied
     * rather than bundled — and the copy is rewritten afterwards.
     */
    closeBundle() {
      const publicDir = path.resolve(import.meta.dirname, "client", "public");
      const version = computeCacheVersion(publicDir);
      for (const outDir of [
        path.resolve(import.meta.dirname, "dist", "public"),
      ]) {
        const sw = path.join(outDir, "sw.js");
        if (!fs.existsSync(sw)) continue;
        const source = fs.readFileSync(sw, "utf-8");
        fs.writeFileSync(
          sw,
          source.replace(
            /const CACHE_VERSION = "[^"]*"/,
            `const CACHE_VERSION = "${version}"`,
          ),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerCacheVersion()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          motion: ["framer-motion"],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
  },
});
