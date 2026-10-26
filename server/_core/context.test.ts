import { describe, expect, it } from "vitest";
import { EventEmitter } from "events";
import express from "express";
import type { AddressInfo } from "net";
import { requestAbortSignal, readLocale } from "./context";

/**
 * The abort signal.
 *
 * Pressing "stop" on a reply that is being generated is the one moment
 * the user is most likely to want the app to actually stop. The signal
 * is what makes that possible, and it is what stops the model running to
 * the end and the answer being stored anyway.
 *
 * It had no test, which meant the one behaviour the whole feature rests
 * on — that the signal fires when the client goes away — was never
 * checked. And the test that did exist was wrong in a way that hid a
 * real bug: it believed that a request's `close` event meant "the client
 * went away", when in fact Node emits it as soon as the request body has
 * been read. Every reply was therefore cancelled before the model was
 * called.
 */
class FakeRequest extends EventEmitter {
  headers: Record<string, unknown> = {};
}

/** A response double: an emitter that knows whether it has been finished. */
class FakeResponse extends EventEmitter {
  writableEnded = false;
}

/** Waits for the signal to fire, without hanging the test if it never does. */
function fires(signal: AbortSignal, timeoutMs = 200): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(signal.aborted), timeoutMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("the abort signal", () => {
  it("does not fire while the request is still open", async () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);

    expect(signal.aborted).toBe(false);
    expect(await fires(signal, 50)).toBe(false);
  });

  it("fires when the request is aborted in flight", async () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);

    req.emit("aborted");

    expect(signal.aborted).toBe(true);
  });

  it("fires when the connection closes before the reply was written", async () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);

    res.emit("close");

    expect(signal.aborted).toBe(true);
  });

  it("does not fire when the response was finished first", async () => {
    // The ordinary case: the reply was written and the connection closed
    // afterwards. Nothing was cancelled.
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);

    res.writableEnded = true;
    res.emit("close");

    expect(signal.aborted).toBe(false);
  });

  it("does not fire when the request body has merely been read", async () => {
    // This is the bug. Node emits `close` on the request as soon as the
    // body has been consumed — which the JSON parser does before the
    // handler is even entered. Treating that as "the client went away"
    // cancelled every single reply.
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);

    req.emit("close");

    expect(signal.aborted).toBe(false);
    expect(await fires(signal, 50)).toBe(false);
  });

  it("fires only once, however many times the request ends", async () => {
    const req = new FakeRequest();
    const res = new FakeResponse();
    const signal = requestAbortSignal(req as any, res as any);
    let aborts = 0;
    signal.addEventListener("abort", () => {
      aborts++;
    });

    req.emit("aborted");
    res.emit("close");
    req.emit("aborted");

    expect(aborts).toBe(1);
    expect(signal.aborted).toBe(true);
  });

  it("copes with a request that has no event emitter", () => {
    // A test double, or a framework object that is not an EventEmitter.
    // It must not throw — a signal that cannot be made is still a signal.
    const signal = requestAbortSignal({} as any);
    expect(signal.aborted).toBe(false);
  });

  it("survives a real request whose body has been read", async () => {
    // The end-to-end version of the regression: a real Express server,
    // a real body, and a real response. The signal must still be alive
    // once the handler has been entered.
    const app = express();
    app.use(express.json());
    app.post("/x", async (req, res) => {
      const signal = requestAbortSignal(req as any, res as any);
      // Give the request stream time to emit whatever it emits.
      await new Promise((resolve) => setTimeout(resolve, 30));
      res.json({ aborted: signal.aborted });
    });

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/x`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      const body = (await response.json()) as { aborted: boolean };
      expect(body.aborted).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("the language the client asks for", () => {
  it("reads English when the client says so", () => {
    expect(readLocale({ headers: { "x-mirrai-locale": "en" } })).toBe("en");
  });

  it("defaults to Chinese", () => {
    expect(readLocale({ headers: {} })).toBe("zh");
    expect(readLocale({ headers: { "x-mirrai-locale": "fr" } })).toBe("zh");
    expect(readLocale({ headers: { "x-mirrai-locale": ["en"] } })).toBe("en");
  });
});
