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
     *
     * The option that used to do this — `environmentMatchGlobs` — was
     * removed from Vitest, so it had been doing nothing at all: a
     * component test without its own `// @vitest-environment jsdom`
     * line ran in node and failed on `document is not defined`, with
     * nothing pointing at the reason.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "server/**/*.test.ts",
            "server/**/*.spec.ts",
            "client/**/*.test.ts",
            "client/**/*.spec.ts",
            // The shared modules are read by both sides, and they carry rules of
            // their own — the graduation mode, the time zones, the copy tables.
            // They deserve tests that actually run.
            "shared/**/*.test.ts",
            "shared/**/*.spec.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          environment: "jsdom",
          include: [
            "client/**/*.test.tsx",
            "client/**/*.spec.tsx",
          ],
        },
      },
    ],
    setupFiles: ["client/src/test/setup.ts"],
    /**
     * `streamdown` is loaded into the test process rather than left to
     * Node.
     *
     * It imports KaTeX's stylesheet, and Node cannot load a `.css` file
     * — so an externalised `streamdown` fails at import time and the test
     * that renders the real markdown pipeline cannot run. Letting Vite
     * handle it means the stylesheet is stubbed, which is all a test
     * needs.
     */
    server: {
      deps: {
        inline: ["streamdown"],
      },
    },
  },
});
