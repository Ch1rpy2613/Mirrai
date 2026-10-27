import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanStaleCollectorDirs } from "./types";

/**
 * The temp directories the collectors left behind.
 *
 * A collector removes its own directory when it finishes — but a
 * collector that was killed (the machine slept, the process was
 * stopped, the app was quit) leaves it: the transcript it fetched, the
 * credential file it wrote, the browser profile it made.
 */

describe("the temp directories the collectors left behind", () => {
  it("removes the ones that are certainly nobody's", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mirrai-cleanup-test-"));
    // The directory the collector is using right now.
    const current = path.join(root, "mirrai-collector-current");
    // One left behind by a collector that was killed.
    const stale = path.join(root, "mirrai-collector-stale");
    mkdirSync(current);
    mkdirSync(stale);
    writeFileSync(path.join(stale, "feishu_config.json"), "{}");

    // The stale one is old; the current one is not.
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    const removed = cleanStaleCollectorDirs(current, 60 * 60 * 1000, root);

    expect(removed).toBe(1);
    expect(readdirSync(root).sort()).toEqual(["mirrai-collector-current"]);
  });

  it("leaves the young ones alone — a collector is using them", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mirrai-cleanup-test-"));
    const current = path.join(root, "mirrai-collector-current");
    const running = path.join(root, "mirrai-collector-running");
    mkdirSync(current);
    mkdirSync(running);

    const removed = cleanStaleCollectorDirs(current, 60 * 60 * 1000, root);

    expect(removed).toBe(0);
    expect(readdirSync(root).sort()).toEqual([
      "mirrai-collector-current",
      "mirrai-collector-running",
    ]);
  });

  it("never removes the directory the collector is using right now", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mirrai-cleanup-test-"));
    const current = path.join(root, "mirrai-collector-current");
    mkdirSync(current);

    // It is old, and it is the current one.
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(current, old, old);

    const removed = cleanStaleCollectorDirs(current, 60 * 60 * 1000, root);

    expect(removed).toBe(0);
    expect(statSync(current).isDirectory()).toBe(true);
  });

  it("leaves the directories that are not the collector's alone", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mirrai-cleanup-test-"));
    const other = path.join(root, "someone-elses-directory");
    mkdirSync(other);
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(other, old, old);

    cleanStaleCollectorDirs(path.join(root, "mirrai-collector-current"), 60 * 60 * 1000, root);

    expect(statSync(other).isDirectory()).toBe(true);
  });
});
