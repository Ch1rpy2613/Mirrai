import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { ENV } from "./env";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_DIR = path.join(UPLOAD_DIR, "tts");
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;

function getCacheKey(text: string, voice: string): string {
  return createHash("sha256").update(text + voice).digest("hex").slice(0, 16);
}

export async function generateTTS(
  text: string,
  voice: string = DEFAULT_VOICE,
): Promise<string> {
  const trimmed = text.slice(0, MAX_TEXT_LENGTH);
  const hash = getCacheKey(trimmed, voice);
  const fileName = `${hash}.mp3`;
  const filePath = path.join(TTS_DIR, fileName);
  const urlPath = `/uploads/tts/${fileName}`;

  if (existsSync(filePath)) return urlPath;

  if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

  const { tts } = await import("edge-tts");
  const audioBuffer = await tts(trimmed, { voice });
  await writeFile(filePath, audioBuffer);

  return urlPath;
}
