import fs from "fs";
import path from "path";
import { ENV } from "./_core/env";

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
  const filePath = path.resolve(ENV.uploadDir, key);
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
  return { key, url: `/uploads/${key}` };
}
