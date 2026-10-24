/**
 * Minimal PNG chunk reader/writer used by the character-card format.
 *
 * A SillyTavern character card is a PNG whose metadata holds the card JSON.
 * Importing or exporting a persona therefore means reading and writing PNG
 * chunks — and nothing else. The pixels must survive untouched, so this
 * module never decodes or re-encodes image data: the original chunk bytes
 * (including IDAT) are copied verbatim and only the metadata chunk is added.
 *
 * No new dependency is introduced on purpose: Node's `zlib` is enough for the
 * compressed text chunks and the CRC-32 needed by the PNG format is a few
 * lines of code.
 */
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inflateSync } from "zlib";

/** The eight-byte PNG file signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The name of the application's own icon, used when a persona has no picture. */
const DEFAULT_ICON_FILE = "icon-512.png";

/** A PNG chunk without its position in the source file. */
export interface PngChunk {
  type: string;
  data: Buffer;
}

/**
 * A chunk plus the byte range it occupied in the source buffer.
 *
 * The offsets let the writer copy the original bytes verbatim, which is how
 * the picture is guaranteed to stay byte-for-byte identical.
 */
interface RawChunk extends PngChunk {
  /** Offset of the chunk's length field inside the source buffer. */
  start: number;
  /** Offset just past the chunk's CRC field inside the source buffer. */
  end: number;
}

/**
 * CRC-32 (IEEE 802.3) as used for PNG chunk checksums.
 *
 * Implemented locally because the project must stay dependency-free; Node's
 * `zlib.crc32` is only available in newer runtimes than the project targets.
 */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Splits a PNG buffer into its chunks.
 *
 * Chunk CRCs are not verified here: a handful of third-party writers emit
 * broken checksums while the pixel data is still perfectly readable, and
 * refusing those files would block imports for no benefit.
 */
function parseChunks(buffer: Buffer): RawChunk[] {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length) {
    throw new Error("Not a PNG file: the buffer is too small to hold a PNG signature");
  }
  if (!buffer.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file: missing PNG signature");
  }

  const chunks: RawChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4; // trailing CRC

    if (end > buffer.length) {
      throw new Error(`Truncated PNG: chunk "${type}" claims ${length} bytes of data`);
    }

    chunks.push({ type, data: buffer.slice(dataStart, dataEnd), start: offset, end });
    offset = end;
    if (type === "IEND") break;
  }

  return chunks;
}

/** Rejects files that are not structurally complete PNGs. */
function assertCompletePng(chunks: RawChunk[]): void {
  const types = chunks.map((chunk) => chunk.type);
  if (types.indexOf("IHDR") === -1) {
    throw new Error("Not a valid PNG: missing IHDR chunk");
  }
  if (types.indexOf("IEND") === -1) {
    throw new Error("Not a valid PNG: missing IEND chunk");
  }
}

/**
 * Decodes PNG text bytes.
 *
 * The specification says `tEXt` holds Latin-1, but most modern writers
 * (SillyTavern included) store UTF-8 in it because the card payload is
 * Chinese text. Decoding as UTF-8 therefore comes first, with a Latin-1
 * fallback for payloads that are not valid UTF-8.
 */
function decodeTextBytes(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  if (utf8.indexOf("\ufffd") === -1) return utf8;
  return bytes.toString("latin1");
}

/** Extracts the keyword of a text chunk, or null when it has none. */
function textChunkKey(data: Buffer): string | null {
  const separator = data.indexOf(0);
  if (separator === -1) return null;
  return data.toString("latin1", 0, separator);
}

/**
 * Parses one metadata chunk into a key/text pair.
 *
 * Supports the three textual chunk flavours:
 *   - `tEXt` — keyword, NUL, text
 *   - `zTXt` — keyword, NUL, compression method, deflated text
 *   - `iTXt` — keyword, NUL, flags, compression method, language, NUL,
 *               translated keyword, NUL, text
 */
