import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The page the browser is shown when the app is not there.
 *
 * It was English only — and the app is not. The service worker cannot
 * read the app's own language setting, but it does know the browser's
 * language, and that is what the person is reading.
 */

const ROOT = path.resolve(__dirname, "..");

describe("the offline page", () => {
  it("speaks the reader's language", () => {
    const source = readFileSync(path.join(ROOT, "client/public/sw.js"), "utf-8");

    // Both languages are there.
    expect(source).toContain("离线");
    expect(source).toContain("Offline");
    // And the choice is made from the browser's own language.
    expect(source).toContain("navigator");
  });

  it("says the app's name, not the page's", () => {
    const source = readFileSync(path.join(ROOT, "client/public/sw.js"), "utf-8");
    // The English page said "This page needs the app to be running" —
    // and the app has a name.
    expect(source).toContain("Mirrai");
  });
});

describe("the manifest", () => {
  it("speaks both languages", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "client/public/manifest.webmanifest"), "utf-8"),
    );
    // The description and the shortcut names were Chinese only — so an
    // English user's home screen said so.
    expect(manifest.description).toContain("/");
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.name).toContain("/");
      expect(shortcut.description).toContain("/");
    }
  });
});
