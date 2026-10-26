import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * What the packaged app has to carry.
 *
 * The distillation reads its prompts from disk at run time, and the
 * collectors run Python scripts out of the skill-engine directory.
 * Neither was ever copied into the Docker image, the macOS bundle or
 * the Windows bundle — so in the app people download, every
 * distillation stage failed with "Prompt not found" and the collectors
 * were spawned in a directory that did not exist.
 *
 * The migration runner had the same problem: the desktop start scripts
 * run it out of the bundle, and it was not there.
 */
const ROOT = path.resolve(__dirname, "..");

const PACKAGES = [
  {
    name: "the Docker image",
    file: "Dockerfile",
    mustCarry: ["skill-engine", "server/templates/builtin", "scripts/migrate.mjs"],
  },
  {
    name: "the macOS bundle",
    file: "scripts/build-macos-app.sh",
    mustCarry: ["skill-engine", "server/templates/builtin", "scripts/migrate.mjs"],
  },
  {
    name: "the Windows bundle",
    file: "scripts/build-windows-app.ps1",
    mustCarry: ["skill-engine", "server\\templates\\builtin", "scripts\\migrate.mjs"],
  },
];

describe("the packaged app", () => {
  for (const pack of PACKAGES) {
    describe(pack.name, () => {
      const source = readFileSync(path.join(ROOT, pack.file), "utf-8");

      for (const item of pack.mustCarry) {
        it(`carries ${item}`, () => {
          // The path has to be there with the separators the script uses.
          const normalised = source.replace(/\//g, "\\").replace(/\\\\/g, "\\");
          expect(normalised).toContain(item.replace(/\//g, "\\"));
        });
      }
    });
  }
});