function parseTextChunk(type: string, data: Buffer): { key: string; text: string } | null {
  const separator = data.indexOf(0);
  if (separator === -1) return null;

  const key = data.toString("latin1", 0, separator);

  if (type === "tEXt") {
    return { key, text: decodeTextBytes(data.slice(separator + 1)) };
  }

  if (type === "zTXt") {
    const compressionMethod = data[separator + 1];
    if (compressionMethod !== 0) return null; // unknown compression method
    try {
      return { key, text: decodeTextBytes(inflateSync(data.slice(separator + 2))) };
    } catch {
      return null; // a broken chunk must not abort the whole import
    }
  }

  if (type === "iTXt") {
    const compressionFlag = data[separator + 1];
    const compressionMethod = data[separator + 2];
    if (compressionMethod !== 0) return null;

    let cursor = separator + 3;
    const languageEnd = data.indexOf(0, cursor);
    if (languageEnd === -1) return null;
    cursor = languageEnd + 1;

    const translatedEnd = data.indexOf(0, cursor);
    if (translatedEnd === -1) return null;
    cursor = translatedEnd + 1;

    const payload = data.slice(cursor);
    try {
      if (compressionFlag === 1) {
        return { key, text: decodeTextBytes(inflateSync(payload)) };
      }
      return { key, text: payload.toString("utf8") };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Returns every textual chunk of a PNG in file order.
 */
export function readPngTextChunks(buffer: Buffer): Array<{ key: string; text: string }> {
  const chunks = parseChunks(buffer);
  assertCompletePng(chunks);

  const result: Array<{ key: string; text: string }> = [];
  for (const chunk of chunks) {
    if (chunk.type !== "tEXt" && chunk.type !== "zTXt" && chunk.type !== "iTXt") continue;
    const parsed = parseTextChunk(chunk.type, chunk.data);
    if (parsed) result.push(parsed);
  }
  return result;
}

/**
 * Returns every chunk of a PNG in file order.
 */
export function readPngChunks(buffer: Buffer): PngChunk[] {
  const chunks = parseChunks(buffer);
  assertCompletePng(chunks);
  return chunks.map((chunk) => ({ type: chunk.type, data: chunk.data }));
}

/**
 * The candidate paths of the default icon, in the order they are tried.
 *
 * The icon must be found without depending on the working directory: a
 * server started from anywhere but the repository root would otherwise lose
 * the persona's picture. The candidates cover the source layout, the bundled
 * layout and the packaged layout.
 */
export function defaultIconCandidates(options: {
  /** The directory this module lives in; defaults to the module's own. */
  moduleDir?: string;
  /** The working directory; defaults to the process's. */
  cwd?: string;
} = {}): string[] {
  const moduleDir = options.moduleDir ?? path.dirname(fileURLToPath(import.meta.url));
  const cwd = options.cwd ?? process.cwd();

  const inClient = path.join("client", "public", "icons", DEFAULT_ICON_FILE);
  const inDist = path.join("public", "icons", DEFAULT_ICON_FILE);

  return [
    // The source layout: <repo>/server/persona-cards → <repo>/client/public/icons
    path.resolve(moduleDir, "..", "..", inClient),
    // The bundled layout: <repo>/dist/index.js → <repo>/client/public/icons
    path.resolve(moduleDir, "..", inClient),
    // The working directory, for a server started from the repository root.
    path.resolve(cwd, inClient),
    // The packaged layout: <repo>/dist/index.js → <repo>/dist/public/icons
    path.resolve(moduleDir, inDist),
    path.resolve(cwd, "dist", inDist),
  ];
}

/**
 * Finds the default icon, or null when it is nowhere to be found.
 *
 * The caller falls back to a minimal PNG when this returns null, so the
 * export never fails outright.
 */
export function resolveDefaultIconPath(options: {
  /** The directory this module lives in; defaults to the module's own. */
  moduleDir?: string;
  /** The working directory; defaults to the process's. */
  cwd?: string;
} = {}): string | null {
  for (const candidate of defaultIconCandidates(options)) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // An unreadable path is simply not the icon.
    }
  }
  return null;
}

/** Builds a complete PNG chunk (length, type, data, CRC) from scratch. */
function buildChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, checksum]);
}

/**
 * Writes a `tEXt` chunk into a PNG, leaving the picture untouched.
 *
 * Every original chunk is copied byte-for-byte in its original order; the new
 * chunk is inserted just before `IEND`. A pre-existing `tEXt` chunk with the
 * same keyword is replaced, so exporting a card twice never leaves two
 * conflicting copies of the metadata behind.
 */
export function writePngWithTextChunk(buffer: Buffer, key: string, text: string): Buffer {
  const chunks = parseChunks(buffer);
  assertCompletePng(chunks);

  const kept = chunks.filter(
    (chunk) => !(chunk.type === "tEXt" && textChunkKey(chunk.data) === key),
  );

  const payload = Buffer.concat([
    Buffer.from(key, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "utf8"),
  ]);
  const newChunk = buildChunk("tEXt", payload);

  const parts: Buffer[] = [buffer.slice(0, PNG_SIGNATURE.length)];
  for (const chunk of kept) {
    if (chunk.type === "IEND") parts.push(newChunk);
    parts.push(buffer.slice(chunk.start, chunk.end));
  }

  return Buffer.concat(parts);
}
