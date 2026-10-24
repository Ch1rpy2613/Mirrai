import fs from "fs";
import path from "path";
import { ENV } from "./_core/env";
import { resolveUploadPath } from "./_core/filename";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = relKey.replace(/^\/+/, "");
  // Rejects any key that would escape the uploads directory.
  const filePath = resolveUploadPath(ENV.uploadDir, key);
  ensureDir(path.dirname(filePath));

  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  await fs.promises.writeFile(filePath, buffer);

  const url = `/uploads/${key}`;
  return { key, url };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = relKey.replace(/^\/+/, "");
  // Validates the key even though nothing is read from disk here.
  resolveUploadPath(ENV.uploadDir, key);
  return { key, url: `/uploads/${key}` };
}

/**
 * Resolves an upload URL to an absolute path on disk, or null when the path
 * is not inside the uploads directory.
 */
export function resolveStoredPath(relKey: string): string | null {
  try {
    return resolveUploadPath(ENV.uploadDir, relKey.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}
