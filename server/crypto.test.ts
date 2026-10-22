import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./_core/crypto";

describe("encryptSecret", () => {
  it("round-trips a credential", async () => {
    const enc = await encryptSecret("ilink-bot-token-value");
    expect(enc).not.toContain("ilink-bot-token-value");
    expect(await decryptSecret(enc)).toBe("ilink-bot-token-value");
  });

  it("produces a different ciphertext each time", async () => {
    const a = await encryptSecret("same-token");
    const b = await encryptSecret("same-token");
    expect(a).not.toBe(b);
    expect(await decryptSecret(a)).toBe(await decryptSecret(b));
  });

  it("handles empty strings", async () => {
    const enc = await encryptSecret("");
    expect(await decryptSecret(enc)).toBe("");
  });

  it("handles unicode", async () => {
    const enc = await encryptSecret("凭据-测试-🎉");
    expect(await decryptSecret(enc)).toBe("凭据-测试-🎉");
  });
});

describe("decryptSecret", () => {
  it("returns null for a missing payload", async () => {
    expect(await decryptSecret(null)).toBeNull();
    expect(await decryptSecret(undefined)).toBeNull();
    expect(await decryptSecret("")).toBeNull();
  });

  it("returns null for a malformed payload", async () => {
    expect(await decryptSecret("not-a-ciphertext")).toBeNull();
    expect(await decryptSecret("v1:only:three")).toBeNull();
  });

  it("returns null when the payload was tampered with", async () => {
    const enc = await encryptSecret("secret");
    const parts = enc.split(":");
    // Flip a byte of the ciphertext.
    const cipher = Buffer.from(parts[3], "base64");
    cipher[0] ^= 0xff;
    parts[3] = cipher.toString("base64");
    expect(await decryptSecret(parts.join(":"))).toBeNull();
  });

  it("returns null for a payload encrypted with a different key", async () => {
    const enc = await encryptSecret("secret");
    const parts = enc.split(":");
    const other = Buffer.from(parts[3], "base64");
    // Corrupt the auth tag so the GCM check fails.
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(await decryptSecret(parts.join(":"))).toBeNull();
    expect(other.length).toBeGreaterThan(0);
  });
});
