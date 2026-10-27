import { describe, expect, it, vi, afterEach } from "vitest";
import { endOnSignal } from "./_core/redis";

/**
 * Who ends the process.
 *
 * The Redis exit hook used to call `process.exit(0)` on SIGINT and
 * SIGTERM — and the app's own shutdown never ran.
 *
 * The Redis is connected early (the scheduler needs it), so that
 * handler was registered *before* the server's, and it killed the
 * process while the HTTP server was still serving, the channels were
 * still connected, and the requests in flight were still running. And
 * in the other order it was no better: the server's shutdown is
 * asynchronous, so the second handler ended the process while the
 * first was still stopping the scheduler.
 */

const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

afterEach(() => {
  exit.mockClear();
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

describe("the signal that ends the process", () => {
  it("leaves the process to the app's own shutdown", () => {
    // The app's handler, as the server registers it.
    const serverHandler = () => {};
    process.once("SIGTERM", serverHandler);

    const self = () => {};
    process.once("SIGTERM", self);

    const ended = endOnSignal("SIGTERM", self);

    // The app's shutdown is going to run, so this is not the end.
    expect(ended).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it("ends the process when nothing else is listening", () => {
    const self = () => {};
    process.once("SIGTERM", self);

    const ended = endOnSignal("SIGTERM", self);

    expect(ended).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not mistake another signal's handler for this one", () => {
    const onInterrupt = () => {};
    process.once("SIGINT", onInterrupt);

    const self = () => {};
    process.once("SIGTERM", self);

    // Nobody is listening for SIGTERM, so the process ends — the
    // SIGINT handler is a different signal.
    expect(endOnSignal("SIGTERM", self)).toBe(true);
  });
});
