import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * What the user is told about a collection.
 *
 * Three ways it used to be wrong:
 *
 * - a collector that stopped at its own limit said nothing, and the
 *   server reported the run as complete;
 * - a collector whose output went past the cap had its JSON cut in the
 *   middle of an object, and the code fell back to the Markdown
 *   report — which keeps only a few hundred of the messages — and
 *   imported that as a complete collection;
 * - a collector that found nothing wrote the reason to its standard
 *   error, and the connectors that read their output straight from the
 *   standard output threw it away — so the job settled as "completed"
 *   with zero messages and no explanation.
 */

const ROOT = path.resolve(__dirname, "../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

describe("the connectors", () => {
  const types = read("server/collectors/types.ts");

  it("ask for the name the tool needs", () => {
    /**
     * The tools need it — without it, they exit with code 2 and print
     * nothing useful. So the user saw "the collector
     * feishu_auto_collector.py did not finish (exit code 2)": an
     * internal file name and an exit code, with no hint that a name
     * was what was missing.
     */
    const needsTarget = types.match(/errors\.collectorNeedsTarget/g) ?? [];
    // The mail export, the WeChat export, Feishu, DingTalk and Slack.
    expect(needsTarget.length).toBeGreaterThanOrEqual(5);
  });

  it("keep the reason a collector gave when it found nothing", () => {
    // The reason is written to the standard error, and it was dropped.
    expect(types).toMatch(/noteFromStderr/);
    // And it is attached to an empty result.
    expect(types).toMatch(/withEmptyNote/);
  });

  it("say when the output was cut short", () => {
    /**
     * The flag was dropped here — so when a collector's output went
     * past the cap, the JSON was cut in the middle of an object, the
     * payload could not be parsed, and the code fell back to the
     * Markdown report — which keeps only a few hundred of the
     * messages.
     */
    expect(types).toMatch(/stdoutTruncated/);
  });
});

describe("the job report", () => {
  const jobs = read("server/collectors/jobs.ts");

  it("counts what was written, not what was fetched", () => {
    /**
     * It was the count the collector returned — which is not the same
     * thing. The import is idempotent, so collecting the same history
     * twice writes nothing the second time — and the job still said
     * "500 messages". So the user was told 500 messages had been
     * collected into their persona, and their persona had gained
     * nothing.
     */
    expect(jobs).toMatch(/job\.messageCount = added/);
  });
});
