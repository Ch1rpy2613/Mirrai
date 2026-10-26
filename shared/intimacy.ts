/**
 * Intimacy levels, shared by the server and the client.
 *
 * The level is stored as a stable key (`acquainted`, `soulmate`, …) so it can
 * be localised in the UI. The legacy Chinese labels are kept because rows
 * written before the migration still contain them, and because the WeChat
 * command fixtures use them.
 */

export interface IntimacyLevel {
  /** Stable, locale-neutral key — this is what the database stores. */
  key: string;
  /** Chinese label, also the legacy stored value. */
  name: string;
  /** English label. */
  nameEn: string;
  icon: string;
  threshold: number;
}

export const INTIMACY_LEVELS: IntimacyLevel[] = [
  { key: "acquainted", name: "初识", nameEn: "Acquainted", icon: "🌱", threshold: 0 },
  { key: "familiar", name: "熟悉", nameEn: "Familiar", icon: "🌿", threshold: 100 },
  { key: "intimate", name: "亲密", nameEn: "Intimate", icon: "💕", threshold: 300 },
  { key: "confidant", name: "知己", nameEn: "Confidant", icon: "💎", threshold: 600 },
  { key: "soulmate", name: "灵魂伴侣", nameEn: "Soulmate", icon: "👑", threshold: 1000 },
];


/**
 * Normalises any accepted representation of a level to its key.
 *
 * Accepts the key, the Chinese label and the English label, so rows written
 * before the migration keep working.
 */
export function normalizeIntimacyLevel(value: string | null | undefined): string {
  if (!value) return INTIMACY_LEVELS[0].key;
  const trimmed = value.trim();
  const match = INTIMACY_LEVELS.find(
    (l) => l.key === trimmed || l.name === trimmed || l.nameEn === trimmed,
  );
  return match?.key ?? INTIMACY_LEVELS[0].key;
}



/**
 * The label for a stored level, in the language asked for.
 *
 * The exports used to carry their own table of level names, and it had
 * fallen behind: the levels above "familiar" were missing from it, so an
 * export of a close relationship printed the raw key — `soulmate` — where
 * a person expected a name. There is one table now, and it is this one.
 *
 * A level that is in no table at all is printed as it is. Calling it
 * "acquainted" because it was not recognised would be worse than saying
 * nothing useful.
 */
export function intimacyLevelLabel(
  value: string | null | undefined,
  locale: "zh" | "en" = "zh",
): string {
  const trimmed = value?.trim() ?? "";
  const match = INTIMACY_LEVELS.find(
    (l) => l.key === trimmed || l.name === trimmed || l.nameEn === trimmed,
  );
  if (!match) return trimmed;
  return locale === "en" ? match.nameEn : match.name;
}
