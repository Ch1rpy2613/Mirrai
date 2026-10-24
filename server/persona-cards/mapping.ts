/**
 * Mapping between a Mirrai persona and a SillyTavern character card.
 *
 * The card format is a flat, human-readable document, while a Mirrai persona
 * is a set of distilled fields (性格 / 说话方式 / 依恋类型 / 记忆 …). This
 * module translates between the two without pulling in any dependency: the
 * translation is a pure function of the persona data.
 *
 * Two things are worth knowing about the design:
 *
 * 1. Every human-readable field is written as `标签：内容` lines so a card can
 *    be read (and re-imported) without the Mirrai extension.
 * 2. The exact persona data is mirrored into `data.extensions.mirrai`, which
 *    keeps the round trip lossless while the readable fields stay meaningful
 *    for other tools.
 */
import type { PersonaData } from "../_core/persona-schema";
import { normalizePersonaData } from "../_core/persona-schema";
import type { CharacterBookEntry, CharacterCardV2, CharacterCardV2Data } from "./card";

/** A memory of the persona, as used to build the card's lore book. */
export interface PersonaCardMemory {
  /** The memory text. */
  content: string;
  /** Anchor memories are always injected into the prompt. */
  anchor?: boolean;
  /** Trigger keywords for ordinary memories. */
  keys?: string[];
  /** Short title, used as the entry name. */
  name?: string;
}

/** Everything the export needs to know about a persona. */
export interface PersonaCardExportArgs {
  /** Persona display name. */
  name: string;
  /** Relationship description, e.g. "前女友". */
  relationshipDesc?: string;
  /** Start of the relationship period. */
  togetherFrom?: string;
  /** End of the relationship period; empty while the relationship continues. */
  togetherTo?: string;
  /** The distilled persona fields. */
  personaData: PersonaData;
  /** The system prompt the server builds for this persona. */
  systemPrompt?: string;
  /** Opening line, used as the card's first message. */
  firstMessage?: string;
  /** Further opening lines. */
  alternateGreetings?: string[];
  /**
   * The opening lines of the persona's scene.
   *
   * When a scene carries starters, the first one becomes the card's
   * `first_mes` and the rest become its `alternate_greetings` — the persona's
   * own scene is what the card should open with, not a generic line.
   */
  sceneStarters?: string[];
  /** Intimacy level (key or label), used for the derived tags. */
  intimacyLevel?: string;
  /** Structured memories; falls back to `personaData.memories`. */
  memories?: PersonaCardMemory[];
  /** Creator tag written into the card. */
  creator?: string;
  /** Version of the character itself, not of the card format. */
  characterVersion?: string;
}

/** The Mirrai-specific part of a card, mirrored for a lossless round trip. */
interface MirraiExtension {
  format: string;
  version: number;
  persona?: PersonaData;
  relationshipDesc?: string;
  togetherFrom?: string;
  togetherTo?: string;
  intimacyLevel?: string;
  firstMessage?: string;
}

/** Everything the import can recover from a card. */
export interface PersonaCardImport {
  name: string;
  relationshipDesc: string;
  togetherFrom: string;
  togetherTo: string;
  personaData: Partial<PersonaData>;
}

/** Key under which the Mirrai extension lives inside `data.extensions`. */
const MIRRAI_EXTENSION_KEY = "mirrai";

/** Labels used in the human-readable fields, so they can be parsed back. */
const DESCRIPTION_LABELS = {
  personality: "性格",
  attachmentStyle: "依恋类型",
  loveLanguage: "爱的语言",
  conflictStyle: "争吵方式",
} as const;

const MES_EXAMPLE_LABELS = {
  speakingStyle: "说话方式",
  catchphrases: "常用语气词",
  nickname: "称呼对方",
} as const;

/**
 * Disclosure line appended to the creator notes.
 *
 * The product's ethics rules (see `docs/product-concept.md`) require AI
 * transparency and the consent of the person being modelled, and the card
 * may travel to third-party tools — so the notes have to carry that
 * disclosure with them.
 */
const AI_DISCLOSURE_LINE =
  "本卡片是 AI 数字分身的模拟角色，并非真人本人。请在获得被模拟者知情同意的前提下使用，并尊重 TA 的隐私与意愿。";

