import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";

/**
 * The prompt registry.
 *
 * `skill-engine/prompts/registry.json` is the single source of truth for
 * which prompt file serves which stage. Before it existed, the TypeScript
 * loader and the Python presets each described the same mapping separately
 * and had drifted apart.
 */
export interface PromptRegistry {
  version: number;
  description?: string;
  /**
   * The quality thresholds of the research profiles.
   *
   * They live here so that the TypeScript side and the Python side read the
   * same numbers — the Python preset loader reads this file too.
   */
  qualityThresholds?: Record<string, Record<string, number>>;
  families: Record<
    string,
    {
      description?: string;
      stages: Record<string, string>;
      profiles?: Record<string, { description?: string; stages: Record<string, string> }>;
    }
  >;
}

let cachedRegistry: PromptRegistry | null = null;

function registryPath(): string {
  return path.resolve(ENV.skillEngineDir, "prompts", "registry.json");
}

export function loadRegistry(): PromptRegistry | null {
  if (cachedRegistry) return cachedRegistry;
  const file = registryPath();
  if (!fs.existsSync(file)) return null;
  try {
    cachedRegistry = JSON.parse(fs.readFileSync(file, "utf-8")) as PromptRegistry;
    return cachedRegistry;
  } catch (e) {
    console.warn(`[SkillEngine] Could not read ${file}:`, e);
    return null;
  }
}

/**
 * Loads a prompt for a stage.
 *
 * Resolution order:
 *   1. the family's profile (when a profile is given),
 *   2. the family,
 *   3. the shared "root" family,
 *   4. the conventional path `prompts/<family>/<stage>.md`,
 *   5. `prompts/<stage>.md`.
 */
export function loadPrompt(
  family: string,
  stage: string,
  profile?: string | null,
): string {
  const registry = loadRegistry();

  if (registry) {
    const familyEntry = registry.families[family];

    if (familyEntry && profile) {
      const profileEntry = familyEntry.profiles?.[profile];
      const mapped = profileEntry?.stages?.[stage];
      if (mapped) {
        const file = path.resolve(ENV.skillEngineDir, "prompts", mapped);
        if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
      }
    }

    const familyMapped = familyEntry?.stages?.[stage];
    if (familyMapped) {
      const file = path.resolve(ENV.skillEngineDir, "prompts", familyMapped);
      if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
    }

    const rootMapped = registry.families.root?.stages?.[stage];
    if (rootMapped) {
      const file = path.resolve(ENV.skillEngineDir, "prompts", rootMapped);
      if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
    }
  }

  // Fall back to the conventional layout when the registry has no entry.
  const familyPath = path.resolve(ENV.skillEngineDir, "prompts", family, `${stage}.md`);
  if (fs.existsSync(familyPath)) return fs.readFileSync(familyPath, "utf-8");

  const rootPath = path.resolve(ENV.skillEngineDir, "prompts", `${stage}.md`);
  if (fs.existsSync(rootPath)) return fs.readFileSync(rootPath, "utf-8");

  throw new Error(`Prompt not found: ${family}${profile ? `/${profile}` : ""}/${stage}`);
}
