import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

/**
 * The host names the development server answers to.
 *
 * The machine's own names, plus anything the operator has listed in
 * `DEV_ALLOWED_HOSTS` — which is how the dev server is reached from a
 * phone on the same network.
 */
function devAllowedHosts(): string[] {
  const hosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];
  const extra = (process.env.DEV_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...hosts, ...extra];
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    /**
     * Which host names the dev server answers to.
     *
     * `true` turns Vite's host-header check off, and that check is the
     * protection against DNS rebinding: without it a name that resolves
     * to the developer's machine can be pointed at the dev server and
     * read from a page the developer has open. It is only reached in
     * development, but a developer's machine is still a machine.
     */
    allowedHosts: devAllowedHosts(),
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