/** Reads a string field, tolerating a missing card payload. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Returns the first value that actually holds something. */
function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Reads a persona field as plain text, joining arrays when necessary. */
function personaText(persona: PersonaData, key: keyof PersonaData): string {
  const value = persona[key];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : String(item ?? ""))).join("、");
  }
  return typeof value === "string" ? value.trim() : "";
}

/** Joins `标签：内容` pairs, skipping the ones without content. */
function joinLabelled(pairs: Array<[string, string]>): string {
  return pairs
    .filter((pair) => pair[1].trim().length > 0)
    .map((pair) => `${pair[0]}：${pair[1].trim()}`)
    .join("\n");
}

/** Parses `标签：内容` lines back into a label/value map. */
function parseLabelled(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("：");
    if (separator === -1) continue;
    const label = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (label && value) result[label] = value;
  }
  return result;
}

/** Builds the scenario line: the relationship plus the period it lasted. */
function buildScenario(
  relationshipDesc: string | undefined,
  togetherFrom: string | undefined,
  togetherTo: string | undefined,
): string {
  const desc = (relationshipDesc ?? "").trim();
  const from = (togetherFrom ?? "").trim();
  const to = (togetherTo ?? "").trim();
  const period = from && to ? `（${from} 至 ${to}）` : from ? `（${from} 起）` : "";
  return [desc, period].filter(Boolean).join("\n");
}

/** Recovers the relationship and the period from the scenario field. */
function parseScenario(scenario: string): {
  relationshipDesc: string;
  togetherFrom: string;
  togetherTo: string;
} {
  let relationshipDesc = "";
  let togetherFrom = "";
  let togetherTo = "";

  for (const line of scenario.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const period = /^（(.+?)(?:\s*(至|到|—|~|起)\s*(.*?))?）$/.exec(trimmed);
    if (period) {
      togetherFrom = period[1].trim();
      togetherTo = (period[3] ?? "").trim();
    } else if (!relationshipDesc) {
      relationshipDesc = trimmed;
    }
  }

  return { relationshipDesc, togetherFrom, togetherTo };
}

/** Splits a delimited list such as "嗯嗯、好呀". */
function splitList(value: string): string[] {
  return value
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Collects the memories of a persona, falling back to the summary blob. */
function collectMemories(args: PersonaCardExportArgs): PersonaCardMemory[] {
  if (args.memories && args.memories.length > 0) {
    return args.memories.filter((memory) => memory.content.trim().length > 0);
  }
  const blob = personaText(args.personaData, "memories");
  if (!blob) return [];
  return blob
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ content: line }));
}

/** Builds the lore book entries: anchors are constant, memories are keyed. */
function buildBookEntries(memories: PersonaCardMemory[]): CharacterBookEntry[] {
  return memories.map((memory) => {
    const content = memory.content.trim();
    const keys = memory.keys && memory.keys.length > 0
      ? memory.keys.map((key) => key.trim()).filter(Boolean)
      : memory.name
        ? splitList(memory.name)
        : [];
    const entry: CharacterBookEntry = {
      name: memory.name ?? content.slice(0, 20),
      keys,
      content,
      enabled: true,
      constant: memory.anchor === true,
      position: "before_char",
    };
    if (memory.anchor === true) {
      entry.extensions = { mirrai: { anchor: true } };
    }
    return entry;
  });
}

