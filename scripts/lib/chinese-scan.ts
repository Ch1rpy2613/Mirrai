/**
 * The scanner that keeps the server's languages honest.
 *
 * The interface was translated; the server was not. Every error toast,
 * every push notification, every prompt the server sends to a model — all
 * of it was written in Chinese, so an English user got an English app that
 * answered in Chinese whenever anything went wrong.
 *
 * This module answers one question:
 *
 *   **Is there a Chinese string in the server that has no English
 *   counterpart?**
 *
 * A Chinese string that sits in a `zh` property whose object also has an
 * `en` property is a copy table — it is bilingual by construction. Anything
 * else is a person about to read Chinese in an English app.
 *
 * There is one exception, and it is deliberate: a list of words the app
 * *matches against* what the user typed. The crisis keywords are Chinese
 * because a Chinese speaker writes them in Chinese; the role markers of a
 * pasted chat transcript are Chinese because that is how the transcripts
 * are written. Those declarations are marked with a comment:
 *
 * ```ts
 * // i18n:allow-input — these are matched against what the user typed.
 * const CRISIS_TERMS_ZH = ["自杀", …];
 * ```
 *
 * The marker is per declaration, not per file, so a new Chinese string
 * that is not a keyword list is still caught.
 *
 * The `wechat` directory is skipped by name. `server/wechat/**` is a hard
 * constraint — the WeChat protocol implementation has to stay byte for byte
 * what it was — and its messages are the WeChat ones, which are Chinese.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** The Chinese range. */
const HAN = /[一-鿿]/;

/** The marker that exempts a declaration. */
const INPUT_MARKER = "i18n:allow-input";

/** The marker that exempts a declaration holding a stored value. */
const IDENTIFIER_MARKER = "i18n:allow-identifier";

export interface ChineseStringHit {
  /** The file, relative to the root that was scanned. */
  file: string;
  /** The line the string is on, counting from 1. */
  line: number;
  /** The source line, trimmed. */
  text: string;
}

export interface ScanOptions {
  /** Directory names that are never scanned. */
  skipDirs?: string[];
  /** File names (without a path) that are never scanned. */
  skipFiles?: string[];
}

export interface SourceOptions {
  /**
   * Whether this file is the Chinese half of a bilingual dictionary.
   *
   * The interface's dictionary is two files — `zh.ts` and `en.ts` — and
   * the Chinese one is Chinese by definition. A separate test makes sure
   * the two have exactly the same keys, which is what guarantees that
   * every Chinese string in it has an English counterpart.
   */
  dictionaryHalf?: boolean;
}

const DEFAULT_SKIP_DIRS = ["node_modules", ".git", "dist", "drizzle", "wechat"];
const DEFAULT_SKIP_FILES: string[] = [];

/** Every source file under a directory. */
function* walk(dir: string, options: Required<ScanOptions>): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (options.skipDirs.includes(name)) continue;
    const full = join(dir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      yield* walk(full, options);
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !options.skipFiles.includes(name)
    ) {
      yield full;
    }
  }
}

/** Whether an object literal has a property with that name. */
function hasProperty(object: ts.Node | undefined, name: string): boolean {
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );
}

/** The name of a property, whether it was written as an identifier or a string. */
function propertyName(property: ts.PropertyAssignment): string | null {
  if (ts.isIdentifier(property.name)) return property.name.text;
  if (ts.isStringLiteral(property.name)) return property.name.text;
  return null;
}

/**
 * The property assignments a string literal sits inside.
 *
 * A string can be several levels down from the property that gives it its
 * language: `{ zh: "…" }`, `{ zh: [ "…", "…" ] }`, `{ zh: [ "…" ].join("\n") }`
 * and `{ zh: { key: "…" } }` all occur, and they all mean the same thing.
 * This walks up through the shapes that do not change the meaning —
 * arrays, parentheses, template wrappers, a call on the array — and
 * collects the properties it passes through.
 */
function enclosingProperties(node: ts.Node): ts.PropertyAssignment[] {
  const properties: ts.PropertyAssignment[] = [];
  let current: ts.Node = node;

  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (!parent) break;

    if (ts.isPropertyAssignment(parent)) {
      properties.push(parent);
      current = parent;
      continue;
    }
    if (
      ts.isArrayLiteralExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isCallExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isObjectLiteralExpression(parent)
    ) {
      current = parent;
      continue;
    }
    break;
  }
  return properties;
}

