import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const schema = readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
const db = readFileSync(path.join(ROOT, "server", "db.ts"), "utf-8");

interface TableInfo {
  /** The Drizzle variable name, e.g. `channelBindings`. */
  varName: string;
  /** The table name, e.g. `channel_bindings`. */
  tableName: string;
  columns: Set<string>;
}

/**
 * The tables the schema declares, with the columns each one carries.
 *
 * The brace counting is what makes the callback form
 * (`pgTable("t", {...}, (table) => ({...}))`) parse.
 */
function declaredTables(src: string): TableInfo[] {
  const out: TableInfo[] = [];
  const pattern = /export const (\w+) = pgTable\(\s*"([a-z_]+)",\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    while (i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = src.slice(match.index + match[0].length, i);
    out.push({
      varName: match[1],
      tableName: match[2],
      // The indentation is not always two spaces: the tables declared in
      // the callback form are written four spaces deep, and a regex that
      // insists on two found no columns at all in them. Every one of
      // those tables was therefore invisible to this test — which is how
      // three tables with hard foreign keys stayed out of the delete
      // functions while the test reported that nothing was missing.
      columns: new Set(Array.from(body.matchAll(/^\s{2,}(\w+):\s/gm)).map((m) => m[1])),
    });
  }
  return out;
}

/** The tables a delete function removes, by their Drizzle variable name. */
function tablesDeletedIn(fnName: string): Set<string> {
  const match = new RegExp(
    `export async function ${fnName}\\([\\s\\S]*?\\n\\}\\n`,
  ).exec(db);
  if (!match) return new Set();
  return new Set(Array.from(match[0].matchAll(/tx\.delete\((\w+)\)/g)).map((m) => m[1]));
}

const tables = declaredTables(schema);

describe("deleting a user cleans up after them", () => {
  const deleted = tablesDeletedIn("deleteUserAccount");

  it("deletes from every user-scoped table", () => {
    // There are no foreign keys to cascade, so a table left out here would
    // keep its rows — and the user's private data with them — after the
    // account is gone.
    const missing = tables
      .filter((t) => t.columns.has("userId"))
      .filter((t) => !deleted.has(t.varName))
      .map((t) => t.tableName)
      .sort();

    expect(missing, "these tables are not cleaned up on account deletion").toEqual([]);
  });

  it("deletes the user row itself", () => {
    expect(deleted.has("users")).toBe(true);
  });

  it("runs in a transaction", () => {
    const match = /export async function deleteUserAccount\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("withTransaction");
  });
});

describe("deleting a persona cleans up after it", () => {
  const deleted = tablesDeletedIn("deletePersona");

  it("deletes from every persona-scoped table", () => {
    const missing = tables
      .filter((t) => t.columns.has("personaId"))
      .filter((t) => !deleted.has(t.varName))
      .map((t) => t.tableName)
      .sort();

    expect(missing, "these tables are not cleaned up on persona deletion").toEqual([]);
  });

  it("leaves the user's own settings alone", () => {
    // An LLM configuration or a template belongs to the user, not to one
    // persona — deleting a persona must not take them with it.
    expect(deleted.has("llmConfigs")).toBe(false);
    expect(deleted.has("personaTemplates")).toBe(false);
    expect(deleted.has("collectionSources")).toBe(false);
  });

  it("runs in a transaction", () => {
    const match = /export async function deletePersona\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("withTransaction");
  });
});

describe("deleting a user removes their files from the disk", () => {
  /**
   * The rows were deleted and the bytes were not.
   *
   * So the uploaded photographs and the extracted chat logs stayed in
   * the uploads directory, under the user's own id, after the account
   * was gone. Nothing read them again and nothing cleaned them up.
   */
  it("removes the uploaded files of the account", () => {
    const match = /export async function deleteUserAccount\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("removeStoredFiles");
  });

  it("removes the uploaded files of the persona", () => {
    const match = /export async function deletePersona\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("removeStoredFiles");
  });

  it("collects the keys before the rows are gone", () => {
    /**
     * The keys come from the files table and from the media of the
     * messages — so they have to be read before the rows are deleted.
     */
    const match = /export async function deleteUserAccount\([\s\S]*?\}\n/.exec(db);
    const body = match?.[0] ?? "";
    const collected = body.indexOf("collectStoredFiles");
    const deleted = body.indexOf("tx.delete(personaFiles)");
    expect(collected).toBeGreaterThan(-1);
    expect(deleted).toBeGreaterThan(-1);
    expect(collected).toBeLessThan(deleted);
  });
});
