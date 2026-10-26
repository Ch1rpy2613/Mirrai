import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { readdir, stat } from "fs/promises";
import { rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { ENV } from "./env";
import { copy } from "@shared/copy";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_ROOT = path.join(UPLOAD_DIR, "tts");
/**
 * The voice used when nobody picks one.
 *
 * It has to be one of the voices the picker offers, or the picker opens
 * on something that is not in it.
 */
export const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;

/** A voice, with its name in both languages. */
export interface TtsVoice {
  /**
   * The identifier the provider knows the voice by.
   *
   * It is never translated: it is a name in the provider's catalogue, and
   * a voice that changes its id is a voice that stops working.
   */
  id: string;
  /** The name of the voice, in the language it is listed in. */
  label: string;
  /** The name of the voice in the other language. */
  labelEn: string;
  /** The language the voice speaks. */
  locale: "zh" | "en";
}

/**
 * The voices the app offers.
 *
 * The voice was hardcoded, so every persona in every language spoke with
 * the same one — and an English user got a Chinese voice reading English
 * words. The voice is part of who somebody is, so it is the user's call.
 *
 * The names are bilingual, because a voice is looked for by name and a
 * name nobody can read is a name nobody can find.
 */
export const TTS_VOICES: TtsVoice[] = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    label: copy("zh", "labels.voice.xiaoxiao"),
    labelEn: copy("en", "labels.voice.xiaoxiao"),
    locale: "zh",
  },
  {
    id: "zh-CN-YunxiNeural",
    label: copy("zh", "labels.voice.yunxi"),
    labelEn: copy("en", "labels.voice.yunxi"),
    locale: "zh",
  },
  {
    id: "zh-CN-XiaoyiNeural",
    label: copy("zh", "labels.voice.xiaoyi"),
    labelEn: copy("en", "labels.voice.xiaoyi"),
    locale: "zh",
  },
  {
    id: "zh-CN-YunyangNeural",
    label: copy("zh", "labels.voice.yunyang"),
    labelEn: copy("en", "labels.voice.yunyang"),
    locale: "zh",
  },
  {
    id: "zh-HK-HiuMaanNeural",
    label: copy("zh", "labels.voice.hiumaan"),
    labelEn: copy("en", "labels.voice.hiumaan"),
    locale: "zh",
  },
  {
    id: "en-US-AriaNeural",
    label: "Aria · female",
    labelEn: "Aria · female",
    locale: "en",
  },
  {
    id: "en-US-GuyNeural",
    label: "Guy · male",
    labelEn: "Guy · male",
    locale: "en",
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia · female (UK)",
    labelEn: "Sonia · female (UK)",
    locale: "en",
  },
  {
    id: "en-US-JennyNeural",
    label: "Jenny · female (warm)",
    labelEn: "Jenny · female (warm)",
    locale: "en",
  },
];

/** A voice, with the name the person choosing it will read. */
export interface LocalisedVoice {
  id: string;
  label: string;
  locale: "zh" | "en";
}

/**
 * The voices that suit a language, named in that language.
 *
 * The picker shows the name the person reading it can read, so the
 * label follows the interface rather than the voice.
 */
export function voicesForLocale(locale: "zh" | "en"): LocalisedVoice[] {
  const matching = TTS_VOICES.filter((voice) => voice.locale === locale);
  const voices = matching.length > 0 ? matching : TTS_VOICES;
  return voices.map((voice) => ({
    id: voice.id,
    label: locale === "en" ? voice.labelEn : voice.label,
    locale: voice.locale,
  }));
}

function getCacheKey(text: string, voice: string): string {
  return createHash("sha256").update(text + voice).digest("hex").slice(0, 16);
}

/**
 * How many clips are kept per user.
 *
 * Every distinct (text, voice) pair writes a new file, and nothing ever
 * deleted one: so the uploads directory grew without bound for the life
 * of the install, and on a small container disk it eventually fills and
 * takes the app down.
 *
 * The oldest are let go when the directory is full. The clips are a
 * cache — the text can always be synthesised again — so losing the
 * oldest is not losing anything.
 */
const MAX_CLIPS_PER_USER = 500;

/**
 * Lets the oldest clips go when the user's directory is full.
 */
async function trimClipCache(dir: string): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".mp3"));
  } catch {
    return;
  }
  if (names.length < MAX_CLIPS_PER_USER) return;

  const withTimes = await Promise.all(
    names.map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));
        return { name, at: info.mtimeMs };
      } catch {
        return { name, at: 0 };
      }
    }),
  );
  withTimes.sort((a, b) => a.at - b.at);

  // The newest half is kept; the rest goes.
  const doomed = withTimes.slice(0, Math.floor(withTimes.length / 2));
  await Promise.all(
    doomed.map((entry) => unlink(path.join(dir, entry.name)).catch(() => undefined)),
  );
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
  // The cache is bounded, so the directory cannot grow for ever.
  await trimClipCache(dir);

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
    entries = await readdir(TTS_ROOT);
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
