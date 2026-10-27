import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { COPY, copy, copyKey, detectLocale, interpolate, isCopyKey } from "./index";
import { registerSkillPrompts } from "./skill-prompts";

// The skill prompts are added to the table when the pipeline is loaded.
registerSkillPrompts();

/** Every source file under a directory, as full paths. */
function sourceFiles(dir: string): string[] {
  const root = path.resolve(__dirname, "..", "..", dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name === "dist" || name === ".git") continue;
        walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The server's own words.
 *
 * The interface's dictionary has a test that the two languages have the
 * same keys and that no Chinese string is left in the English one. This
 * is the same test for the other half — the words the *server* says to
 * a person.
 *
 * It exists because the failure is invisible. A missing English string
 * does not crash anything: it falls back to Chinese, and the app keeps
 * working, and the English user gets one Chinese sentence. Nobody
 * notices until they are the one reading it.
 */
describe("the server's copy", () => {
  it("has both languages for every entry", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(COPY)) {
      if (!entry.zh || !entry.zh.trim()) missing.push(`${key} (zh)`);
      if (!entry.en || !entry.en.trim()) missing.push(`${key} (en)`);
    }
    expect(missing).toEqual([]);
  });

  it("never leaves a Chinese string in the English half", () => {
    const han = /[一-鿿]/;
    const offenders = Object.entries(COPY)
      .filter(([, entry]) => han.test(entry.en))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("never leaves an English string in the Chinese half", () => {
    // A Chinese entry that is only Latin is an English string pasted into
    // the wrong file — the mistake the interface's test looks for too.
    //
    // A few names are the same in both languages: a product is called
    // Slack in Chinese too.
    // The material fence's markers are the same in both languages on
    // purpose: they are markers, not prose.
    const sameInBoth = new Set([
      "collectors.slack",
      "prompt.materialFenceHeader",
      "prompt.materialFenceEnd",
    ]);
    const offenders = Object.entries(COPY)
      .filter(([key, entry]) => !/[一-鿿]/.test(entry.zh) && !sameInBoth.has(key))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("uses the same placeholders on both sides", () => {
    const placeholders = (text: string) => {
      const found: string[] = [];
      const pattern = /\{\{(\w+)\}\}/g;
      let match = pattern.exec(text);
      while (match) {
        found.push(match[1]);
        match = pattern.exec(text);
      }
      return found.sort();
    };
    const mismatched: string[] = [];
    const table = COPY as unknown as Record<string, { zh: string; en: string }>;
    for (const key of Object.keys(table)) {
      if (placeholders(table[key].zh).join(",") !== placeholders(table[key].en).join(",")) {
        mismatched.push(key);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("has no entry that nothing reads", () => {
    // An entry nobody reads is a sentence the app maintains and no person
    // ever sees. It is not a crash and it is not a wrong answer — which is
    // exactly why it needs a test to notice it.
    /**
     * The source, without the catalogue itself.
     *
     * The shared directory holds the catalogue — and the catalogue
     * writes every key out in full. So the search found every key in
     * its own definition, and the list of dead entries was always
     * empty: the test could not fail.
     */
    const source =
      collectSource("server") +
      collectSource("client") +
      collectSource("shared", (relativePath) => relativePath === "copy" || relativePath.startsWith("copy/")) +
      collectSource("scripts");

    /**
     * The namespaces whose keys are reached through a template.
     *
     * `labels.imperfection.${state}` cannot be found by a plain search,
     * so the namespaces used that way are exempt.
     *
     * It used to be exempt for every namespace that had one literal
     * call in it — the pattern matched *any* quoted string with a dot
     * in it, so `copy(locale, "errors.unknownProvider")` made the whole
     * "errors" namespace exempt, and every key under it was invisible
     * to this test. Thirteen namespaces and a hundred and eighty-three
     * keys were being skipped that way.
     */
    const dynamic = new Set<string>();
    for (const match of source.matchAll(/`([A-Za-z0-9_.]+)\./g)) {
      dynamic.add(match[1]);
    }

    const dead = Object.keys(COPY).filter((key) => {
      if (source.includes(key)) return false;
      const namespace = key.split(".").slice(0, -1).join(".");
      if (dynamic.has(namespace)) return false;
      // The scene copy is derived from the scene definitions, so its keys
      // are not written out anywhere.
      if (key.startsWith("scenes.")) return false;
      return true;
    });

    expect(dead).toEqual([]);
  });
});

/** Every source file under a directory, as one string. */
function collectSource(dir: string, skip?: (relativePath: string) => boolean): string {
  const { readdirSync, statSync, readFileSync } = require("fs") as typeof import("fs");
  const { join, relative } = require("path") as typeof import("path");
  const root = join(__dirname, "..", "..", dir);
  let out = "";
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(path, name);
      // The path is relative to the directory being read, so a rule can
      // name a subdirectory.
      if (skip?.(relative(root, full).split(/[\\/]/).join("/"))) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) {
        out += readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return out;
}

describe("looking a sentence up", () => {
  it("gives the language that was asked for", () => {
    expect(copy("zh", "channels.noPersonas")).toContain("分身");
    expect(copy("en", "channels.noPersonas")).toContain("persona");
  });

  it("falls back to Chinese for a language it does not have", () => {
    expect(copy("fr", "channels.noPersonas")).toBe(COPY["channels.noPersonas"].zh);
  });

  it("shows the key itself when the key is unknown", () => {
    // A missing translation should look like a missing translation, not
    // like an empty box.
    // The key is not in the table — so it is looked up at runtime,
    // where the answer is the key itself.
    expect(copyKey("en", "channels.nothingHere")).toBe("channels.nothingHere");
    expect(isCopyKey("channels.nothingHere")).toBe(false);
    expect(isCopyKey("channels.noPersonas")).toBe(true);
  });

  it("fills the placeholders in", () => {
    expect(interpolate("Hello {{name}}, you are {{age}}", { name: "小A", age: 7 })).toBe(
      "Hello 小A, you are 7",
    );
    expect(copy("en", "reminders.anniversary", { title: "the first day" })).toContain(
      "the first day",
    );
  });

  it("leaves a placeholder alone when there is nothing to put in it", () => {
    expect(interpolate("Hello {{name}}", {})).toBe("Hello {{name}}");
  });
});

describe("the keys the app asks for", () => {
  it("are all in the table", () => {
    // A key that is not in the table falls back to the key itself, so a
    // typo shows up as `errors.someKey` in the interface or inside a
    // model's prompt — and nothing crashes, so nothing else would
    // notice.
    //
    // The type of the key is now a literal union, so a typo in a
    // *literal* call is a compile error. This catches the rest: the
    // calls whose key is built at runtime.
    const roots = ["server", "client", "shared", "scripts"];
    const missing: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, "utf-8");
        const pattern = /\bcopy\(\s*(?:[a-zA-Z_$][\w$]*|locale)\s*,\s*"([\w.]+)"/g;
        let match = pattern.exec(text);
        while (match !== null) {
          if (!isCopyKey(match[1])) {
            missing.push(`${file.replace(/.*\//, "")}: ${match[1]}`);
          }
          match = pattern.exec(text);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the type of the key", () => {
  it("is a literal, so a typo in a literal call is a compile error", () => {
    /**
     * The key was `CopyKey | string` — which is `string`. So every
     * typo compiled cleanly, and then showed up as `errors.someKey` in
     * the interface, or inside a model's prompt where nobody would
     * ever see it.
     *
     * The test cannot check the type — but it can check that the two
     * functions are what they claim: `copy` takes a key from the
     * table, and `copyKey` takes one that is not known until it is
     * built, and answers with the key itself when it is not there.
     */
    expect(copy("zh", "channels.noPersonas")).toContain("分身");
    expect(copyKey("zh", "channels.noPersonas")).toContain("分身");
    expect(copyKey("zh", "channels.nothingHere")).toBe("channels.nothingHere");
  });

  it("says which keys the table holds", () => {
    /**
     * The keys are the ones the table has — so a key that is added to
     * the table is a key that can be asked for, and one that is not
     * there cannot.
     */
    const key = "channels.noPersonas" as const;
    expect(isCopyKey(key)).toBe(true);
    expect(Object.keys(COPY)).toContain(key);
  });
});

describe("working out which language somebody is writing in", () => {
  it("reads Chinese as Chinese", () => {
    expect(detectLocale("在吗")).toBe("zh");
    expect(detectLocale("/使用 小A")).toBe("zh");
  });

  it("reads anything else as English", () => {
    expect(detectLocale("/use Ann")).toBe("en");
    expect(detectLocale("are you there")).toBe("en");
  });

  it("defaults to Chinese when there is nothing to go on", () => {
    expect(detectLocale("")).toBe("zh");
    expect(detectLocale(undefined)).toBe("zh");
  });
});