/** Reads the Mirrai extension out of a card, if it is present. */
function readMirraiExtension(card: CharacterCardV2): MirraiExtension | null {
  const extensions = card.data.extensions ?? {};
  const raw = extensions[MIRRAI_EXTENSION_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as MirraiExtension;
}

/** The opening lines of a card: its first message and its alternates. */
export interface CardOpeningLines {
  /** The card's `first_mes`. */
  firstMessage: string;
  /** The card's `alternate_greetings`. */
  alternateGreetings: string[];
}

/**
 * Picks the opening lines of a card.
 *
 * A scene's starters are the persona's own opening lines: the first one opens
 * the conversation, the rest are alternatives the user can pick from. A
 * persona without a scene falls back to the lines the caller supplies.
 */
export function resolveCardOpeningLines(input: {
  /** The starters of the scene the card is exported from. */
  sceneStarters?: readonly string[] | null;
  /** The fallback first message. */
  firstMessage?: string;
  /** The fallback alternate greetings. */
  alternateGreetings?: readonly string[];
}): CardOpeningLines {
  const starters = (input.sceneStarters ?? [])
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter((line) => line.length > 0);

  if (starters.length > 0) {
    return { firstMessage: starters[0], alternateGreetings: starters.slice(1) };
  }

  return {
    firstMessage: (input.firstMessage ?? "").trim(),
    alternateGreetings: (input.alternateGreetings ?? [])
      .map((line) => (typeof line === "string" ? line.trim() : ""))
      .filter((line) => line.length > 0),
  };
}

/**
 * Turns a Mirrai persona into a V2 character card.
 */
export function personaDataToCard(args: PersonaCardExportArgs): CharacterCardV2 {
  const persona = args.personaData;

  const description = joinLabelled([
    [DESCRIPTION_LABELS.personality, personaText(persona, "personality")],
    [DESCRIPTION_LABELS.attachmentStyle, personaText(persona, "attachmentStyle")],
    [DESCRIPTION_LABELS.loveLanguage, personaText(persona, "loveLanguage")],
    [DESCRIPTION_LABELS.conflictStyle, personaText(persona, "conflictStyle")],
  ]);

  const mesExample = joinLabelled([
    [MES_EXAMPLE_LABELS.speakingStyle, personaText(persona, "speakingStyle")],
    [MES_EXAMPLE_LABELS.catchphrases, personaText(persona, "catchphrases")],
    [MES_EXAMPLE_LABELS.nickname, personaText(persona, "nickname")],
  ]);

  const memories = collectMemories(args);
  const anchorCount = memories.filter((memory) => memory.anchor === true).length;

  const opening = resolveCardOpeningLines({
    sceneStarters: args.sceneStarters,
    firstMessage: args.firstMessage,
    alternateGreetings: args.alternateGreetings,
  });

  const tags: string[] = [];
  for (const tag of [
    "AI模拟",
    (args.relationshipDesc ?? "").trim(),
    (args.intimacyLevel ?? "").trim(),
    `锚点${anchorCount}`,
  ]) {
    if (tag && tags.indexOf(tag) === -1) tags.push(tag);
  }

  const relationshipDesc = (args.relationshipDesc ?? "").trim();
  const creatorNotes = [relationshipDesc, AI_DISCLOSURE_LINE].filter(Boolean).join("\n\n");

  const extension: MirraiExtension = {
    format: "mirrai-persona-card",
    version: 1,
    persona,
    relationshipDesc,
    togetherFrom: (args.togetherFrom ?? "").trim(),
    togetherTo: (args.togetherTo ?? "").trim(),
    intimacyLevel: (args.intimacyLevel ?? "").trim(),
    firstMessage: opening.firstMessage,
  };

  const data: CharacterCardV2Data = {
    name: args.name,
    description,
    personality: personaText(persona, "personality"),
    scenario: buildScenario(args.relationshipDesc, args.togetherFrom, args.togetherTo),
    first_mes: opening.firstMessage,
    mes_example: mesExample,
    creator_notes: creatorNotes,
    system_prompt: (args.systemPrompt ?? "").trim(),
    post_history_instructions: "",
    alternate_greetings: opening.alternateGreetings,
    tags,
    creator: (args.creator ?? "Mirrai").trim() || "Mirrai",
    character_version: (args.characterVersion ?? "1.0").trim() || "1.0",
    extensions: { [MIRRAI_EXTENSION_KEY]: extension },
    character_book: {
      entries: buildBookEntries(memories),
      name: `${args.name}的记忆`,
    },
  };

  return { spec: "chara_card_v2", spec_version: "2.0", data };
}

/**
 * Turns a character card back into persona fields.
 *
 * The Mirrai extension is used when present, because it holds the original
 * values; otherwise the human-readable fields are parsed. Fields without
 * content are left out so the caller can fill the defaults.
 */
export function cardToPersonaData(card: CharacterCardV2): Partial<PersonaData> {
  const data = card.data ?? ({} as CharacterCardV2Data);
  const extension = readMirraiExtension(card);
  const mirrored = extension?.persona;

  const description = parseLabelled(asText(data.description));
  const mesExample = parseLabelled(asText(data.mes_example));

  const result: Partial<PersonaData> = {};

  const personality = firstText(
    mirrored?.personality,
    data.personality,
    description[DESCRIPTION_LABELS.personality],
  );
  if (personality) result.personality = personality;

  const speakingStyle = firstText(
    mirrored?.speakingStyle,
    mesExample[MES_EXAMPLE_LABELS.speakingStyle],
  );
  if (speakingStyle) result.speakingStyle = speakingStyle;

  const mirroredCatchphrases = mirrored && Array.isArray(mirrored.catchphrases)
    ? mirrored.catchphrases
    : [];
  const catchphrases = mirroredCatchphrases.length
    ? mirroredCatchphrases
    : splitList(mesExample[MES_EXAMPLE_LABELS.catchphrases] ?? "");
  if (catchphrases.length) result.catchphrases = catchphrases;

  const nickname = firstText(mirrored?.nickname, mesExample[MES_EXAMPLE_LABELS.nickname]);
  if (nickname) result.nickname = nickname;

  const attachmentStyle = firstText(
    mirrored?.attachmentStyle,
    description[DESCRIPTION_LABELS.attachmentStyle],
  );
  if (attachmentStyle) result.attachmentStyle = attachmentStyle;

  const loveLanguage = firstText(
    mirrored?.loveLanguage,
    description[DESCRIPTION_LABELS.loveLanguage],
  );
  if (loveLanguage) result.loveLanguage = loveLanguage;

  const conflictStyle = firstText(
    mirrored?.conflictStyle,
    description[DESCRIPTION_LABELS.conflictStyle],
  );
  if (conflictStyle) result.conflictStyle = conflictStyle;

  const touchingMoments = (mirrored?.touchingMoments ?? "").trim();
  if (touchingMoments) result.touchingMoments = touchingMoments;

  const summary = (mirrored?.summary ?? "").trim();
  if (summary) result.summary = summary;

  const mirroredMemories = (mirrored?.memories ?? "").trim();
  if (mirroredMemories) {
    result.memories = mirroredMemories;
  } else if (data.character_book && data.character_book.entries.length > 0) {
    const contents = data.character_book.entries
      .map((entry) => entry.content.trim())
      .filter(Boolean);
    if (contents.length) result.memories = contents.join("\n");
  }

  return result;
}

/**
 * Recovers everything a persona needs from a card, including the fields
 * that are not part of `PersonaData`.
 */
export function cardToPersonaImport(card: CharacterCardV2): PersonaCardImport {
  const extension = readMirraiExtension(card);
  const scenario = parseScenario(asText(card.data?.scenario));

  const relationshipDesc = (extension?.relationshipDesc ?? "").trim() || scenario.relationshipDesc;
  const togetherFrom = (extension?.togetherFrom ?? "").trim() || scenario.togetherFrom;
  const togetherTo = (extension?.togetherTo ?? "").trim() || scenario.togetherTo;

  return {
    name: asText(card.data?.name),
    relationshipDesc,
    togetherFrom,
    togetherTo,
    personaData: cardToPersonaData(card),
  };
}

/**
 * Recovers a complete persona from a card, filling the defaults with the
 * same normaliser the distillation pipeline uses.
 */
export function cardToNormalizedPersona(card: CharacterCardV2): PersonaData {
  const imported = cardToPersonaImport(card);
  return normalizePersonaData(imported.personaData as unknown as Record<string, unknown>, {
    name: imported.name || "TA",
    fallback: {
      personality: imported.personaData.personality,
      speakingStyle: imported.personaData.speakingStyle,
      catchphrases: imported.personaData.catchphrases,
      nickname: imported.personaData.nickname,
      memories: imported.personaData.memories,
      attachmentStyle: imported.personaData.attachmentStyle,
      loveLanguage: imported.personaData.loveLanguage,
      conflictStyle: imported.personaData.conflictStyle,
      touchingMoments: imported.personaData.touchingMoments,
      summary: imported.personaData.summary,
    },
  });
}
