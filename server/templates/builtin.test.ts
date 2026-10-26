import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { getBuiltinTemplates } from "./index";

/**
 * The templates that ship with the app.
 *
 * They used to be looked for beside the skill-engine directory, which
 * assumed that `skill-engine/` and `server/` are siblings. The shipped
 * artifacts contain neither — the Docker image copies `dist`,
 * `node_modules` and `drizzle`, and the desktop build copies `dist`,
 * `drizzle` and `package.json`.
 *
 * So the library was empty in the app that people actually install:
 * "try it out with a sandbox character" was impossible, and the
 * template features were dead. And the empty list was cached for ever,
 * and the failure was swallowed, so nothing said why.
 */
describe("the templates that ship with the app", () => {
  it("are found", () => {
    const templates = getBuiltinTemplates();
    expect(templates.length).toBeGreaterThan(0);
  });

  it("are found beside the module, or beside the bundle", () => {
    // The place they will be in the shipped app: the bundle sits in
    // `dist`, and the templates are copied to `server/templates/builtin`
    // beside it.
    const moduleDir = path.resolve(__dirname);
    const besideTheModule = path.join(moduleDir, "builtin");
    const besideTheBundle = path.resolve(moduleDir, "..", "..", "server", "templates", "builtin");
    expect(existsSync(besideTheModule) || existsSync(besideTheBundle)).toBe(true);
  });

  it("all have a name and an id", () => {
    for (const template of getBuiltinTemplates()) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.personaData).toBeTruthy();
    }
  });
});
