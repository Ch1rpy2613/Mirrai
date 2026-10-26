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
 *
 * The subtlety is *which* event means "the client is gone".
 *
 * A request object emits `close` as soon as its body has been read — and
 * the body is read by the JSON parser before the route handler runs at
 * all. Listening to `req`'s `close` therefore aborted every request the
 * instant it arrived, which meant every reply was cancelled before the
 * model was ever called. `req`'s `aborted` event is the honest one: it
 * fires when a request is cut off in flight, and not when it finishes.
 *
 * The response is the other half of the answer. It emits `close` when the
 * connection is torn down, and `writableEnded` says whether the response
 * had already been finished when that happened — a reply that was written
 * out normally is not a cancellation.
 */
export function requestAbortSignal(
  req: TrpcContext["req"],
  res?: TrpcContext["res"],
): AbortSignal {
  const controller = new AbortController();
  const anyReq = req as any;
  const anyRes = res as any;

  const onGone = () => {
    // The response was finished — this is not a cancellation.
    if (anyRes?.writableEnded) return;
    if (!controller.signal.aborted) controller.abort();
  };

  if (typeof anyReq?.on === "function") {
    // A request that is cut off mid-flight says so with `aborted`.
    anyReq.on("aborted", onGone);
  }
  if (typeof anyRes?.on === "function") {
    // The connection went away before the response was finished.
    anyRes.on("close", onGone);
  }
  return controller.signal;
}
