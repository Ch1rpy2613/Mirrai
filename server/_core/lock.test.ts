import { describe, expect, it } from "vitest";
import { withKeyLock } from "./lock";

/**
 * One operation at a time, per key.
 *
 * The lock keeps the operations of one key in order. It also keeps a
 * copy of the chain around, only to forget it when it is done — and
 * that copy is a promise of its own, which rejects when the work
 * rejects.
 *
 * Nobody was waiting for it. So a failed operation was an unhandled
 * rejection — and Node ends the process on an unhandled rejection.
 * Every persona the user did not own, every rate limit and every
 * refused write could take the whole server down.
 */
describe("the lock", () => {
  it("does not leave an unhandled rejection behind when the work fails", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        withKeyLock("test-key", async () => {
          throw new Error("the work failed");
        }),
      ).rejects.toThrow("the work failed");

      // The rejection is reported a turn later — the copy of the
      // promise is settled in the background.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(rejections).toEqual([]);
  });

  it("still tells the caller that the work failed", async () => {
    await expect(
      withKeyLock("test-key-2", async () => {
        throw new Error("the work failed");
      }),
    ).rejects.toThrow("the work failed");
  });

  it("runs the operations of one key in order", async () => {
    const order: string[] = [];
    const first = withKeyLock("test-key-3", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first");
      return 1;
    });
    const second = withKeyLock("test-key-3", async () => {
      order.push("second");
      return 2;
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
