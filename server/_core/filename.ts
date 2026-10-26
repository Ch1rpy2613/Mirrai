/**
 * File name and storage key sanitisation.
 *
 * Uploaded file names arrive from the client, and they are interpolated into
 * the path used to write the file. Without sanitising them a name like
 * `x/../../../../etc/passwd` escapes the uploads directory, so every name is
 * reduced to a single safe path segment before it is used.
 */
import path from "path";
import { copy } from "@shared/copy";

/** Control characters plus the punctuation that is unsafe on at least one OS. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** Names that are reserved on Windows. */
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const MAX_NAME_LENGTH = 120;

/**
 * The extensions each kind of upload may carry.
 *
 * The uploads directory is served from the app's own origin, so an uploaded
 * `.html` file would run as a page on that origin. Only the kinds the app
 * actually reads are allowed.
 */
export const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  chat_txt: [".txt"],
  chat_csv: [".csv"],
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif"],
  video: [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"],
  audio: [".webm", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".mp4", ".amr"],
  // Collected material keeps whatever the source produced.
  collected: [],
};

/** The extension of a file name, lower-cased, including the dot. */
export function fileExtension(name: string): string {
  const ext = path.extname(String(name ?? "")).toLowerCase();
  return ext;
}

/**
 * Checks a file name against the allow-list for its kind.
 *
 * Returns null when the name is acceptable, or a message explaining why it
 * is not.
 */
export function checkFileExtension(
  fileName: string,
  fileType: string,
  locale: "zh" | "en" = "zh",
): string | null {
  const allowed = ALLOWED_EXTENSIONS[fileType];
  // An unknown kind is not allowed to carry any extension at all.
  if (!allowed) return copy(locale, "errors.fileTypeNotSupported", { type: fileType });
  if (allowed.length === 0) return null;

  const ext = fileExtension(fileName);
  if (!ext) {
    return copy(locale, "errors.fileMissingExtension", { allowed: allowed.join(" / ") });
  }
  if (!allowed.includes(ext)) {
    return copy(locale, "errors.fileExtensionNotSupported", {
      ext,
      allowed: allowed.join(" / "),
    });
  }
  return null;
}

/**
 * Reduces an arbitrary client-supplied name to a single safe path segment.
 *
 * Returns a non-empty name; falls back to `"file"` when nothing usable is
 * left.
 */
export function sanitizeFileName(original: string): string {
  let name = String(original ?? "");

  // Keep only the last path component, then strip any directory syntax.
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(UNSAFE_CHARS, "_");
  name = name.replace(/\.+/g, ".");
  name = name.replace(/^\.+/, "");
  name = name.trim();

  if (name.length > MAX_NAME_LENGTH) {
    const ext = path.extname(name).slice(0, 16);
    const stem = path
      .basename(name, path.extname(name))
      .slice(0, MAX_NAME_LENGTH - ext.length);
    name = stem + ext;
  }

  if (!name || name === "." || name === "..") return "file";

  const stem = name.split(".")[0]?.toLowerCase() ?? "";
  if (RESERVED_NAMES.has(stem)) name = `_${name}`;

  return name;
}

/**
 * Resolves a storage key against the uploads root and guarantees the result
 * stays inside it.
 *
 * Throws when the key would escape — the caller must never write outside the
 * uploads directory.
 */
export function resolveUploadPath(uploadRoot: string, relKey: string): string {
  const root = path.resolve(uploadRoot);
  const key = String(relKey ?? "").replace(/^\/+/, "");
  const resolved = path.resolve(root, key);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Unsafe storage key rejected: ${relKey}`);
  }
  return resolved;
}