/**
 * Whether a string literal is part of a bilingual copy table.
 *
 * Four shapes occur:
 *
 *   - flat:    `{ zh: "…", en: "…" }`
 *   - nested:  `{ zh: { key: "…" }, en: { … } }`
 *   - a list:  `{ zh: [ "…", "…" ], en: [ … ] }` — and the list is often
 *              joined into one string, which changes nothing
 *   - a pair:  `{ name: "…", nameEn: "…" }` — the shape the scenes and the
 *              intimacy levels use
 *
 * The Chinese half is only exempt when the English half is actually there.
 * A Chinese string in an `en` property is **not** exempt: that one would
 * be a person reading Chinese in an English app.
 */
function belongsToCopyTable(node: ts.Node): boolean {
  for (const property of enclosingProperties(node)) {
    const name = propertyName(property);
    if (name === "zh") {
      const owner = property.parent;
      if (hasProperty(owner, "en")) return true;
    } else if (name === "name") {
      const owner = property.parent;
      if (hasProperty(owner, "nameEn")) return true;
    }
  }
  return false;
}

/**
 * Whether a string literal is a key rather than text.
 *
 * `{ "肯定的言辞": MessageCircle }` is a lookup table keyed by the value
 * that is stored in the database; the key is an identifier, not something
 * anybody reads. The same goes for the property names of a dictionary.
 */
function isObjectKey(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (
    ts.isPropertyAssignment(parent) &&
    parent.name === node &&
    parent.initializer !== node
  ) {
    return true;
  }
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  return false;
}

/**
 * Whether the declaration a string belongs to is marked as input matching.
 *
 * The marker is looked for in the comment that sits directly above the
 * declaration, so it applies to that declaration and nothing else.
 */
function isMarkedAsInputMatching(node: ts.Node, source: string): boolean {
  return hasMarker(node, source, INPUT_MARKER);
}

/**
 * Whether the declaration a string belongs to is marked as a stored value.
 *
 * A stored value is an identifier, not a sentence: "安全型" is what the
 * attachment style is called in the database, and the interface shows the
 * translated name. It is Chinese because that is what the rows say.
 */
function isMarkedAsIdentifier(node: ts.Node, source: string): boolean {
  return hasMarker(node, source, IDENTIFIER_MARKER);
}

function hasMarker(node: ts.Node, source: string, marker: string): boolean {
  let current: ts.Node | undefined = node;

  // The nearest declaration wins, but a marker further up still counts: a
  // marker on a whole object covers the strings inside it, and a marker on
  // one property covers only that property.
  while (current) {
    if (
      ts.isVariableStatement(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isPropertyAssignment(current) ||
      ts.isExportDeclaration(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      const comments = ts.getLeadingCommentRanges(source, current.getFullStart()) ?? [];
      if (comments.some((comment) => source.slice(comment.pos, comment.end).includes(marker))) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * The Chinese strings in one file that have no English counterpart.
 */
export function bareChineseInSource(
  source: string,
  fileName: string,
  options: SourceOptions = {},
): ChineseStringHit[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: ChineseStringHit[] = [];
  const lines = source.split("\n");

  const record = (node: ts.Node, text: string) => {
    if (!HAN.test(text)) return;
    // The Chinese half of the interface's dictionary: every key in it has
    // an English counterpart, which a separate test enforces.
    if (options.dictionaryHalf) return;
    // A key is an identifier, not something anybody reads.
    if (isObjectKey(node)) return;
    if (belongsToCopyTable(node)) return;
    if (isMarkedAsInputMatching(node, source)) return;
    if (isMarkedAsIdentifier(node, source)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ file: fileName, line: line + 1, text: (lines[line] ?? "").trim() });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      record(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * Whether a file is the Chinese half of a bilingual dictionary.
 *
 * `client/src/i18n/zh.ts` next to `client/src/i18n/en.ts` is the interface's
 * dictionary. The name and the sibling are what identify it — not a
 * marker, because the file is Chinese on purpose and always will be.
 */
export function isChineseDictionaryHalf(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  if (name !== "zh.ts" && name !== "zh.tsx") return false;
  const directory = filePath.slice(0, filePath.length - name.length);
  return existsSync(join(directory, "en.ts")) || existsSync(join(directory, "en.tsx"));
}

/**
 * Scans a directory for Chinese strings with no English counterpart.
 *
 * The paths in the result are relative to `root`.
 */
export function scanForBareChinese(
  root: string,
  options: ScanOptions = {},
): ChineseStringHit[] {
  const resolved: Required<ScanOptions> = {
    skipDirs: options.skipDirs ?? DEFAULT_SKIP_DIRS,
    skipFiles: options.skipFiles ?? DEFAULT_SKIP_FILES,
  };

  const hits: ChineseStringHit[] = [];
  for (const file of walk(root, resolved)) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(root, file);
    const dictionaryHalf = isChineseDictionaryHalf(file);
    for (const hit of bareChineseInSource(source, relativePath, { dictionaryHalf })) {
      hits.push(hit);
    }
  }
  return hits;
}
