import { describe, expect, it } from "vitest";
import { extractFrames, parseFrame, isStreamingUnsupported } from "./chat-stream";

describe("SSE frame handling", () => {
  it("splits complete frames and keeps the trailing partial frame", () => {
    const buffer = 'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\nevent: del';
    const { frames, rest } = extractFrames(buffer);

    expect(frames).toHaveLength(2);
    expect(rest).toBe("event: del");
  });

  it("handles a frame that arrives split across chunks", () => {
    const first = extractFrames('event: delta\ndata: {"text":"hel');
    expect(first.frames).toHaveLength(0);
    expect(first.rest).toBe('event: delta\ndata: {"text":"hel');

    const second = extractFrames(first.rest + 'lo"}\n\n');
    expect(second.frames).toHaveLength(1);
  });

  it("parses the event name and JSON payload", () => {
    const parsed = parseFrame('event: delta\ndata: {"text":"你好"}');
    expect(parsed?.event).toBe("delta");
    expect(parsed?.data).toEqual({ text: "你好" });
  });

  it("reads the emotion event", () => {
    const parsed = parseFrame('event: emotion\ndata: {"state":"warm","reason":"放松"}');
    expect(parsed?.event).toBe("emotion");
    expect((parsed?.data as any).state).toBe("warm");
  });

  it("ignores comment lines", () => {
    const parsed = parseFrame(': keep-alive\nevent: delta\ndata: {"text":"x"}');
    expect(parsed?.event).toBe("delta");
  });

  it("falls back to the raw payload when the data is not JSON", () => {
    const parsed = parseFrame("event: error\ndata: oops");
    expect(parsed?.event).toBe("error");
    expect(parsed?.data).toBe("oops");
  });

  it("returns null for a frame with no data", () => {
    expect(parseFrame("event: delta")).toBeNull();
  });
});

describe("streaming support detection", () => {
  it("treats 404 and 501 as an unsupported server", () => {
    expect(isStreamingUnsupported(404)).toBe(true);
    expect(isStreamingUnsupported(501)).toBe(true);
  });

  it("treats other statuses as a real error", () => {
    expect(isStreamingUnsupported(500)).toBe(false);
    expect(isStreamingUnsupported(429)).toBe(false);
  });
});
