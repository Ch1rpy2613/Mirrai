import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Removing a stored file.
 *
 * The rows were deleted and the bytes were not: so deleting a persona
 * — or an account — left the uploaded photographs and the extracted
 * files on the disk, in the uploads directory, under the user's own
 * id. Nothing ever read them again and nothing ever cleaned them up.
 */

const originalUploadDir = process.env.UPLOAD_DIR;

describe("the stored files", () => {
  let dir = "";
  let uploads: string[] = [];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-uploads-"));
    process.env.UPLOAD_DIR = dir;
    uploads = [];
    // The environment is read when the module is loaded, so it is set
    // before the module is imported — which happens on the first call
    // below.
    vi.resetModules();
  });

  afterEach(() => {
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("removes a file that is there", async () => {
    const { storagePut, storageDelete } = await import("./storage");
    const { url } = await storagePut("personas/1/2/a.png", Buffer.from("x"));
    const file = path.join(dir, "personas", "1", "2", "a.png");
    expect(fs.existsSync(file)).toBe(true);

    const removed = await storageDelete(url.replace("/uploads/", ""));

    expect(removed).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("does not fail over a file that is already gone", async () => {
    const { storageDelete } = await import("./storage");
    expect(await storageDelete("personas/1/2/nothing.png")).toBe(false);
  });

  it("does not remove a file outside the uploads directory", async () => {
    const { storageDelete } = await import("./storage");
    const outside = path.join(dir, "..", "mirrai-outside.txt");
    fs.writeFileSync(outside, "x");
    try {
      expect(await storageDelete("../mirrai-outside.txt")).toBe(false);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
