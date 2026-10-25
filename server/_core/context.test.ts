import { describe, expect, it } from "vitest";
import { EventEmitter } from "events";
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
 * checked.
 */
class FakeRequest extends EventEmitter {
  headers: Record<string, unknown> = {};
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
    const signal = requestAbortSignal(req as any);

    expect(signal.aborted).toBe(false);
    expect(await fires(signal, 50)).toBe(false);
  });

  it("fires when the request is aborted", async () => {
    const req = new FakeRequest();
    const signal = requestAbortSignal(req as any);

    req.emit("aborted");

    expect(signal.aborted).toBe(true);
  });

  it("fires when the connection closes", async () => {
    // "close" is what a browser fires when the tab is closed or the
    // network drops. It is the case that was easy to miss.
    const req = new FakeRequest();
    const signal = requestAbortSignal(req as any);

    req.emit("close");

    expect(signal.aborted).toBe(true);
  });

  it("fires only once, however many times the request ends", async () => {
    const req = new FakeRequest();
    const signal = requestAbortSignal(req as any);
    let aborts = 0;
    signal.addEventListener("abort", () => {
      aborts++;
    });

    req.emit("aborted");
    req.emit("close");
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
