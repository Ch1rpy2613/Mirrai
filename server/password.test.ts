import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./_core/password";

describe("hashPassword", () => {
  it("produces a scrypt hash with the expected format", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("salts each hash, so the same password hashes differently", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("never contains the plaintext password", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toContain("hunter2");
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("rejects empty and null hashes without throwing", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("rejects a malformed scrypt hash without throwing", async () => {
    expect(await verifyPassword("pw", "scrypt$1$2$3")).toBe(false);
    expect(await verifyPassword("pw", "scrypt$notanumber$8$1$aabb$ccdd")).toBe(false);
  });

  it("rejects scrypt parameters outside safe bounds", async () => {
    const absurd = `scrypt$99999999$8$1$aabbccdd$${"0".repeat(128)}`;
    expect(await verifyPassword("pw", absurd)).toBe(false);
  });

  it("still verifies legacy sha256 hashes so existing accounts keep working", async () => {
    // Legacy format: salt:sha256hex
    const salt = "abcdef0123456789";
    const { createHash } = await import("crypto");
    const legacy = `${salt}:${createHash("sha256").update("legacy-password" + salt).digest("hex")}`;

    expect(await verifyPassword("legacy-password", legacy)).toBe(true);
    expect(await verifyPassword("not-the-password", legacy)).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags legacy hashes for upgrade", async () => {
    expect(needsRehash("abcd:0123456789abcdef")).toBe(true);
  });

  it("leaves scrypt hashes alone", async () => {
    const hash = await hashPassword("pw");
    expect(needsRehash(hash)).toBe(false);
  });

  it("returns false for empty hashes", () => {
    expect(needsRehash(null)).toBe(false);
    expect(needsRehash(undefined)).toBe(false);
  });
});
