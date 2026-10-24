import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "./_core/env";
import { sanitizeFileName } from "./_core/filename";
import { storageGet, storagePut } from "./storage";

/** Lists every file below `dir`, relative to `dir`. */
function listFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listFiles(path.join(dir, entry.name), relative));
    else found.push(relative);
  }
  return found;
}

describe("storage", () => {
  let tmpDir: string;
  /** A sibling of the uploads root, used to prove nothing escapes into it. */
  let outsideDir: string;
  let previousUploadDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-storage-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-storage-outside-"));
    previousUploadDir = ENV.uploadDir;
    ENV.uploadDir = tmpDir;
  });

  afterEach(() => {
    ENV.uploadDir = previousUploadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("storagePut", () => {
    it("writes a normal key inside the uploads directory", async () => {
      const result = await storagePut("personas/7/3/photo.png", "hello");

      expect(result.key).toBe("personas/7/3/photo.png");
      expect(result.url).toBe("/uploads/personas/7/3/photo.png");

      const written = path.join(tmpDir, "personas", "7", "3", "photo.png");
      expect(fs.existsSync(written)).toBe(true);
      expect(fs.readFileSync(written, "utf8")).toBe("hello");
      expect(path.resolve(written).startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
    });

    it("normalises a key with a leading slash", async () => {
      const result = await storagePut("/personas/7/3/photo.png", "hello");

      expect(result.key).toBe("personas/7/3/photo.png");
      expect(result.url).toBe("/uploads/personas/7/3/photo.png");
      expect(fs.existsSync(path.join(tmpDir, "personas", "7", "3", "photo.png"))).toBe(true);
    });

    it("rejects a key that climbs out of the uploads root", async () => {
      // Resolves to <outsideDir>/pwned.txt — outside the uploads root.
      const escapeKey = `x/../../${path.basename(outsideDir)}/pwned.txt`;

      await expect(storagePut(escapeKey, "pwned")).rejects.toThrow(/rejected/i);

      expect(fs.existsSync(path.join(outsideDir, "pwned.txt"))).toBe(false);
      // Nothing was written anywhere inside the uploads root either.
      expect(listFiles(tmpDir)).toEqual([]);
    });

    it("rejects a traversal that starts from a nested path", async () => {
      // Four ".." climb out of personas/7/3 and past the uploads root.
      const escapeKey = `personas/7/3/../../../../${path.basename(outsideDir)}/pwned.txt`;

      await expect(storagePut(escapeKey, "pwned")).rejects.toThrow(/rejected/i);

      expect(fs.existsSync(path.join(outsideDir, "pwned.txt"))).toBe(false);
      expect(listFiles(tmpDir)).toEqual([]);
    });

    it("rejects a key that resolves to the parent of the uploads root", async () => {
      await expect(storagePut("../escaped.txt", "pwned")).rejects.toThrow(/rejected/i);
      expect(fs.existsSync(path.join(path.dirname(tmpDir), "escaped.txt"))).toBe(false);
    });
  });

  describe("storageGet", () => {
    it("returns the key and url for a valid key", async () => {
      const result = await storageGet("personas/7/3/photo.png");

      expect(result.key).toBe("personas/7/3/photo.png");
      expect(result.url).toBe("/uploads/personas/7/3/photo.png");
      // Nothing is read from disk, so nothing is created either.
      expect(listFiles(tmpDir)).toEqual([]);
    });

    it("rejects a key that climbs out of the uploads root", async () => {
      await expect(storageGet("x/../../../../etc/passwd")).rejects.toThrow(/rejected/i);
      await expect(storageGet("../../etc/passwd")).rejects.toThrow(/rejected/i);
    });
  });
});

describe("sanitizeFileName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFileName("photo.png")).toBe("photo.png");
  });

  it("strips directory syntax", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b/c.txt")).toBe("c.txt");
    expect(sanitizeFileName("a\\b\\c.txt")).toBe("c.txt");
  });

  it("rejects a name that is only dots", () => {
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName("../..")).toBe("file");
    expect(sanitizeFileName(".")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("caps the length", () => {
    const long = `${"a".repeat(300)}.txt`;
    const sanitized = sanitizeFileName(long);
    expect(sanitized.length).toBeLessThanOrEqual(120);
    expect(sanitized.endsWith(".txt")).toBe(true);
  });

  it("escapes a reserved Windows name", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("con.txt")).toBe("_con.txt");
    expect(sanitizeFileName("nul")).toBe("_nul");
  });

  it("replaces characters that are unsafe on some systems", () => {
    expect(sanitizeFileName("a<b>c:d\"e|f?g*h.txt")).not.toMatch(/[<>:"|?*]/);
  });
});
