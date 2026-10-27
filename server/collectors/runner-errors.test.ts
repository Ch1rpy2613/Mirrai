import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { ENV } from "../_core/env";
import { runCollector } from "./runner";

/**
 * The collector's failure.
 *
 * The collector is a Python script, and when it fails it says so in a
 * traceback — and a traceback says where the tool lives on the
 * operator's machine.
 *
 * That text was shown in the browser word for word, so anybody who
 * could see the screen could see how the operator's machine is laid
 * out. It belongs in the log.
 */
describe("a collector that fails", () => {
  it("does not show the machine's paths to the reader", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-collector-"));
    const tools = path.join(dir, "tools");
    mkdirSync(tools);
    const tool = "failing_collector.py";
    // A tool that fails the way a real one does: a traceback, with the
    // absolute path of the file in it.
    writeFileSync(
      path.join(tools, tool),
      [
        "import sys",
        `print('Traceback (most recent call last):', file=sys.stderr)`,
        `print('  File "${path.join(tools, tool)}", line 1, in <module>', file=sys.stderr)`,
        "print('boom', file=sys.stderr)",
        "sys.exit(1)",
      ].join("\n"),
    );

    const originalPython = ENV.pythonPath;
    const originalDir = ENV.skillEngineDir;
    ENV.pythonPath = "python3";
    ENV.skillEngineDir = dir;

    try {
      const failure = await runCollector(tool, []).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure).toBeTruthy();
      const message = failure!.message;
      expect(message).not.toContain(dir);
      expect(message).not.toContain("Traceback");
      expect(message).not.toContain("boom");
      // And it says something the reader can act on.
      expect(message.length).toBeGreaterThan(0);
    } finally {
      ENV.pythonPath = originalPython;
      ENV.skillEngineDir = originalDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
