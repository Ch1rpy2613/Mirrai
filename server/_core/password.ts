/**
 * Password hashing.
 *
 * Uses scrypt (Node built-in) with a per-password random salt. Legacy accounts
 * created before the scrypt migration stored `salt:sha256hex`; those are still
 * verified so existing users keep their accounts, and transparently upgraded to
 * scrypt on the next successful login.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP-aligned scrypt parameters: N=2^14, r=8, p=1. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** scrypt needs 128 * N * r bytes; 64 MiB leaves headroom above the 16 MiB floor. */
const MAX_MEM = 64 * 1024 * 1024;

const SCRYPT_PREFIX = "scrypt";

/** Normalizes unicode so visually identical passwords hash identically. */
function normalize(password: string): string {
  return password.normalize("NFKC");
}

/** Hashes a password into `scrypt$N$r$p$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(normalize(password), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
  return [
    SCRYPT_PREFIX,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/** Legacy `salt:sha256hex` verification, kept for accounts predating scrypt. */
function verifyLegacySha256(password: string, stored: string): boolean {
  const separator = stored.indexOf(":");
  if (separator <= 0) return false;

  const salt = stored.slice(0, separator);
  const expectedHex = stored.slice(separator + 1);
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) return false;

  const actual = createHash("sha256").update(password + salt).digest("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a password against a stored hash in either scrypt or legacy format.
 * Returns false for malformed or missing hashes instead of throwing.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  if (!stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    return verifyLegacySha256(password, stored);
  }

  const parts = stored.split("$");
  if (parts.length !== 6) return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Guard against absurd parameters from a corrupted or tampered row.
  if (N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(normalize(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** True when the stored hash uses the legacy format and should be upgraded. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return !stored.startsWith(`${SCRYPT_PREFIX}$`);
}
