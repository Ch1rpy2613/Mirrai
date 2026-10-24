import { describe, expect, it } from "vitest";
import { sanitizeFileName, resolveUploadPath } from "./filename";

describe("sanitizeFileName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFileName("photo.png")).toBe("photo.png");
  });

  it("keeps Chinese characters", () => {
    expect(sanitizeFileName("聊天记录.txt")).toBe("聊天记录.txt");
  });

  it("strips directory syntax", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b/c.txt")).toBe("c.txt");
    expect(sanitizeFileName("a\\b\\c.txt")).toBe("c.txt");
  });

  it("removes characters that are unsafe on some systems", () => {
    expect(sanitizeFileName("a<b>c:d\"e|f?g*h.txt")).not.toMatch(/[<>:"|?*]/);
  });

  it("rejects names that are only dots", () => {
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName(".")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("escapes a leading dot", () => {
    expect(sanitizeFileName(".bashrc")).toBe("bashrc");
  });

  it("limits the length", () => {
    const long = `${"a".repeat(300)}.txt`;
    expect(sanitizeFileName(long).length).toBeLessThanOrEqual(120);
  });

  it("escapes a reserved Windows name", () => {
    expect(sanitizeFileName("con.txt")).toBe("_con.txt");
    expect(sanitizeFileName("nul")).toBe("_nul");
  });

  it("keeps the extension when truncating", () => {
    const long = `${"a".repeat(300)}.txt`;
    expect(sanitizeFileName(long).endsWith(".txt")).toBe(true);
  });
});

describe("resolveUploadPath", () => {
  const root = "/tmp/mirrai-uploads";

  it("resolves a normal key inside the root", () => {
    expect(resolveUploadPath(root, "personas/1/2/a.png")).toBe(`${root}/personas/1/2/a.png`);
  });

  it("strips leading slashes", () => {
    expect(resolveUploadPath(root, "/personas/a.png")).toBe(`${root}/personas/a.png`);
  });

  it("rejects a key that climbs out of the root", () => {
    expect(() => resolveUploadPath(root, "../etc/passwd")).toThrow(/Unsafe storage key/);
    expect(() => resolveUploadPath(root, "personas/../../../../etc/passwd")).toThrow(
      /Unsafe storage key/,
    );
  });

  it("rejects an absolute-looking traversal", () => {
    expect(() => resolveUploadPath(root, "personas/1/2/../../../../tmp/x")).toThrow(
      /Unsafe storage key/,
    );
  });

  it("allows a path that stays inside", () => {
    expect(resolveUploadPath(root, "personas/1/../2/a.png")).toBe(`${root}/personas/2/a.png`);
  });
});
