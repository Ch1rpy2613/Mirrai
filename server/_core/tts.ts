import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { rename, writeFile } from "fs/promises";
import path from "path";
import { ENV } from "./env";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_ROOT = path.join(UPLOAD_DIR, "tts");
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;

function getCacheKey(text: string, voice: string): string {
  return createHash("sha256").update(text + voice).digest("hex").slice(0, 16);
}

/**
 * Synthesises text to speech and returns the URL of the stored audio.
 *
 * Audio is scoped per user (`tts/<userId>/<hash>.mp3`) so that one user's
 * conversation cannot be addressed by another user's URL.
 */
export async function generateTTS(
  text: string,
  voice: string = DEFAULT_VOICE,
  userId?: number,
): Promise<string> {
  const trimmed = text.slice(0, MAX_TEXT_LENGTH);
  const hash = getCacheKey(trimmed, voice);
  const scope = userId != null ? String(userId) : "shared";
  const fileName = `${hash}.mp3`;
  const dir = path.join(TTS_ROOT, scope);
  const filePath = path.join(dir, fileName);
  const urlPath = `/uploads/tts/${scope}/${fileName}`;

  if (existsSync(filePath)) return urlPath;

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { tts } = await import("edge-tts");
  const audioBuffer = await tts(trimmed, { voice });
  await writeFile(filePath, audioBuffer);

  return urlPath;
}

/**
 * Moves pre-per-user TTS files into `tts/legacy/`.
 *
 * Older versions wrote every clip to `tts/<hash>.mp3`, where the URL was
 * guessable by anyone who knew it. The files are kept so existing chat
 * history still plays, but they are marked as legacy and are reported so the
 * operator can rotate them.
 */
export async function migrateLegacyTTSFiles(): Promise<number> {
  if (!existsSync(TTS_ROOT)) return 0;
  const legacyDir = path.join(TTS_ROOT, "legacy");

  let entries: string[];
  try {
    entries = readdirSync(TTS_ROOT);
  } catch {
    return 0;
  }

  const movable = entries.filter(
    (entry) => entry.endsWith(".mp3") && entry !== "legacy",
  );
  if (movable.length === 0) return 0;

  if (!existsSync(legacyDir)) mkdirSync(legacyDir, { recursive: true });

  let moved = 0;
  for (const entry of movable) {
    try {
      await rename(path.join(TTS_ROOT, entry), path.join(legacyDir, entry));
      moved++;
    } catch {
      // A failed move must not stop the server from booting.
    }
  }
  if (moved > 0) {
    console.warn(
      `[TTS] Moved ${moved} pre-scoped audio file(s) to tts/legacy/. ` +
        "Those clips were previously reachable by a guessable URL — rotate them if that matters to you.",
    );
  }
  return moved;
}
