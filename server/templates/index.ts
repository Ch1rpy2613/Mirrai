/**
 * The template library.
 *
 * Built-in templates ship with the app as JSON files; a user's own templates
 * live in the database. Both are served through the same interface.
 */
import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { normalizeTemplate, type PersonaTemplate } from "./schema";

function builtinDir(): string {
  return path.resolve(ENV.skillEngineDir, "..", "server", "templates", "builtin");
}

let cachedBuiltins: PersonaTemplate[] | null = null;

/**
 * Loads the templates that ship with the app.
 *
 * A broken template file is skipped rather than breaking the library.
 */
export function getBuiltinTemplates(): PersonaTemplate[] {
  if (cachedBuiltins) return cachedBuiltins;

  const templates: PersonaTemplate[] = [];
  const dir = builtinDir();

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        templates.push(normalizeTemplate(raw));
      } catch (e) {
        console.warn(`[Templates] Skipping ${file}:`, e);
      }
    }
  } catch {
    // No built-in templates installed — the user's own templates still work.
  }

  cachedBuiltins = templates;
  return templates;
}
