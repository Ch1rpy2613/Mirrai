import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * The language the interface is in.
   *
   * The server's own words — the errors, the notices — have to be in the
   * language of the person reading them, and the client says which one
   * that is in a header. Without it the server could only guess, and it
   * guessed Chinese.
   */
  locale: "zh" | "en";
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    user = await authenticateRequest(opts.req);
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user, locale: readLocale(opts.req) };
}

/** The language the client asked for, from the request headers. */
export function readLocale(req: { headers?: Record<string, unknown> }): "zh" | "en" {
  const raw = req?.headers?.["x-mirrai-locale"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "en" ? "en" : "zh";
}

/**
 * A signal that fires when the client goes away.
 *
 * The streaming route has its own abort handling; the ordinary request
 * path did not, so pressing "stop" on a reply that was being generated
 * left the model running to the end and the answer stored anyway.
 */
export function requestAbortSignal(req: TrpcContext["req"]): AbortSignal {
  const controller = new AbortController();
  const anyReq = req as any;
  const onClose = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (typeof anyReq?.on === "function") {
    anyReq.on("aborted", onClose);
    anyReq.on("close", onClose);
  }
  return controller.signal;
}
