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
 *
 * And the tools need an interpreter: the Docker image had none, so the
 * tools it shipped could never run. The only symptom was a line in the
 * log.
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

/**
 * The source without its comments.
 *
 * The check used to look for a path anywhere in the file — so a path
 * that was only mentioned in a comment passed. And a comment is
 * exactly where a path that is *not* copied ends up.
 */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) return false;
      if (trimmed.startsWith("//")) return false;
      if (trimmed.startsWith("<#")) return false;
      return true;
    })
    .join("\n");
}

/** The path, with the separators the script uses. */
function normalise(value: string): string {
  return value.replace(/\//g, "\\");
}

describe("the packaged app", () => {
  for (const pack of PACKAGES) {
    describe(pack.name, () => {
      const source = readFileSync(path.join(ROOT, pack.file), "utf-8");
      const code = withoutComments(source);

      for (const item of pack.mustCarry) {
        it(`carries ${item}`, () => {
          // The path has to be there with the separators the script uses —
          // and in the code, not only in a comment.
          expect(normalise(code)).toContain(normalise(item));
        });
      }
    });
  }

  it("gives the tools an interpreter in the Docker image", () => {
    // The tools are Python scripts. They were shipped, and there was no
    // Python to run them with: every distillation failed at the "write
    // the skill package" step, every collector failed to start, and the
    // celebrity research flow was skipped — with nothing but a line in
    // the log to say so.
    const dockerfile = readFileSync(path.join(ROOT, "Dockerfile"), "utf-8");
    expect(dockerfile).toMatch(/apk add[^\n]*\bpython3\b/);
  });

  it("gives the tools an interpreter on the desktop", () => {
    // The desktop builds rely on the operating system's Python. It may
    // be missing — so the failure has to say what is missing.
    const runner = readFileSync(path.join(ROOT, "server/skill-engine/runner.ts"), "utf-8");
    expect(runner).toContain("pythonIsAvailable");
    // And it says what is missing — without the path of the
    // interpreter, which used to travel to the browser.
    expect(runner).toMatch(/Python.*is not available/);
    expect(runner).not.toMatch(/Python.*not available at \"/);
  });

  it("runs the app on the Node the app asks for", () => {
    // The image ran Node twenty while the package says the app needs
    // twenty-four — so the image ran the app on a Node the app says it
    // does not support, and `pnpm install` refused the image's own
    // engine whenever the check was turned on.
    const docker = readFileSync(path.join(ROOT, "Dockerfile"), "utf-8");
    const packageJson = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf-8"),
    ) as { engines?: { node?: string } };
    const wanted = (packageJson.engines?.node ?? "").replace(/[^0-9.]/g, "");
    expect(wanted).not.toBe("");
    const used = [...docker.matchAll(/^FROM node:([0-9.]+)/gm)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const version of used) {
      expect(version.startsWith(wanted.split(".")[0])).toBe(true);
    }
  });

  it("gives up on a database that never comes up", () => {
    // The wait had no limit — so a database that never came up left
    // the container starting for ever, saying "waiting for database"
    // and never saying why.
    const docker = readFileSync(path.join(ROOT, "scripts/docker-entrypoint.sh"), "utf-8");
    expect(docker).toMatch(/attempt/);
    expect(docker).toMatch(/exit 1/);
  });

  it("type checks the build's own configuration", () => {
    // The build's configuration was not checked at all — so a change
    // to the aliases, the bundler or the migration setup could break
    // the build without anything saying so until the build ran.
    const tsconfig = JSON.parse(
      readFileSync(path.join(ROOT, "tsconfig.json"), "utf-8")
        // The file carries comments, which JSON does not allow.
        .replace(/^\s*\/\*\*[\s\S]*?\*\//gm, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    ) as { include?: string[] };
    for (const file of ["vite.config.ts", "vitest.config.ts", "drizzle.config.ts"]) {
      expect(tsconfig.include ?? []).toContain(file);
    }
  });

  it("stops when the schema cannot be synchronised", () => {
    // `push` applies the difference between the schema and the live
    // database — so a failure means the two still disagree, and the app
    // would start on a half-synced schema.
    const macos = readFileSync(path.join(ROOT, "scripts/macos/start.sh"), "utf-8");
    expect(macos).toMatch(/push --force[\s\S]{0,400}exit 1/);

    const windows = readFileSync(path.join(ROOT, "scripts/windows/start.ps1"), "utf-8");
    expect(windows).toMatch(/push --force[\s\S]{0,1200}exit 1/);
  });

  it("stops when the data migrations fail", () => {
    // A failed data migration is exactly the case where the schema and
    // the data disagree. All three entrypoints used to carry on and
    // serve wrong or empty data with no error at all.
    const docker = readFileSync(path.join(ROOT, "scripts/docker-entrypoint.sh"), "utf-8");
    // The migration is not in a `||` that swallows its failure.
    expect(docker).toMatch(/^\s*node scripts\/migrate\.mjs\s*$/m);

    const macos = readFileSync(path.join(ROOT, "scripts/macos/start.sh"), "utf-8");
    expect(macos).toMatch(/migrate\.mjs[\s\S]{0,300}exit 1/);

    const windows = readFileSync(path.join(ROOT, "scripts/windows/start.ps1"), "utf-8");
    expect(windows).toMatch(/migrationFailed[\s\S]{0,300}exit 1/);
  });

  it("finds the templates and the tools in the packaged layout", async () => {
    // The lookups have to include the place the packaging puts things.
    //
    // The shipped layout is:
    //
    //   <app>/dist/index.js
    //   <app>/server/templates/builtin/*.json
    //   <app>/skill-engine/tools/*.py
    //
    // The bundle sits in `dist`, so "beside the bundle's own folder" is
    // one level up from it — not two, which is above the app.
    const { builtinDirs } = await import("./templates/index");
    const { skillEngineDirs } = await import("./_core/env");

    // The candidate that is "one level up from the bundle".
    const templates = builtinDirs().map((dir) => dir.replace(/\\/g, "/"));
    const tools = skillEngineDirs().map((dir) => dir.replace(/\\/g, "/"));

    const bundleDir = path.resolve(ROOT, "dist");
    const besideTheBundle = path.resolve(bundleDir, "..");
    expect(templates).toContain(
      path.join(besideTheBundle, "server", "templates", "builtin").replace(/\\/g, "/"),
    );
    expect(tools).toContain(path.join(besideTheBundle, "skill-engine").replace(/\\/g, "/"));
  });

  it("fetches the package manager while the image is being built", () => {
    // `corepack enable` only installs the shim: the pnpm itself is
    // downloaded into a cache on first use, and that cache lives in the
    // build stage. So the container reached for the npm registry on
    // every start, and an air-gapped install could not start at all.
    const dockerfile = readFileSync(path.join(ROOT, "Dockerfile"), "utf-8");
    expect(dockerfile).toMatch(/corepack prepare pnpm@/);
  });
});
