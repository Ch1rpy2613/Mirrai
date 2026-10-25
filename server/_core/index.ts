import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./auth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { csrfGuard } from "./csrf";
import { initRateLimiter } from "./rate-limit";
import { uploadsAuthGuard } from "./uploads";
import { registerChatStreamRoute } from "../chat/stream-route";
import { bootstrapAdminAccount } from "../bootstrap/bootstrap";
import { migrateLegacyTTSFiles } from "./tts";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Uploads are private to their owner — see `uploadsAuthGuard`.
  const uploadsPath = path.resolve(ENV.uploadDir);
  app.use("/uploads", uploadsAuthGuard, express.static(uploadsPath));

  // Reject mutating requests that come from another origin.
  app.use("/api", csrfGuard);

  registerAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // The token-by-token chat endpoint. tRPC has no streaming support, so it
  // lives as a plain SSE route.
  registerChatStreamRoute(app);

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Move pre-scoped TTS files out of the shared folder.
  await migrateLegacyTTSFiles().catch((e) =>
    console.warn("[TTS] Legacy audio migration failed:", e),
  );

  // Create the first administrator on an empty instance.
  await bootstrapAdminAccount().catch((e) =>
    console.error("[Bootstrap] First-run setup failed:", e),
  );

  // The rate limiter, counted in a store every copy of the app shares.
  //
  // It is set up after the server is already listening, because a Redis
  // that cannot be reached must not stop the app from starting — the
  // limiter simply counts per process, as it always did.
  await initRateLimiter().catch((e) =>
    console.warn("[Rate-limit] Could not set up the shared store:", e),
  );

  // Collection jobs: mirror every state change into the database, and mark
  // the ones that were still running when the process stopped.
  try {
    const { onJobUpdate } = await import("../collectors/jobs");
    const { persistCollectorJob, markInterruptedCollectorJobs } =
      await import("../collectors/db-store");
    onJobUpdate((job) => {
      void persistCollectorJob(job);
    });
    const interrupted = await markInterruptedCollectorJobs();
    if (interrupted > 0) {
      console.log(`[Collectors] Marked ${interrupted} interrupted collection job(s)`);
    }
  } catch (e) {
    console.warn("[Collectors] Failed to start the job store:", e);
  }

  // Proactive reminders — anniversaries and the like.
  try {
    const { startScheduler } = await import("../scheduler");
    startScheduler();
  } catch (e) {
    console.warn("[Scheduler] Failed to start:", e);
  }

  // Restore the channels that were connected before the last restart — the
  // WeChat ClawBot long-poll loop and the Feishu long connection both keep
  // their state in the database, so a restart does not need a fresh scan.
  try {
    const { getAllUserIds } = await import("../db");
    const { restoreChannels } = await import("../channels");
    await restoreChannels(await getAllUserIds());
  } catch (e) {
    console.warn("[Channels] Failed to restore channels:", e);
  }
}

startServer().catch(console.error);
