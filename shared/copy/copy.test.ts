import { describe, expect, it } from "vitest";
import { COPY, copy, detectLocale, interpolate, isCopyKey } from "./index";

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
    const sameInBoth = new Set(["collectors.slack"]);
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
    for (const key of Object.keys(COPY)) {
      if (placeholders(COPY[key].zh).join(",") !== placeholders(COPY[key].en).join(",")) {
        mismatched.push(key);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("has no entry that nothing reads", () => {
    // An entry nobody reads is a sentence the app maintains and no person
    // ever sees. It is not a crash and it is not a wrong answer — which is
    // exactly why it needs a test to notice it.
    const source = collectSource("server") + collectSource("client") + collectSource("shared");

    // The namespaces whose keys are reached through a variable rather than
    // written out — `copy(locale, STYLE_KEYS[kind])` — cannot be found by
    // a plain search, so they are exempt.
    const dynamic = new Set<string>();
    for (const match of source.matchAll(/"([A-Za-z0-9_.]+)\.[A-Za-z0-9_]+"/g)) {
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
function collectSource(dir: string): string {
  const { readdirSync, statSync, readFileSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const root = join(__dirname, "..", "..", dir);
  let out = "";
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(path, name);
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
    expect(copy("en", "channels.nothingHere")).toBe("channels.nothingHere");
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
