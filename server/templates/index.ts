/**
 * The template library.
 *
 * Built-in templates ship with the app as JSON files; a user's own templates
 * live in the database. Both are served through the same interface.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ENV } from "../_core/env";
import { normalizeTemplate, type PersonaTemplate } from "./schema";

/**
 * Where the templates that ship with the app live.
 *
 * It used to be resolved from the skill-engine directory — which
 * assumed that `skill-engine/` and `server/` are siblings. The shipped
 * artifacts contain neither: the Docker image copies `dist`,
 * `node_modules` and `drizzle`, and the desktop build copies `dist`,
 * `drizzle` and `package.json`. So the library was empty in the app
 * that people actually install, and the empty list was cached for ever.
 *
 * The directory is now looked for beside the module, beside the
 * bundle, and in the working directory — the same way the app looks
 * for its icons.
 */
function builtinDirs(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const inServer = path.join("server", "templates", "builtin");
  const inDist = path.join("templates", "builtin");

  return [
    // The source layout: <repo>/server/templates → <repo>/server/templates/builtin
    path.resolve(moduleDir, "builtin"),
    // The bundled layout: <repo>/dist/index.js → <repo>/server/templates/builtin
    path.resolve(moduleDir, "..", "..", inServer),
    // The packaged layout: <app>/dist/index.js → <app>/server/templates/builtin
    //
    // The Docker image and the desktop bundle both put the templates
    // beside the bundle's own folder. It was found only because the
    // server happened to be started from that folder — and a systemd
    // unit, or a `docker run -w`, would have had an empty template
    // library.
    path.resolve(moduleDir, "..", inServer),
    // The working directory, for a server started from the repository root.
    path.resolve(cwd, inServer),
    // A packaged layout that ships the directory beside the bundle.
    path.resolve(moduleDir, "..", inDist),
    path.resolve(cwd, "dist", inDist),
    // And the layout the skill-engine directory implies, for an install
    // that puts them side by side.
    path.resolve(ENV.skillEngineDir, "..", inServer),
  ];
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

  for (const dir of builtinDirs()) {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      // Not this one — try the next.
      continue;
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        templates.push(normalizeTemplate(raw));
      } catch (e) {
        console.warn(`[Templates] Skipping ${file}:`, e);
      }
    }
    // The first directory that has templates in it is the one.
    if (templates.length > 0) break;
  }

  if (templates.length === 0) {
    // The library was silently empty, and the empty list was cached for
    // ever: "try it out with a sandbox character" was impossible and the
    // template features were dead in the shipped app.
    console.warn(
      "[Templates] No built-in templates were found. The library is empty.",
    );
  }

  cachedBuiltins = templates;
  return templates;
}
