import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  /**
   * The automatic JSX transform.
   *
   * Without it the component tests need `import React from "react"` in
   * every file, because the classic transform puts `React` in scope.
   */
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    /**
     * The component tests need a DOM.
     *
     * The interface had none, because there was nowhere to run them. Now
     * there is: the `.test.tsx` files get a browser-shaped environment,
     * and everything else stays in node.
     */
    environmentMatchGlobs: [
      ["client/**/*.test.tsx", "jsdom"],
      ["client/**/*.test.dom.tsx", "jsdom"],
    ],
    setupFiles: ["client/src/test/setup.ts"],
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "client/**/*.spec.ts",
      "client/**/*.spec.tsx",
      // The shared modules are read by both sides, and they carry rules of
      // their own — the graduation mode, the time zones, the copy tables.
      // They deserve tests that actually run.
      "shared/**/*.test.ts",
      "shared/**/*.spec.ts",
    ],
  },
});
