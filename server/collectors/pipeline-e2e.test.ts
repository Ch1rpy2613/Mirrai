import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The whole collection path, end to end.
 *
 * A real Python collector runs, its output comes back through the TypeScript
 * runner, and the messages land in the persona — and then in the transcript
 * the distillation pipeline reads. A collector that produces beautiful JSON
 * but never reaches a persona is not a working collector.
 */

const createCollectedMessage = vi.fn();
const createCollectedMessages = vi.fn();
const getCollectedMessages = vi.fn();
const getCollectedMessageKeys = vi.fn();

vi.mock("../db", () => ({
  createCollectedMessage: (...a: unknown[]) => createCollectedMessage(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  getCollectedMessages: (...a: unknown[]) => getCollectedMessages(...a),
  getCollectedMessageKeys: (...a: unknown[]) => getCollectedMessageKeys(...a),
  getDb: async () => null,
}));

import { runCollector } from "./runner";
import { normaliseCollectorOutput } from "./runner";
import { importCollectedMessages, toTranscript } from "./db-store";
import { ENV } from "../_core/env";

/** A small mail export with two messages. */
function writeMailFixture(dir: string): string {
  const file = path.join(dir, "mail.mbox");
  writeFileSync(
    file,
    [
      "From zhangsan@company.com Mon Jan  1 10:00:00 2024",
      "From: =?utf-8?B?5byg5LiJ?= <zhangsan@company.com>",
      "To: lisi@company.com",
      // A raw UTF-8 subject — technically not RFC 2047, but what Chinese
      // mail clients actually write.
      "Subject: 午饭？",
      "Date: Mon, 01 Jan 2024 11:30:00 +0800",
      "Content-Type: text/plain; charset=\"utf-8\"",
      "",
      "午饭？",
      "",
      "From zhangsan@company.com Mon Jan  1 11:32:00 2024",
      "From: =?utf-8?B?5byg5LiJ?= <zhangsan@company.com>",
      "To: lisi@company.com",
      "Subject: Re: 午饭？",
      "Date: Mon, 01 Jan 2024 11:32:00 +0800",
      "Content-Type: text/plain; charset=\"utf-8\"",
      "",
      "好啊。",
      "",
    ].join("\n"),
    "utf-8",
  );
  return file;
}

describe("collecting a chat history into a persona", () => {
  beforeEach(() => {
    createCollectedMessage.mockReset();
    createCollectedMessages.mockReset();
    getCollectedMessages.mockReset();
    getCollectedMessageKeys.mockReset();
    getCollectedMessageKeys.mockResolvedValue([]);
    getCollectedMessageKeys.mockResolvedValue([]);
    createCollectedMessage.mockResolvedValue(1);
    createCollectedMessages.mockResolvedValue(0);
  });

  it("runs the collector, parses its output and stores the messages", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collect-e2e-"));
    const file = writeMailFixture(dir);

    try {
      // 1. The real Python tool runs through the real runner.
      const progress: number[] = [];
      const { stdout } = await runCollector(
        "email_parser.py",
        ["--file", file, "--target", "zhangsan@company.com", "--format", "json"],
        { onProgress: (pct) => progress.push(pct) },
      );

      // The progress protocol reached the caller.
      expect(progress.length).toBeGreaterThan(0);
      expect(Math.max(...progress)).toBe(100);

      // 2. The output is normalised into the shared contract.
      const result = normaliseCollectorOutput(stdout, "email");
      expect(result.messages.length).toBe(2);
      // A raw UTF-8 subject must survive the round trip. The mail header
      // parser reports such a header with the pseudo-charset
      // "unknown-8bit", which turns every character into U+FFFD.
      expect(result.messages[0].content).toContain("午饭");
      expect(result.messages[0].content).not.toContain("\ufffd");
      expect(result.messages[1].content).toContain("好啊");
      expect(result.meta.source).toBe("email");

      // 3. The messages are stored against the persona.
      const added = await importCollectedMessages({
        personaId: 1,
        userId: 1,
        source: "email",
        messages: result.messages,
      });

      expect(added).toBe(result.messages.length);
      expect(createCollectedMessages).toHaveBeenCalledTimes(1);
      expect(createCollectedMessages.mock.calls[0][0]).toHaveLength(result.messages.length);
      expect(createCollectedMessages.mock.calls[0][0][0]).toMatchObject({
        personaId: 1,
        userId: 1,
        source: "email",
      });

      // 4. The stored messages become the transcript the pipeline reads.
      const transcript = toTranscript(
        result.messages.map((m) => ({ role: m.role, content: m.content })),
      );
      // The mail export only holds the counterpart's side, so every message
      // is the persona's — but the format is the one the pipeline expects.
      // A message body may span several lines, so the count is of the
      // "分身：" prefixes.
      const lines = transcript.split("\n").filter(Boolean);
      expect(lines.filter(line => line.startsWith("分身："))).toHaveLength(2);
      expect(transcript).toContain("午饭");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not store the same message twice", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collect-e2e-"));
    const file = writeMailFixture(dir);

    try {
      const { stdout } = await runCollector(
        "email_parser.py",
        ["--file", file, "--target", "zhangsan@company.com", "--format", "json"],
      );
      const result = normaliseCollectorOutput(stdout, "email");

      await importCollectedMessages({
        personaId: 1,
        userId: 1,
        source: "email",
        messages: result.messages,
      });
      createCollectedMessages.mockClear();

      // The second run finds the rows the first run wrote.
      getCollectedMessageKeys.mockResolvedValue(
        result.messages.map((m, i) => ({
          id: i + 1,
          userId: 1,
          personaId: 1,
          source: "email",
          role: m.role,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp) : null,
          createdAt: new Date(),
        })),
      );

      const addedAgain = await importCollectedMessages({
        personaId: 1,
        userId: 1,
        source: "email",
        messages: result.messages,
      });

      expect(addedAgain).toBe(0);
      expect(createCollectedMessages).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
