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
import { securityHeaders } from "./security-headers";
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

/**
 * The process does not end because one request failed.
 *
 * Node's default is to end the process on an unhandled rejection — and
 * on a server that is the end of *everything*: the sessions, the
 * scheduler, the WeChat and Feishu channels, the person's own app.
 *
 * The failures that used to end it were ordinary: the database
 * blinked while somebody was reading a reply, a lock could not be
 * taken, a channel's socket closed at the wrong moment. Each of them
 * is now handled where it happens — but a guard here means the next one
 * costs a line in the log instead of the app.
 *
 * The error is printed in full, loudly: this is a net, not a blanket.
 */
function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    console.error(
      "[Server] A promise was rejected and nobody was waiting for it:",
      reason instanceof Error ? reason.stack ?? reason.message : reason,
    );
  });
  process.on("uncaughtException", (error) => {
    console.error("[Server] An exception nobody caught:", error?.stack ?? error);
  });
}

async function startServer() {
  installProcessGuards();
  const app = express();
  const server = createServer(app);

  /**
   * The headers every response carries.
   *
   * They are set before anything else, so they are on the responses of
   * the uploads and of the static files as well as on the API's.
   */
  app.use(securityHeaders);

  /**
   * Which proxies to believe.
   *
   * `X-Forwarded-For` is a header the client can set, so it says
   * nothing about who is calling unless the caller is a proxy the
   * operator has named. The list is empty by default, and the address
   * of the connection is used instead.
   */
  if (ENV.trustedProxies.length > 0) {
    app.set("trust proxy", ENV.trustedProxies);
  }

  /**
   * The body limit for the sign-in routes.
   *
   * The whole app parses up to fifty megabytes of JSON, which the
   * character-card import and the file uploads need. The auth routes
   * need a username and a password — so they get their own, small
   * limit, and they are registered *before* the large one.
   *
   * Without it an unauthenticated client could make the server buffer
   * and parse fifty megabytes per request, at any address it liked.
   */
  app.use("/api/auth", express.json({ limit: "32kb" }));
  app.use("/api/auth", express.urlencoded({ limit: "32kb", extended: true }));

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Uploads are private to their owner — see `uploadsAuthGuard`.
  const uploadsPath = path.resolve(ENV.uploadDir);
  // codeql[js/missing-rate-limiting]
  app.use("/uploads", uploadsAuthGuard, express.static(uploadsPath));
  /**
   * The uploads are private to their owner, and they are files.
   *
   * The rule is about an operation that costs something — a model
   * call, a write, a password check. Reading a file is none of those.
   * And the guard in front of it is the owner check: a request for
   * somebody else's upload is refused before the file is opened.
   */

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

  /**
   * The process is stopped cleanly.
   *
   * There was no handler at all — so a collector that was running
   * survived the server (the DingTalk one drives a Chromium) and went
   * on to its own thirty-minute timeout, the WeChat poll loop went on
   * asking a backend that was no longer being answered, and the
   * scheduler's timer went on firing into a process that was on its
   * way out.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] ${signal} — shutting down.`);

    try {
      const { stopScheduler } = await import("../scheduler");
      stopScheduler();
    } catch (e) {
      console.warn("[Server] Could not stop the scheduler:", e);
    }

    try {
      const { cancelAllCollectorJobs } = await import("../collectors/jobs");
      cancelAllCollectorJobs();
    } catch (e) {
      console.warn("[Server] Could not cancel the collection jobs:", e);
    }

    try {
      const { stopAllChannels } = await import("../channels");
      await stopAllChannels();
    } catch (e) {
      console.warn("[Server] Could not stop the channels:", e);
    }

    // And the requests that are in flight.
    server.close(() => process.exit(0));
    // The deadline: a request that will not finish must not hold the
    // shutdown up for ever.
    setTimeout(() => process.exit(0), 5_000).unref?.();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch(console.error);
