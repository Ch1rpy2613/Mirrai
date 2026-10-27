import { describe, expect, it } from "vitest";
import { parseNormalisedPayload } from "./runner";

/**
 * Whether the collection was cut short.
 *
 * Every collector has a limit of its own — a thousand messages for
 * Feishu, five hundred for DingTalk — and the limit is the collector's,
 * not the server's. The server only passes `--msg-limit` when the user
 * typed one, so usually the collector stopped at *its* limit and said
 * nothing about it.
 *
 * And the payload it returned claimed to be everything: no collector
 * set `meta.truncated`. So the server reported `truncated: false`, the
 * interface showed no warning, and the persona was distilled from a
 * tenth of the history — with the interface saying the collection was
 * complete.
 */

/** A payload in the shape the collectors write. */
function payload(messages: unknown[], meta: Record<string, unknown>) {
  return JSON.stringify({
    messages,
    meta: { source: "feishu", ...meta },
  });
}

/** A message in the shape the collectors write. */
function message(id: number, content = "你好") {
  return {
    role: "assistant",
    content,
    timestamp: "2026-03-14T10:00:00Z",
    source: "feishu",
    id,
  };
}

describe("a collection the collector stopped short", () => {
  it("is reported as cut short", () => {
    const result = parseNormalisedPayload(
      payload([message(1), message(2)], { total: 2, truncated: true }),
      "feishu",
    );

    /**
     * The collector knows it stopped at its own limit.
     *
     * The server could not see that: the limit was the collector's, and
     * the payload said it was everything. So the collection was
     * reported as complete, and the persona was distilled from a tenth
     * of the history with nothing said about it.
     */
    expect(result?.meta.truncated).toBe(true);
  });

  it("says how many were found, when it knows", () => {
    const result = parseNormalisedPayload(
      payload([message(1), message(2)], { total: 500, truncated: true }),
      "feishu",
    );

    /**
     * The count that was found.
     *
     * It was the count that was *kept* — so the interface said "found
     * 1000 in total, this time only some of them were taken", a
     * sentence that contradicts itself, because the two numbers were
     * the same number.
     */
    expect(result?.meta.total).toBe(500);
  });
});

describe("a collection that was not cut short", () => {
  it("is not reported as cut short", () => {
    const result = parseNormalisedPayload(
      payload([message(1), message(2)], { total: 2, truncated: false }),
      "feishu",
    );
    expect(result?.meta.truncated).toBe(false);
  });

  it("is not reported as cut short when there are exactly as many as the limit", () => {
    // The server's own limit cut a list it already had — so exactly as
    // many as the limit is not a cut at all.
    const result = parseNormalisedPayload(
      payload([message(1), message(2)], { total: 2, truncated: false }),
      "feishu",
      { limit: 2 },
    );
    expect(result?.meta.truncated).toBe(false);
  });

  it("is reported as cut short when the server's own limit cut the list", () => {
    const result = parseNormalisedPayload(
      payload([message(1), message(2), message(3)], { total: 3, truncated: false }),
      "feishu",
      { limit: 2 },
    );
    expect(result?.meta.truncated).toBe(true);
    expect(result?.messages).toHaveLength(2);
    // And the count that was found is the one that was found, not the
    // one that was kept.
    expect(result?.meta.total).toBe(3);
  });
});
