/**
 * The SillyTavern "Character Card V2" contract.
 *
 * A character card is a JSON document with a fixed envelope:
 *
 * ```json
 * { "spec": "chara_card_v2", "spec_version": "2.0", "data": { ... } }
 * ```
 *
 * Cards travel inside a PNG's `tEXt` chunk under the keyword `chara`, encoded
 * as base64. The legacy V1 format used the keyword `base64` and stored a flat
 * object with `char_*` field names, so both flavours are accepted on import.
 */
import { readPngTextChunks, writePngWithTextChunk } from "./png";

/** A single entry of the card's lore book (the "character book"). */
export interface CharacterBookEntry {
  name?: string;
  keys: string[];
  content: string;
  enabled?: boolean;
  constant?: boolean;
  position?: string;
  extensions?: Record<string, unknown>;
}

/** The payload of a V2 card. */
export interface CharacterCardV2Data {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  character_book?: {
    entries: CharacterBookEntry[];
    name?: string;
  };
}

/** A complete V2 character card. */
export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: CharacterCardV2Data;
}

/** The keyword SillyTavern uses for the card payload. */
export const CARD_TEXT_KEY = "chara";

/** The keyword used by the legacy V1 format. */
export const LEGACY_CARD_TEXT_KEY = "base64";

/** Reads a string field, tolerating missing or wrongly typed values. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reads a string-array field, tolerating a single string or a missing value. */
function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** Reads a plain object field, tolerating a missing value. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Normalises lore book entries so downstream code can rely on their shape. */
function asBookEntries(value: unknown): CharacterBookEntry[] {
  const raw = asRecord(value);
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  return entries.map((entry) => {
    const record = asRecord(entry);
    return {
      name: asText(record.name),
      keys: asStringList(record.keys),
      content: asText(record.content),
      enabled: record.enabled !== false,
      constant: record.constant === true,
      position: asText(record.position) || "before_char",
      extensions: asRecord(record.extensions),
    };
  });
}

/**
 * Fills in every field of the card payload so the result always satisfies the
 * declared type, even when the card came from a lenient third-party writer.
 */
function normalizeCardData(data: Record<string, unknown>): CharacterCardV2Data {
  const normalized: CharacterCardV2Data = {
    name: asText(data.name),
    description: asText(data.description),
    personality: asText(data.personality),
    scenario: asText(data.scenario),
    first_mes: asText(data.first_mes),
    mes_example: asText(data.mes_example),
    creator_notes: asText(data.creator_notes),
    system_prompt: asText(data.system_prompt),
    post_history_instructions: asText(data.post_history_instructions),
    alternate_greetings: asStringList(data.alternate_greetings),
    tags: asStringList(data.tags),
    creator: asText(data.creator),
    character_version: asText(data.character_version),
    extensions: asRecord(data.extensions),
  };

  const book = asRecord(data.character_book);
  if (Object.keys(book).length > 0) {
    normalized.character_book = {
      entries: asBookEntries(book),
      name: asText(book.name),
    };
  }

  return normalized;
}

/**
 * Parses the JSON payload of a card chunk.
 *
 * The payload is normally base64-encoded JSON, but some tools store plain
 * JSON, so both are accepted.
 */
function parseCardPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Character card payload is empty");

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Character card payload is not valid JSON: ${(error as Error).message}`);
    }
  }

  let decoded: string;
  try {
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    throw new Error("Character card payload is not valid base64");
  }
  try {
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`Character card payload is not valid JSON: ${(error as Error).message}`);
  }
}

/** Checks the card envelope and rejects anything that is not a V2 card. */
function toCharacterCardV2(parsed: unknown): CharacterCardV2 {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Character card payload must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const spec = record.spec;
  if (spec !== "chara_card_v2") {
    throw new Error(
      `Unsupported character card spec: ${JSON.stringify(spec ?? null)} (expected "chara_card_v2")`,
    );
  }

  const specVersion = record.spec_version;
  if (specVersion !== "2.0") {
    throw new Error(
      `Unsupported character card spec_version: ${JSON.stringify(specVersion ?? null)} (expected "2.0")`,
    );
  }

  const data = record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Character card payload is missing the `data` object");
  }

  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: normalizeCardData(data as Record<string, unknown>),
  };
}

/**
 * Picks the first non-empty string out of several possible field names.
 *
 * The legacy format used `char_*` names where V2 uses plain names, so both
 * spellings are checked.
 */
function pickText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Maps a legacy flat card onto the V2 shape.
 *
 * Legacy cards have no envelope: the fields sit at the top level and use the
 * `char_*` spelling for some entries.
 */
function mapLegacyCard(parsed: unknown): CharacterCardV2 {
  const record = asRecord(parsed);
  const book = asRecord(record.character_book);

  const data: CharacterCardV2Data = {
    name: pickText(record, "char_name", "name"),
    description: pickText(record, "description"),
    personality: pickText(record, "char_personality", "personality"),
    scenario: pickText(record, "scenario"),
    first_mes: pickText(record, "char_greeting", "first_mes", "first_greeting"),
    mes_example: pickText(record, "mes_example"),
    creator_notes: pickText(record, "creator_notes"),
    system_prompt: pickText(record, "system_prompt"),
    post_history_instructions: pickText(record, "post_history_instructions"),
    alternate_greetings: asStringList(record.alternate_greetings),
    tags: asStringList(record.tags),
    creator: pickText(record, "creator"),
    character_version: pickText(record, "character_version"),
    extensions: asRecord(record.extensions),
  };

  const entries = asBookEntries(book);
  if (entries.length > 0 || Object.keys(book).length > 0) {
    data.character_book = { entries, name: asText(book.name) };
  }

  return { spec: "chara_card_v2", spec_version: "2.0", data };
}

/** True when a payload looks like a flat legacy card rather than a V2 card. */
function looksLikeLegacyCard(parsed: unknown): boolean {
  const record = asRecord(parsed);
  if (record.spec) return false;
  return Boolean(record.name || record.char_name || record.personality || record.char_personality);
}

/**
 * Encodes a card as the base64 payload stored in the PNG metadata.
 */
export function serializeCard(card: CharacterCardV2): string {
  return Buffer.from(JSON.stringify(card), "utf8").toString("base64");
}

/**
 * Decodes and validates a base64 card payload.
 *
 * @throws when the payload is not base64, not JSON, or not a V2 card.
 */
export function deserializeCard(base64: string): CharacterCardV2 {
  return toCharacterCardV2(parseCardPayload(base64));
}

/**
 * Reads the character card embedded in a PNG.
 *
 * The V2 `chara` chunk is preferred. When it is missing, the legacy `base64`
 * chunk is read instead and mapped onto the V2 shape; a `chara` chunk that
 * holds a flat legacy object is mapped as well, because plenty of V1 cards in
 * the wild were written that way.
 *
 * @throws when the PNG carries no card at all.
 */
export function readCardFromPng(buffer: Buffer): CharacterCardV2 {
  const textChunks = readPngTextChunks(buffer);

  const modern = textChunks.find((chunk) => chunk.key === CARD_TEXT_KEY);
  if (modern) {
    const parsed = parseCardPayload(modern.text);
    if (looksLikeLegacyCard(parsed)) return mapLegacyCard(parsed);
    return toCharacterCardV2(parsed);
  }

  const legacy = textChunks.find((chunk) => chunk.key === LEGACY_CARD_TEXT_KEY);
  if (legacy) {
    const parsed = parseCardPayload(legacy.text);
    if (looksLikeLegacyCard(parsed)) return mapLegacyCard(parsed);
    return toCharacterCardV2(parsed);
  }

  throw new Error(
    `PNG does not contain a character card: no "${CARD_TEXT_KEY}" or "${LEGACY_CARD_TEXT_KEY}" text chunk found`,
  );
}

/**
 * Writes a character card into a PNG, leaving the picture untouched.
 */
export function writeCardToPng(imageBuffer: Buffer, card: CharacterCardV2): Buffer {
  return writePngWithTextChunk(imageBuffer, CARD_TEXT_KEY, serializeCard(card));
}
