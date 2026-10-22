/**
 * Symmetric encryption for long-lived credentials (currently the Weixin iLink
 * bot token, which is equivalent to a WeChat login session).
 *
 * The key is derived from `JWT_SECRET` via scrypt, so no extra secret needs to
 * be configured, and rotating `JWT_SECRET` invalidates stored tokens (the
 * user simply re-scans).
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "crypto";
import { promisify } from "util";

import { ENV } from "./env";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Prefix marking an encrypted payload, so plaintext is never mistaken for ciphertext. */
const PREFIX = "v1";

let cachedKey: Buffer | null = null;

/** Derives (and caches) the encryption key from JWT_SECRET. */
async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  // A fixed salt is intentional: the derived key must be stable across
  // restarts so previously stored credentials stay readable.
  const salt = Buffer.from("mirrai-credential-encryption", "utf-8");
  cachedKey = await scrypt(ENV.cookieSecret, salt, KEY_LENGTH);
  return cachedKey;
}

/**
 * Encrypts a credential string.
 * Returns `v1:<iv>:<authTag>:<ciphertext>` (all base64).
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a credential produced by `encryptSecret`.
 * Returns null when the payload is malformed or the key does not match —
 * callers treat that as "credentials need to be re-established".
 */
export async function decryptSecret(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const key = await getKey();
    const iv = Buffer.from(parts[1], "base64");
    const authTag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf-8");
  } catch {
    return null;
  }
}
