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

/** The key of the highest level. */
export const TOP_INTIMACY_KEY = "soulmate";

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

/** The Chinese label for a stored level (legacy value or key). */
export function intimacyLevelName(value: string | null | undefined): string {
  if (!value) return INTIMACY_LEVELS[0].name;
  const match = INTIMACY_LEVELS.find(
    (l) => l.key === value.trim() || l.name === value.trim() || l.nameEn === value.trim(),
  );
  return match?.name ?? INTIMACY_LEVELS[0].name;
}

/** The icon for a stored level. */
export function intimacyLevelIcon(value: string | null | undefined): string {
  if (!value) return INTIMACY_LEVELS[0].icon;
  const match = INTIMACY_LEVELS.find(
    (l) => l.key === value.trim() || l.name === value.trim() || l.nameEn === value.trim(),
  );
  return match?.icon ?? INTIMACY_LEVELS[0].icon;
}
