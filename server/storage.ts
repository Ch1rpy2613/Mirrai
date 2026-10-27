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

/**
 * Removes a stored file.
 *
 * The rows were deleted and the bytes were not: so deleting a persona
 * — or an account — left the uploaded photographs and the extracted
 * files on the disk, in the uploads directory, under the user's own
 * id. Nothing ever read them again and nothing ever cleaned them up.
 *
 * The key is validated the same way it is on the way in, so this can
 * only ever remove a file inside the uploads directory.
 *
 * A file that is already gone is not an error: the point is that it is
 * not there.
 */
export async function storageDelete(relKey: string): Promise<boolean> {
  const key = relKey.replace(/^\/+/, "");
  let filePath: string;
  try {
    filePath = resolveUploadPath(ENV.uploadDir, key);
  } catch {
    // A key that would escape the uploads directory is not ours to
    // remove.
    return false;
  }
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
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

/**
 * The kind of a file, from its name.
 *
 * Only the kinds the app actually stores; anything else is left to the
 * caller.
 */
function mimeOf(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "heic": return "image/heic";
    case "svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

/**
 * The bytes of a stored file, as a `data:` URL.
 *
 * The media URL that is stored is a *path* — `/uploads/chat/1/2/x.png` —
 * and a path with no host is not a URL any model can fetch. So the
 * picture was handed to the provider as a relative path: the API
 * answered "Invalid image URL" and the turn failed, and against a local
 * model the picture was dropped and the persona answered as if it had
 * seen nothing.
 *
 * The bytes are inlined instead. It works the same for every provider,
 * it needs no public hostname — a self-hosted app on a LAN has none —
 * and it keeps the picture out of the open internet.
 */
export async function storageToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  // Already something the provider can use.
  if (url.startsWith("data:")) return url;
  if (/^https?:\/\//i.test(url)) return url;

  // The stored form is `/uploads/<key>`; the key is what is on disk.
  const key = url.startsWith("/uploads/")
    ? url.slice("/uploads/".length)
    : url.replace(/^\/+/, "");
  const filePath = resolveStoredPath(key);
  if (!filePath) return null;
  try {
    const bytes = await fs.promises.readFile(filePath);
    if (bytes.length === 0) return null;
    return `data:${mimeOf(filePath)};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
