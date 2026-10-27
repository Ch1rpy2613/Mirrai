import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/**
 * The live verification scripts.
 *
 * They are the only things that run against a real model and a real
 * WeChat account, so when one of them fails, that is the one piece of
 * evidence nobody has. A script that prints the failure and then says
 * goodbye with a success takes that evidence away: the run looks fine
 * and the failure is only in the scrollback, where nobody reads.
 */

function script(name: string): string {
  return readFileSync(path.join(ROOT, "scripts", name), "utf-8");
}

describe("the live scripts and their paths", () => {
  it("all read the paths from the shared configuration", () => {
    /**
     * Some of them rebuilt the paths — so the `MIRRAI_LIVE_*`
     * overrides did not apply to those scripts, and they read a state
     * file and a build the others were not using. Two scripts that are
     * supposed to be looking at the same thing were not.
     */
    const names = readdirSync(path.join(ROOT, "scripts"))
      .filter((name) => name.startsWith("live-") && name.endsWith(".mjs"))
      .filter((name) => name !== "live-config.mjs");
    const rebuild: string[] = [];
    for (const name of names) {
      const source = script(name);
      // The shared configuration is the only place that knows where
      // the state file and the build live.
      if (/process\.cwd\(\)/.test(source)) rebuild.push(name);
    }
    expect(rebuild).toEqual([]);
  });
});

describe("the live scripts that can fail", () => {
  it("say so when the model call fails", () => {
    /**
     * It used to print the error and carry on — so the script said
     * "ERROR" and then said goodbye with a success.
     */
    const source = script("live-llm-check.mjs");
    expect(source).toMatch(/process\.exitCode\s*=\s*1/);
    expect(source).toMatch(/catch/);
  });

  it("say so when the abort test fails", () => {
    /**
     * The three shapes are the point of the script, and their results
     * used to be printed and then thrown away.
     */
    const source = script("live-abort-test.mjs");
    expect(source).toMatch(/process\.exitCode\s*=/);
    // The control is the shape that is known to work — so a failure
    // there means the abort signal is not the cause, and the run has
    // to say so rather than blaming the wrong thing.
    expect(source).toMatch(/if \(!a\)/);
  });

  it("say so when the concurrency test fails", () => {
    /**
     * The single poll is the control: it says whether the connection
     * works at all. If the control failed, nothing was learned about
     * concurrency.
     */
    const source = script("live-concurrency-test.mjs");
    expect(source).toMatch(/process\.exitCode\s*=/);
    expect(source).toMatch(/control/);
  });
});
